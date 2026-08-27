'use server';

// =============================================================================
// packages/admin — Server Actions. THE ONLY WRITE PATH.
//
// Every mutation in the admin goes through one of these actions. Each one obeys the
// cross-package write contract:
//   (1) write D1 via the PRIMARY session (read-your-writes — see lib/db.ts),
//   (2) insert an audit_log row (actor = Cloudflare Access identity),
//   (3) purge the public API edge cache and enqueue PDF re-renders (best-effort).
// D1 is the source of truth; the public read path (esperanza-api + the static site)
// reads it directly, so no publish/push step is needed.
//
// Unpublished draft creates skip side effects — see createEntity `{ sync: false }`.
//
// QMI synced-field edits route through @esperanza/db/override (buildOverrideWrite /
// buildOverrideAudit). Plain fields are written directly. The publish toggle is the
// ONLY path that may set published=1 (admin-owns-1). Promotion targets are written
// replace-all into promotion_targets honoring the global-vs-id CHECK.
//
// These are server actions: they run in the Worker, are request-scoped, and read the
// identity from Cloudflare Access headers. They never trust client-supplied actor.
// =============================================================================

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { eq } from 'drizzle-orm';
import { and, asc } from 'drizzle-orm';
import {
  promotions,
  promotionTargets,
  cities,
  communities,
  floorPlans,
  testimonials,
  images,
  auditLog,
  fieldDefinitions,
  siteSettings,
  type FieldDefinition,
  type NewAuditLogRow,
  type NewFieldDefinition,
  type NewPromotionTarget,
} from '@esperanza/db';
import {
  buildOverrideWrite,
  buildOverrideAudit,
} from '@esperanza/db/override';
import type { PromoTargetType } from '@esperanza/db/promo';
import { getDb, idColumn, type Db } from './db';
import { getCurrentUser, isAdmin } from './auth';
import { getEntity, resolveEntity, isOverrideField, asOverridableEntity, type EntityKey } from './entities';
import { columnMapForEntity, coerceForColumn, toDrizzlePatch, readRowColumn } from './fields';
import { publishGateColumn } from './field-config';
import { statusGate, statusPatch, deriveStatus } from './status';
import { resolveCustomFieldDefs, type CustomFieldDef } from './field-config-source';
import { applyMembership } from './community-floor-plans';
import {
  isFieldType,
  isValidKeyShape,
  generateFieldKey,
  normalizeOptions,
  reservedKeysForEntity,
} from './field-builder';
import { chunk, AUDIT_ROWS_PER_INSERT } from './audit-chunk';
import { purgePublicCache } from '@esperanza/db/public-cache-purge';
import {
  runPostWriteSideEffects,
  scheduleFrontendRebuild,
  type RebuildMode,
} from './post-write-side-effects';
import type { FrontendRebuildResult } from '@esperanza/db/site-rebuild';

// =============================================================================
// Shared post-write step: audit_log rows + public-cache purge + PDF refresh.
// =============================================================================

interface AuditInput {
  entity: string;
  entityId: string;
  field: string | null;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  actor: string;
}

// Public api (esperanza-api) edge-cache purge. See @esperanza/db/public-cache-purge.

interface PostWriteOpts {
  /** When false, skip cache purge / rebuild / PDF (draft create). */
  sync?: boolean;
  /**
   * immediate = public-site edit (default); debounced is reserved for explicitly
   * non-urgent bulk work; skip = purge/PDF only, no rebuild.
   */
  rebuild?: RebuildMode;
}

/**
 * Insert audit rows, then schedule purge/rebuild/PDF in the background (waitUntil) so
 * Save and upload actions return quickly. Call AFTER the D1 write committed.
 */
async function postWrite(
  db: Db,
  collection: EntityKey,
  id: string,
  audits: AuditInput[],
  opts?: PostWriteOpts
): Promise<FrontendRebuildResult | null> {
  if (audits.length > 0) {
    const rows: NewAuditLogRow[] = audits.map((a) => ({
      entity: a.entity,
      entityId: a.entityId,
      field: a.field,
      action: a.action,
      oldValue: a.oldValue,
      newValue: a.newValue,
      actor: a.actor,
    }));
    for (const batch of chunk(rows, AUDIT_ROWS_PER_INSERT)) {
      await db.insert(auditLog).values(batch);
    }
  }

  if (opts?.sync === false) return null;

  // Every public-facing admin write must promptly update baked pages. A static
  // site cannot treat a successful D1 write as a completed edit while its public
  // HTML still shows old inventory, copy, or promotions. Bulk callers must opt in
  // to debounce explicitly.
  const rebuild = opts?.rebuild ?? 'immediate';
  const env = getCloudflareContext().env;

  // Purge before returning: live API islands (promos, QMI cards, settings) must not
  // depend on waitUntil — a background purge can be cut off when the isolate ends.
  try {
    await purgePublicCache(
      env as Parameters<typeof purgePublicCache>[0],
      collection
    );
  } catch {
    /* TTL backstop (≤5 min on esperanza-api) */
  }

  // Dispatch is deliberately awaited: accepting a D1 write while hiding a rejected
  // rebuild request is a false-success state. The later bake remains asynchronous.
  const siteRebuild = await scheduleFrontendRebuild(
    env as Parameters<typeof scheduleFrontendRebuild>[0],
    rebuild
  );
  if (siteRebuild && siteRebuild.status !== 'scheduled') {
    await db.insert(auditLog).values({
      entity: collection,
      entityId: id,
      field: null,
      action: 'rebuild_dispatch_failed',
      oldValue: null,
      newValue: `${siteRebuild.transport}: ${siteRebuild.detail}`,
      actor: audits[0]?.actor ?? null,
    });
  }

  const sideEffects = runPostWriteSideEffects(
    env as Parameters<typeof runPostWriteSideEffects>[0],
    collection,
    id,
    rebuild
  );
  try {
    getCloudflareContext().ctx.waitUntil(sideEffects);
  } catch {
    void sideEffects;
  }
  return siteRebuild;
}

const toStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// =============================================================================
// saveEntity — generic upsert of editable fields for one record.
//
// formData carries the editable columns. For QMI:
//   - fields in QMI_OVERRIDABLE_FIELDS  → buildOverrideWrite (blank ⇒ revert to
//     synced; non-blank ⇒ pin override) + buildOverrideAudit.
//   - all other QMI fields              → plain column write + plain audit.
// For every other entity: all submitted fields are plain admin-owned columns.
//
// `published` is IGNORED here — it has its own dedicated action (togglePublished) so
// the "admin-owns-1" invariant lives in exactly one place.
// =============================================================================

// =============================================================================
// createEntity — insert a fresh admin-created record with a generated id and return it.
// New records start unpublished/draft (the publish toggle is the only path to live).
// Audits a `create` row only — no cache purge or PDF work until the operator saves
// content or publishes (saveEntity / setStatus / togglePublished).
// The generated id is prefixed `adm` to distinguish admin-created rows from the
// legacy `rec` ids inherited at migration.
// =============================================================================

export async function createEntity(
  entity: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const def = getEntity(entity);
  if (!def) return { ok: false, error: `Unknown entity: ${entity}` };

  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const id = `adm${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const { db } = getDb();
  const at = new Date().toISOString();

  // Re-key to Drizzle property names (Drizzle .values()/.set() are keyed by JS props,
  // not physical column names — physical keys would be silently dropped).
  await db
    .insert(def.table)
    .values(toDrizzlePatch(def.key, { id, created_at: at, updated_at: at }) as never);

  await postWrite(
    db,
    def.key,
    id,
    [
      {
        entity: def.key,
        entityId: id,
        field: null,
        action: 'create',
        oldValue: null,
        newValue: id,
        actor,
      },
    ],
    { sync: false }
  );

  revalidatePath(`/${def.segment}`);
  return { ok: true, id };
}

/** Communities list/dashboard New — create unpublished draft, open editor (no /new page). */
export async function createCommunityDraft(_formData?: FormData): Promise<void> {
  const res = await createEntity('communities');
  if (res.ok) redirect(`/communities/${res.id}`);
  throw new Error(res.error);
}

// Belt-and-suspenders sanitize for rich-text HTML. The RichTextEditor (TipTap
// StarterKit + Link + Image) already restricts output to a safe node/mark set,
// so this is a SECOND line of defense against anything that slips in (e.g. a future
// paste-handler regression). Minimal + dependency-free (the Worker has no DOM): drop
// <script>/<style>/<iframe> blocks entirely and strip inline on*= event handlers. Not a
// full HTML parser — intentionally narrow, mirroring the editor's known-good output.
function sanitizeRichHtml(html: string): string {
  return html
    // Remove <script>/<style>/<iframe> elements and their contents.
    .replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Drop any orphan/self-closing forms of those tags too.
    .replace(/<\/?(script|style|iframe)\b[^>]*>/gi, '')
    // Strip inline event-handler attributes (onclick=, onerror=, …), quoted or bare.
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '');
}

export async function saveEntity(
  entity: string,
  id: string,
  formData: FormData
): Promise<{ ok: true; siteRebuild?: FrontendRebuildResult | null } | { ok: false; error: string }> {
  const def = getEntity(entity);
  if (!def) return { ok: false, error: `Unknown entity: ${entity}` };
  if (!id) return { ok: false, error: 'Missing record id' };

  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const { db } = getDb();
  const colMap = columnMapForEntity(def.key);
  // The publish-gate column (published | active | status) is written ONLY by its
  // dedicated toggle action so the publish/unpublish audit invariant lives in one
  // place. Skip it here even if the form submits it.
  const gate = publishGateColumn(def.key);
  const at = new Date().toISOString();

  // Phase B: CUSTOM fields (field_definitions rows with no real column) store their VALUES
  // in the row's `custom_fields` JSON blob. Resolve the entity's custom-field defs so we
  // can route those FormData entries into custom_fields (NEVER a real column). This is
  // purely ADDITIVE — real-column write logic below is unchanged.
  const customDefs = await resolveCustomFieldDefs(def.key);
  const customByKey = new Map<string, CustomFieldDef>(customDefs.map((d) => [d.key, d]));

  // Read the current row once (on the primary session) to compute audit old-values
  // and previous override values.
  const current = (await db
    .select()
    .from(def.table)
    .where(eq(idColumn(def.table), id))
    .limit(1)) as Array<Record<string, unknown>>;
  if (current.length === 0) return { ok: false, error: `${def.label} ${id} not found` };
  const row = current[0]!;

  const patch: Record<string, unknown> = {};
  const audits: AuditInput[] = [];

  // Accumulate custom-field writes, then merge into custom_fields once after the loop.
  // Drizzle's bare select() keys the row by the JS property (camelCase `customFields`);
  // read that first, falling back to the physical snake_case key.
  const existingCustom = parseCustomFieldsBlob(row['customFields'] ?? row['custom_fields']);
  const nextCustom: Record<string, unknown> = { ...existingCustom };
  const customAudits: AuditInput[] = [];
  let customChanged = false;

  for (const [field, rawValue] of formData.entries()) {
    // FormData values can be File (handled by uploadImage, not here) — skip.
    if (typeof rawValue !== 'string') continue;
    // The publish gate (published/active/status) has its own action; never set it here.
    if (field === 'published' || (gate && field === gate)) continue;

    // --- CUSTOM field (custom_fields-backed): merge into the JSON blob, not a column ---
    const customDef = customByKey.get(field);
    if (customDef) {
      // Reject expiring Airtable attachment URLs in custom values too (Decision-log #9).
      if (rawValue.includes('airtableusercontent.com')) {
        return { ok: false, error: `Refusing to store an Airtable attachment URL in ${field}` };
      }
      const coerced = coerceCustomValue(customDef.type, rawValue);
      const oldValue = existingCustom[field];
      if (toStr(oldValue) === toStr(coerced)) continue; // no-op
      if (coerced === null) {
        delete nextCustom[field]; // blank clears the key
      } else {
        nextCustom[field] = coerced;
      }
      customChanged = true;
      customAudits.push({
        entity: def.key,
        entityId: id,
        field,
        action: 'update',
        oldValue: toStr(oldValue),
        newValue: toStr(coerced),
        actor,
      });
      continue;
    }

    // Only accept fields we know how to map to a column.
    const col = colMap[field];

    // --- synced write-sets (qmi / communities / floor_plans): route through override.ts ---
    const overridableEntity = asOverridableEntity(def.key);
    if (overridableEntity && isOverrideField(def.key, field)) {
      const ofield = field;
      const value = rawValue === '' ? null : coerceForColumn(def.key, ofield, rawValue);
      const prevOverride = readRowColumn(row, `override_${ofield}`);
      const writePatch = buildOverrideWrite(ofield, value, { actor, at });
      Object.assign(patch, writePatch);
      const auditRow = buildOverrideAudit(id, ofield, prevOverride, value, { actor, at }, overridableEntity);
      audits.push({
        entity: auditRow.entity,
        entityId: auditRow.entity_id,
        field: auditRow.field,
        action: auditRow.action,
        oldValue: auditRow.old_value,
        newValue: auditRow.new_value,
        actor: auditRow.actor,
      });
      continue;
    }

    // --- plain admin-owned column ---
    if (!col) continue; // unknown / non-editable field — ignore
    // Never persist an expiring Airtable attachment URL (Decision-log #9). Image
    // fields store STABLE R2 urls only; reject the airtable host on save.
    if (typeof rawValue === 'string' && rawValue.includes('airtableusercontent.com')) {
      return { ok: false, error: `Refusing to store an Airtable attachment URL in ${field}` };
    }
    // Belt-and-suspenders: scrub rich-text HTML before it's written. ALL rich fields now
    // store WYSIWYG HTML (RichTextEditor), so sanitize any HTML-bearing string value (the
    // editor already constrains output to a safe tag subset; this strips any
    // <script>/<style>/<iframe>/on*= that could slip through). No-op on plain text.
    const cleanValue =
      typeof rawValue === 'string' && /<[a-z][\s\S]*>/i.test(rawValue)
        ? sanitizeRichHtml(rawValue)
        : rawValue;
    const coerced = cleanValue === '' ? null : coerceForColumn(def.key, field, cleanValue);
    const oldValue = readRowColumn(row, col.column);
    // Skip no-op writes so we don't spam audit_log.
    if (toStr(oldValue) === toStr(coerced)) continue;
    patch[col.column] = coerced;
    audits.push({
      entity: def.key,
      entityId: id,
      field,
      action: 'update',
      oldValue: toStr(oldValue),
      newValue: toStr(coerced),
      actor,
    });
  }

  // Fold the merged custom_fields blob into the SAME patch when any custom field changed,
  // so real-column and custom-field edits commit in one UPDATE. `custom_fields` is a real
  // (additive) column, so it re-keys through toDrizzlePatch like any other column.
  if (customChanged) {
    patch['custom_fields'] = JSON.stringify(nextCustom);
    audits.push(...customAudits);
  }

  // Promotion targeting: the scope picker mirrors its selection into THIS form as a
  // hidden `__promo_targets` JSON field. Persist it through saveEntity (the proven save
  // path) so the page's primary Save writes targets — the picker's standalone server
  // action never landed targets in prod. Runs BEFORE the empty-patch early-return so a
  // targeting-only edit (no column change) still saves. Empty "scoped" (nothing picked)
  // is a no-op here; use the standalone button to deliberately clear via global.
  if (def.key === 'promotions') {
    const rawTargets = formData.get('__promo_targets');
    if (typeof rawTargets === 'string' && rawTargets) {
      let scope: PromoScope;
      try {
        scope = JSON.parse(rawTargets) as PromoScope;
      } catch {
        return { ok: false, error: 'Targeting: invalid scope payload' };
      }
      const isEmptyScoped =
        scope.type === 'scoped' &&
        !(scope.cities?.length || scope.communities?.length || scope.floorPlans?.length || scope.qmis?.length);
      if (!isEmptyScoped) {
        const tr = await savePromotionTargets(id, scope);
        if (!tr.ok) return { ok: false, error: `Targeting: ${tr.error}` };
      }
    }
  }

  // Community side widgets: HOA links + floor-plan membership mirror into the main
  // <form> as hidden JSON fields (same pattern as __promo_targets).
  if (def.key === 'communities') {
    const rawHoa = formData.get('__hoa_links');
    if (typeof rawHoa === 'string' && rawHoa) {
      let links: Array<{ title: string; link: string }>;
      try {
        const parsed = JSON.parse(rawHoa);
        if (!Array.isArray(parsed)) throw new Error('not array');
        links = parsed as Array<{ title: string; link: string }>;
      } catch {
        return { ok: false, error: 'HOA links: invalid payload' };
      }
      const hr = await saveCommunityHoaLinks(id, links);
      if (!hr.ok) return { ok: false, error: `HOA links: ${hr.error}` };
    }

    const rawPlans = formData.get('__community_floor_plans');
    if (typeof rawPlans === 'string' && rawPlans) {
      let planIds: string[];
      try {
        const parsed = JSON.parse(rawPlans);
        if (!Array.isArray(parsed)) throw new Error('not array');
        planIds = parsed.map((x) => String(x));
      } catch {
        return { ok: false, error: 'Floor plans: invalid payload' };
      }
      const pr = await saveCommunityFloorPlans(id, planIds);
      if (!pr.ok) return { ok: false, error: `Floor plans: ${pr.error}` };
    }
  }

  // A row with a NULL/empty slug is invisible on every public surface (URLs, catalogs,
  // the collection pages) even when published — that is how the "Masseto" floor plan
  // vanished after its create (QA punch list 2026-07-30, item 13). If the entity has a
  // slug column and it would still be empty after this save, derive it from the name.
  if ('slug' in colMap && !toStr(patch['slug'] ?? row['slug'])) {
    const nameVal = toStr(patch['name'] ?? row['name']);
    if (nameVal) {
      const derived = nameVal.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (derived) {
        patch['slug'] = derived;
        audits.push({ entity: def.key, entityId: id, field: 'slug', action: 'update', oldValue: null, newValue: `${derived} (auto-derived from name — empty slug hides the record from the public site)`, actor });
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true }; // nothing changed
  }

  patch['updated_at'] = at;

  // `patch` is keyed by PHYSICAL column names (col.column, override.ts's override_<f>,
  // custom_fields, updated_at). Drizzle .set() is keyed by JS property names — re-key or
  // every key is silently dropped (→ empty SET → invalid SQL). See lib/fields.toDrizzlePatch.
  await db
    .update(def.table)
    .set(toDrizzlePatch(def.key, patch) as never)
    .where(eq(idColumn(def.table), id));

  const siteRebuild = await postWrite(db, def.key, id, audits);

  revalidatePath(`/${def.segment}/${id}`);
  revalidatePath(`/${def.segment}`);
  return { ok: true, siteRebuild };
}

// =============================================================================
// deleteEntity — hard-delete one record (any entity) from D1.
//
// Mirrors deleteImageAsset: delete the D1 row, then postWrite a `delete` audit
// (+ public-cache purge). The public read path reads D1 directly, so the row
// disappears from the site once the cache TTL/purge clears.
//
// NOTE (synced entities): qmi/communities/floor_plans are sourced from Snowflake.
// Deleting the D1 row here does NOT stop the next sync from re-inserting it — the
// UI warns about this and steers those to Draft instead. We still allow the delete
// (it's occasionally useful for junk rows) rather than hard-blocking it.
// =============================================================================
export async function deleteEntity(
  entity: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const def = getEntity(entity);
  if (!def) return { ok: false, error: `Unknown entity ${entity}` };
  if (!id || id === 'new') return { ok: false, error: 'Missing record id' };

  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const { db } = getDb();
  const existing = await db.select().from(def.table).where(eq(idColumn(def.table), id)).limit(1);
  if (existing.length === 0) return { ok: false, error: `${def.label} record not found` };

  // Clear child targeting rows first (D1 FKs may be off, so ON DELETE CASCADE isn't
  // guaranteed). Orphans are otherwise harmless but this keeps the table clean.
  if (def.key === 'promotions') {
    await db.delete(promotionTargets).where(eq(promotionTargets.promotionId, id));
  }

  await db.delete(def.table).where(eq(idColumn(def.table), id));

  await postWrite(
    db,
    def.key,
    id,
    [{ entity: def.key, entityId: id, field: null, action: 'delete', oldValue: null, newValue: null, actor }],
    { rebuild: 'immediate' }
  );

  revalidatePath(`/${def.segment}`);
  revalidatePath(`/${def.segment}/${id}`);
  return { ok: true };
}

// =============================================================================
// matchAndRenderQmi — assign a floor plan (+ optional synced-field overrides) to an
// unmatched draft and kick off the brochure PDF render. Reuses saveEntity for the
// write, so floor_plan_id routes through buildOverrideWrite, gets audited, and (via
// postWrite) ensures the pdf_renders row + enqueues a render — all unchanged. Then
// it flags that render 'pending' so the UI shows in-flight
// status. It does NOT publish; that stays the dedicated togglePublished step.
// =============================================================================
export async function matchAndRenderQmi(
  qmiId: string,
  input: { floorPlanId: string; overrides?: Record<string, string> }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!qmiId) return { ok: false, error: 'Missing record id' };
  if (!input.floorPlanId || input.floorPlanId.trim() === '') {
    return { ok: false, error: 'Choose a floor plan first' };
  }

  const fd = new FormData();
  fd.set('floor_plan_id', input.floorPlanId);
  for (const [k, v] of Object.entries(input.overrides ?? {})) {
    fd.set(k, v);
  }

  const res = await saveEntity('qmi', qmiId, fd);
  if (!res.ok) return res;

  // postWrite already ensured the pdf_renders row and enqueued a render. Flag it
  // 'pending' so the UI reflects an in-flight render (the PDF worker moves it to
  // 'rendering' then 'live'; in environments without RENDER_Q it simply stays
  // 'pending' rather than erroring).
  try {
    const d1 = getCloudflareContext().env.DB as unknown as D1Database | undefined;
    await d1
      ?.prepare(
        `UPDATE pdf_renders SET status='pending' WHERE type='qmi' AND entity_id=? AND status NOT IN ('rendering','live')`
      )
      .bind(qmiId)
      .run();
  } catch (e) {
    console.error('[matchAndRenderQmi:pending]', e);
  }

  revalidatePath('/qmi/new');
  revalidatePath('/qmi');
  return { ok: true };
}

// Read-only: poll a QMI's brochure render status (drives the "Pending → link" UI on the
// match page). Returns the pdf_renders status and the stable dynamic_pdf URL.
export async function getQmiRenderStatus(
  qmiId: string
): Promise<{ status: string | null; url: string | null }> {
  try {
    const d1 = getCloudflareContext().env.DB as unknown as D1Database | undefined;
    if (!d1) return { status: null, url: null };
    const pr = (await d1
      .prepare(`SELECT status FROM pdf_renders WHERE type='qmi' AND entity_id=? LIMIT 1`)
      .bind(qmiId)
      .first()) as { status: string | null } | null;
    const q = (await d1
      .prepare(`SELECT dynamic_pdf AS url FROM qmi WHERE id=? LIMIT 1`)
      .bind(qmiId)
      .first()) as { url: string | null } | null;
    return { status: pr?.status ?? null, url: q?.url ?? null };
  } catch {
    return { status: null, url: null };
  }
}

// =============================================================================
// Custom-field (custom_fields JSON) value helpers for saveEntity.
//
//   parseCustomFieldsBlob — read the row's custom_fields TEXT into a flat object (tolerant
//                           of NULL/blank/malformed → {}). The merge preserves keys for
//                           fields NOT present in this submit (other custom fields, or
//                           values written by a future builder UI), so a partial save can
//                           never wipe sibling custom values.
//   coerceCustomValue     — coerce a submitted string to the JS type its field-builder type
//                           implies (number/currency → number, bool → '1'/'0'/'true' →
//                           boolean, else string). Blank → null (the key is removed).
// =============================================================================

function parseCustomFieldsBlob(v: unknown): Record<string, unknown> {
  if (typeof v !== 'string' || v.trim() === '') return {};
  try {
    const o = JSON.parse(v);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    return o as Record<string, unknown>;
  } catch {
    return {};
  }
}

function coerceCustomValue(type: string, raw: string): unknown {
  if (raw === '') return null;
  switch (type) {
    case 'number':
    case 'currency': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'bool':
      return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'on';
    default:
      return raw;
  }
}

// =============================================================================
// togglePublished — the ONLY path that sets published=1 (admin-owns-1).
//
// ingest force-0 on sold is enforced elsewhere (and tested). Here the admin may set
// 0 or 1. Only entities with a publish gate are accepted.
// =============================================================================

export async function togglePublished(
  entity: string,
  id: string,
  value: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const def = getEntity(entity);
  if (!def) return { ok: false, error: `Unknown entity: ${entity}` };
  if (!def.publishable) return { ok: false, error: `${def.label} has no publish gate` };

  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const { db } = getDb();
  const at = new Date().toISOString();

  const current = (await db
    .select()
    .from(def.table)
    .where(eq(idColumn(def.table), id))
    .limit(1)) as Array<Record<string, unknown>>;
  if (current.length === 0) return { ok: false, error: `${def.label} ${id} not found` };
  const wasPublished = Boolean(current[0]!['published']);

  await db
    .update(def.table)
    .set(toDrizzlePatch(def.key, { published: value, updated_at: at }) as never)
    .where(eq(idColumn(def.table), id));

  await postWrite(db, def.key, id, [
    {
      entity: def.key,
      entityId: id,
      field: 'published',
      action: value ? 'publish' : 'unpublish',
      oldValue: wasPublished ? '1' : '0',
      newValue: value ? '1' : '0',
      actor,
    },
  ], { rebuild: 'immediate' });

  revalidatePath(`/${def.segment}/${id}`);
  revalidatePath(`/${def.segment}`);
  return { ok: true };
}

// =============================================================================
// toggleActive — promotions' publish gate. Migration 0005 RENAMED the gate column
// `active` → `published` (uniform with every other entity); this writes that column.
// Kept as a distinct entry point for backward compatibility with the promotions
// toggle wiring; published=false hides it from the public read path. Same audit
// contract as togglePublished.
// =============================================================================

export async function toggleActive(
  id: string,
  value: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: 'Missing promotion id' };
  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const { db } = getDb();
  const at = new Date().toISOString();
  const current = await db.select().from(promotions).where(eq(promotions.id, id)).limit(1);
  if (current.length === 0) return { ok: false, error: `Promotion ${id} not found` };
  const wasActive = Boolean((current[0]! as Record<string, unknown>)['published']);

  await db.update(promotions).set({ published: value, updatedAt: at }).where(eq(promotions.id, id));

  await postWrite(db, 'promotions', id, [
    {
      entity: 'promotions',
      entityId: id,
      field: 'published',
      action: value ? 'publish' : 'unpublish',
      oldValue: wasActive ? '1' : '0',
      newValue: value ? '1' : '0',
      actor,
    },
  ], { rebuild: 'immediate' });

  revalidatePath(`/promotions/${id}`);
  revalidatePath(`/promotions`);
  return { ok: true };
}

// =============================================================================
// setStatus — generic tri-state publish gate (feedback [16][17][27][41][45]). Maps a
// chosen status to the underlying columns per entity (see lib/status.ts):
//   location (qmi/communities/floor_plans): Draft/Coming Soon/Live → published+coming_soon
//   blog: Draft/Published → published (Scheduled is derived from publish_date)
//   promotion: Draft/Live → active   ·   testimonial: status text column
// Going to anything other than Draft is the 'publish' audit action.
// =============================================================================
export async function setStatus(
  entity: string,
  id: string,
  status: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const def = getEntity(entity);
  if (!def) return { ok: false, error: `Unknown entity: ${entity}` };
  const gate = statusGate(def.key);
  if (!gate) return { ok: false, error: `${def.label} has no status gate` };

  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const { db } = getDb();
  const at = new Date().toISOString();
  const current = (await db
    .select()
    .from(def.table)
    .where(eq(idColumn(def.table), id))
    .limit(1)) as Array<Record<string, unknown>>;
  if (current.length === 0) return { ok: false, error: `${def.label} ${id} not found` };
  const row = current[0]!;
  const oldStatus = deriveStatus(gate, {
    published: Boolean(row['published']),
    comingSoon: Boolean(row['comingSoon']),
    status: toStr(row['status']),
    publishDate: toStr(row['publishDate']) || null,
    now: at,
  });

  const patch = statusPatch(gate, status);
  const willBePublished = Boolean(patch['published']);

  await db
    .update(def.table)
    .set(toDrizzlePatch(def.key, { ...patch, updated_at: at }) as never)
    .where(eq(idColumn(def.table), id));

  const audits = [
    {
      entity: def.key,
      entityId: id,
      field: 'status',
      action: status === 'Draft' ? 'unpublish' : 'publish',
      oldValue: oldStatus,
      newValue: status,
      actor,
    },
  ];
  // Location/status controls are a real writer of the published bit. Record that bit
  // under the same field used by togglePublished and ingest so one audit query can
  // reconstruct publication ownership. Keep the status row as well: Coming Soon ↔ Live
  // can change without changing publication and remains useful editorial history.
  if (willBePublished !== Boolean(row['published'])) {
    audits.push({
      entity: def.key,
      entityId: id,
      field: 'published',
      action: willBePublished ? 'publish' : 'unpublish',
      oldValue: Boolean(row['published']) ? '1' : '0',
      newValue: willBePublished ? '1' : '0',
      actor,
    });
  }

  // A Draft transition removes content from the public site. It must receive the
  // same leading-edge rebuild as publish: debouncing it can skip the only safety
  // removal dispatch after a preceding edit, leaving a baked card visible.
  await postWrite(db, def.key, id, audits, { rebuild: 'immediate' });

  revalidatePath(`/${def.segment}/${id}`);
  revalidatePath(`/${def.segment}`);
  return { ok: true };
}

// =============================================================================
// setTestimonialStatus — testimonials' publish gate is a select, not a boolean.
// status === 'Draft' → hidden from the public read path; empty/other → live. Audit action mirrors
// the publish/unpublish contract (publish when leaving Draft, unpublish when entering).
// =============================================================================

export async function setTestimonialStatus(
  id: string,
  status: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: 'Missing testimonial id' };
  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const value = status === '' ? null : status;
  const { db } = getDb();
  const at = new Date().toISOString();
  const current = await db.select().from(testimonials).where(eq(testimonials.id, id)).limit(1);
  if (current.length === 0) return { ok: false, error: `Testimonial ${id} not found` };
  const old = (current[0]! as Record<string, unknown>)['status'];
  if (toStr(old) === toStr(value)) return { ok: true };

  await db.update(testimonials).set({ status: value, updatedAt: at }).where(eq(testimonials.id, id));

  await postWrite(db, 'testimonials', id, [
    {
      entity: 'testimonials',
      entityId: id,
      field: 'status',
      action: value === 'Draft' ? 'unpublish' : 'publish',
      oldValue: toStr(old),
      newValue: toStr(value),
      actor,
    },
  ]);

  revalidatePath(`/testimonials/${id}`);
  revalidatePath(`/testimonials`);
  return { ok: true };
}

// =============================================================================
// savePromotionTargets — replace-all the promotion_targets rows for one promo.
//
// scope describes the targeting:
//   { type: 'global' }                          → single row (target_type='global',
//                                                  target_id NULL)
//   { type: 'scoped', cities, communities, qmis }→ one row per id across the three
//                                                  target_types (city|community|qmi),
//                                                  each with a non-null target_id.
//
// The DB CHECK (promotion_targets_global_chk) enforces global⇒NULL and others⇒NOT
// NULL; we build rows accordingly. We DELETE all existing rows for the promo then
// INSERT the new set (replace-all), so deselected targets are removed.
// =============================================================================

export type PromoScope =
  | { type: 'global' }
  | {
      type: 'scoped';
      cities?: string[];
      communities?: string[];
      floorPlans?: string[];
      qmis?: string[];
    };

export async function savePromotionTargets(
  promoId: string,
  scope: PromoScope
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!promoId) return { ok: false, error: 'Missing promotion id' };

  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const { db } = getDb();
  const at = new Date().toISOString();

  // Verify the promo exists (FK-ish guard; D1/SQLite FKs may be off).
  const promo = await db.select().from(promotions).where(eq(promotions.id, promoId)).limit(1);
  if (promo.length === 0) return { ok: false, error: `Promotion ${promoId} not found` };

  // Build the new target rows.
  const rows: NewPromotionTarget[] = [];
  if (scope.type === 'global') {
    rows.push({ promotionId: promoId, targetType: 'global', targetId: null });
  } else {
    const add = (type: Exclude<PromoTargetType, 'global'>, ids?: string[]) => {
      for (const raw of ids ?? []) {
        const tid = raw.trim();
        if (tid) rows.push({ promotionId: promoId, targetType: type, targetId: tid });
      }
    };
    add('city', scope.cities);
    add('community', scope.communities);
    add('floor_plan', scope.floorPlans);
    add('qmi', scope.qmis);
    if (rows.length === 0) {
      return {
        ok: false,
        error: 'Scoped targeting requires at least one city, community, floor plan, or QMI',
      };
    }
  }

  // Replace-all: delete existing, insert new. (D1 has no multi-statement txn over the
  // Drizzle d1 driver here; run sequentially on the primary session.)
  await db.delete(promotionTargets).where(eq(promotionTargets.promotionId, promoId));
  if (rows.length > 0) await db.insert(promotionTargets).values(rows);

  // Touch the promotion so its updated_at reflects the target change (cache purge + audit).
  await db.update(promotions).set({ updatedAt: at }).where(eq(promotions.id, promoId));

  const summary =
    scope.type === 'global'
      ? 'global'
      : rows.map((r) => `${r.targetType}:${r.targetId}`).join(',');

  await postWrite(db, 'promotions', promoId, [
    {
      entity: 'promotions',
      entityId: promoId,
      field: 'targets',
      action: 'set_targets',
      oldValue: null,
      newValue: summary,
      actor,
    },
  ]);

  revalidatePath(`/promotions/${promoId}`);
  revalidatePath(`/promotions`);
  return { ok: true };
}

// =============================================================================
// saveCommunityFloorPlans — set which floor plans are offered in one community.
//
// The relationship is denormalized on the floor-plan side (floor_plans.communities
// CSV of community NAMES + community_count) — what the public API consumes. Editing
// from the community page therefore rewrites that CSV on each AFFECTED floor-plan
// row: add this community's name to newly-selected plans, strip it from deselected
// ones, leave unchanged plans alone (no churn). Each changed plan is audited via
// postWrite('floor_plans', …).
// =============================================================================

export async function saveCommunityFloorPlans(
  communityId: string,
  floorPlanIds: string[]
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  if (!communityId) return { ok: false, error: 'Missing community id' };

  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const { db } = getDb();
  const at = new Date().toISOString();

  const comm = await db
    .select({ id: communities.id, name: communities.name })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (comm.length === 0) return { ok: false, error: `Community ${communityId} not found` };
  const communityName = (comm[0]!.name ?? '').trim();
  if (!communityName) return { ok: false, error: 'This community has no name to link plans by' };

  const selected = new Set(floorPlanIds.map((s) => s.trim()).filter(Boolean));
  const plans = (await db
    .select({
      id: floorPlans.id,
      communities: floorPlans.communities,
      communityIds: floorPlans.communityIds,
    })
    .from(floorPlans)) as Array<{ id: string; communities: string | null; communityIds: string | null }>;

  let changed = 0;
  for (const p of plans) {
    const isMember = selected.has(p.id);
    // Maintain BOTH denormalized CSVs in lockstep: names (for linking / display)
    // and rec-IDs (the id-based membership source of truth). applyMembership is token-
    // agnostic; communityId comes verbatim from communities.id on add AND remove,
    // so its case-insensitive match is always byte-identical (safe for rec-IDs).
    const nameRes = applyMembership(p.communities, communityName, isMember);
    const idRes = applyMembership(p.communityIds, communityId, isMember);
    if (!nameRes.changed && !idRes.changed) continue;
    await db
      .update(floorPlans)
      .set({
        communities: nameRes.value || null,
        communityCount: nameRes.count,
        communityIds: idRes.value || null,
        updatedAt: at,
      })
      .where(eq(floorPlans.id, p.id));
    await postWrite(db, 'floor_plans', p.id, [
      {
        entity: 'floor_plans',
        entityId: p.id,
        field: 'communities',
        action: isMember ? 'community_added' : 'community_removed',
        oldValue: p.communities ?? null,
        newValue: nameRes.value || null,
        actor,
      },
    ]);
    changed++;
  }

  revalidatePath(`/communities/${communityId}`);
  revalidatePath(`/communities`);
  revalidatePath(`/floor-plans`);
  return { ok: true, changed };
}

// =============================================================================
// uploadImage — store the file in R2 IMAGES at <entity>/<id>/<filename>, then persist
// the STABLE public url into the row. NEVER stores a v5.airtableusercontent.com url.
//
// `field` is the column the url is written to (e.g. 'image_url', 'featured_image_url').
// Returns the stable url on success.
// =============================================================================

export async function uploadImage(
  entity: string,
  id: string,
  field: string,
  file: File
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const def = resolveEntity(entity);
  if (!def) return { ok: false, error: `Unknown entity: ${entity}` };
  if (!id) return { ok: false, error: 'Missing record id' };
  if (!file || file.size === 0) return { ok: false, error: 'Empty file' };

  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const colMap = columnMapForEntity(def.key);
  const col = colMap[field];
  if (!col) return { ok: false, error: `Field ${field} is not an editable column of ${def.label}` };

  const env = getCloudflareContext().env;
  const safeName = sanitizeFilename(file.name);
  const key = `${def.key}/${id}/${safeName}`;

  await env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  // Stable, content-addressable-ish public url. Base is a real CDN/R2 domain — never
  // an Airtable attachment host.
  const base = (env.IMAGES_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const url = `${base}/${key}`;
  if (url.includes('airtableusercontent.com')) {
    return { ok: false, error: 'Refusing to store an Airtable attachment URL' };
  }

  const { db } = getDb();
  const at = new Date().toISOString();
  const current = (await db
    .select()
    .from(def.table)
    .where(eq(idColumn(def.table), id))
    .limit(1)) as Array<Record<string, unknown>>;
  if (current.length === 0) return { ok: false, error: `${def.label} ${id} not found` };
  const oldValue = readRowColumn(current[0]! as Record<string, unknown>, col.column);

  await db
    .update(def.table)
    .set(toDrizzlePatch(def.key, { [col.column]: url, updated_at: at }) as never)
    .where(eq(idColumn(def.table), id));

  // The image (R2) and column (D1) are already persisted above. postWrite only fans out
  // best-effort side effects (audit, cache purge, PDF re-render).
  // Never let those reject the upload — that failure was reported as "an unexpected
  // response was received from the server" while the image had actually saved.
  try {
    await postWrite(db, def.key, id, [
      {
        entity: def.key,
        entityId: id,
        field,
        action: 'upload_image',
        oldValue: toStr(oldValue),
        newValue: url,
        actor,
      },
    ]);
  } catch (e) {
    console.error('uploadImage postWrite failed (image already saved):', e);
  }

  revalidatePath(`/${def.segment}/${id}`);
  return { ok: true, url };
}

// =============================================================================
// uploadBlockImage — upload a JSON-block image to R2 and return the stable url WITHOUT
// writing a DB column. The jsonBlocks editor stores the returned url as the block
// value, then saveCityBlocks persists the whole object. Key = <entity>/<id>/<slot>-<file>.
// Used for cities copy/venue image keys (live_in_image, *_image, image_0, …).
// =============================================================================

export async function uploadBlockImage(
  entity: string,
  id: string,
  slot: string,
  file: File
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const def = resolveEntity(entity);
  if (!def) return { ok: false, error: `Unknown entity: ${entity}` };
  if (!id) return { ok: false, error: 'Missing record id' };
  if (!file || file.size === 0) return { ok: false, error: 'Empty file' };

  try {
    await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const env = getCloudflareContext().env;
  const safeSlot = sanitizeFilename(slot) || 'block';
  const safeName = sanitizeFilename(file.name);
  const key = `${def.key}/${id}/${safeSlot}-${safeName}`;

  await env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  const base = (env.IMAGES_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const url = `${base}/${key}`;
  if (url.includes('airtableusercontent.com')) {
    return { ok: false, error: 'Refusing to store an Airtable attachment URL' };
  }
  return { ok: true, url };
}

// =============================================================================
// uploadGalleryImage — upload one image to R2, returning its stable url WITHOUT
// immediately writing a DB column.  The ImageGalleryEditor accumulates uploaded
// URLs client-side and stores the entire JSON array via the normal saveEntity
// form submit (photo_gallery_json column).  Key = <entity>/<id>/gallery-<index>-<file>.
// =============================================================================

export async function uploadGalleryImage(
  entity: string,
  id: string,
  index: number,
  file: File
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const def = resolveEntity(entity);
  if (!def) return { ok: false, error: `Unknown entity: ${entity}` };
  if (!id) return { ok: false, error: 'Missing record id' };
  if (!file || file.size === 0) return { ok: false, error: 'Empty file' };

  try {
    await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const env = getCloudflareContext().env;
  const safeName = sanitizeFilename(file.name);
  const key = `${def.key}/${id}/gallery-${index}-${safeName}`;

  await env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  const base = (env.IMAGES_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const url = `${base}/${key}`;
  if (url.includes('airtableusercontent.com')) {
    return { ok: false, error: 'Refusing to store an Airtable attachment URL' };
  }
  return { ok: true, url };
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned || `upload-${Date.now()}`;
}

// =============================================================================
// JSON-column editors — emit the EXACT shapes the public API (esperanza-api) expects.
//
//   cities.city_copy_blocks_json  → flat { key -> value } object
//   cities.city_venue_blocks_json → flat { key -> value } object
//   communities.hoa_links_json    → array of { title, link }
//
// We assemble + JSON.stringify here (server-side) so a malformed client payload can't
// corrupt the shape. Blank/empty entries are dropped (the mapper drops absent keys).
// =============================================================================

/** cities: write both JSON block objects (flat key→value). */
export async function saveCityBlocks(
  id: string,
  copyBlocks: Record<string, string>,
  venueBlocks: Record<string, string>
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: 'Missing city id' };
  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const dropEmpty = (o: Record<string, string>): Record<string, string> =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && String(v).trim() !== ''));

  const copyJson = JSON.stringify(dropEmpty(copyBlocks));
  const venueJson = JSON.stringify(dropEmpty(venueBlocks));

  const { db } = getDb();
  const at = new Date().toISOString();
  const current = await db.select().from(cities).where(eq(cities.id, id)).limit(1);
  if (current.length === 0) return { ok: false, error: `City ${id} not found` };
  const prev = current[0]! as Record<string, unknown>;

  await db
    .update(cities)
    .set({ cityCopyBlocksJson: copyJson, cityVenueBlocksJson: venueJson, updatedAt: at })
    .where(eq(cities.id, id));

  await postWrite(db, 'cities', id, [
    {
      entity: 'cities',
      entityId: id,
      field: 'city_copy_blocks_json',
      action: 'update',
      oldValue: toStr(prev['city_copy_blocks_json']),
      newValue: copyJson,
      actor,
    },
    {
      entity: 'cities',
      entityId: id,
      field: 'city_venue_blocks_json',
      action: 'update',
      oldValue: toStr(prev['city_venue_blocks_json']),
      newValue: venueJson,
      actor,
    },
  ]);

  revalidatePath(`/cities/${id}`);
  return { ok: true };
}

/** communities: write hoa_links_json as an array of {title, link}. */
export async function saveCommunityHoaLinks(
  id: string,
  links: Array<{ title: string; link: string }>
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: 'Missing community id' };
  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  // Drop rows with no title AND no link; keep the {title, link} shape exactly.
  const cleaned = links
    .map((l) => ({ title: (l.title ?? '').trim(), link: (l.link ?? '').trim() }))
    .filter((l) => l.title !== '' || l.link !== '');
  const json = JSON.stringify(cleaned);

  const { db } = getDb();
  const at = new Date().toISOString();
  const current = await db.select().from(communities).where(eq(communities.id, id)).limit(1);
  if (current.length === 0) return { ok: false, error: `Community ${id} not found` };
  const prev = current[0]! as Record<string, unknown>;

  const prevJson = toStr(prev['hoa_links_json']) ?? '[]';
  if (prevJson === json) return { ok: true };

  await db.update(communities).set({ hoaLinksJson: json, updatedAt: at }).where(eq(communities.id, id));

  await postWrite(db, 'communities', id, [
    {
      entity: 'communities',
      entityId: id,
      field: 'hoa_links_json',
      action: 'update',
      oldValue: toStr(prev['hoa_links_json']),
      newValue: json,
      actor,
    },
  ]);

  revalidatePath(`/communities/${id}`);
  return { ok: true };
}

// =============================================================================
// DIGITAL ASSET MANAGER (images library) actions.
//
// The IMAGES section is a DAM: operators upload a file and an images row is created
// whose file_url points at the STABLE r2.dev asset — they never type or see a URL.
//
// createImageAsset composes the EXISTING primitives in one server round-trip so the
// upload dropzone can create + populate a row atomically:
//   (1) INSERT a fresh `images` row (id prefixed `adm`, like createEntity),
//   (2) PUT the file to R2 IMAGES at images/<id>/<filename>,
//   (3) UPDATE the row's file_url to the stable r2.dev url,
//   (4) audit_log (create + upload_image) + public-cache purge, then revalidate.
// It obeys every write-contract clause: getCurrentUser() attribution, getDb()
// first-primary session, postWrite() audit+purge, and it REJECTS airtable urls.
// =============================================================================

export async function createImageAsset(
  formData: FormData
): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Empty file' };
  }

  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const env = getCloudflareContext().env;
  const { db } = getDb();
  const at = new Date().toISOString();
  const id = `adm${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;

  const safeName = sanitizeFilename(file.name);
  const key = `images/${id}/${safeName}`;
  const base = (env.IMAGES_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const url = `${base}/${key}`;
  // Stable R2 url only — an Airtable attachment host must never be stored.
  if (url.includes('airtableusercontent.com')) {
    return { ok: false, error: 'Refusing to store an Airtable attachment URL' };
  }

  // (1) insert the row with the file_url + a default slug derived from the filename.
  const slug = safeName.replace(/\.[^.]+$/, '') || id;
  await db
    .insert(images)
    .values(
      toDrizzlePatch('images', {
        id,
        slug,
        file_url: url,
        created_at: at,
        updated_at: at,
      }) as never
    );

  // (2) store the asset in R2.
  await env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  // (3)+(4) audit (create + upload_image) and purge the public cache.
  await postWrite(db, 'images', id, [
    {
      entity: 'images',
      entityId: id,
      field: null,
      action: 'create',
      oldValue: null,
      newValue: id,
      actor,
    },
    {
      entity: 'images',
      entityId: id,
      field: 'file_url',
      action: 'upload_image',
      oldValue: null,
      newValue: url,
      actor,
    },
  ]);

  revalidatePath('/images');
  return { ok: true, id, url };
}

// =============================================================================
// deleteImageAsset — remove an images library row (and its R2 object, best-effort).
// Audits a `delete` row and purges the public cache.
// =============================================================================

export async function deleteImageAsset(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!id) return { ok: false, error: 'Missing image id' };

  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const { db } = getDb();
  const current = await db.select().from(images).where(eq(images.id, id)).limit(1);
  if (current.length === 0) return { ok: false, error: `Image ${id} not found` };
  const oldUrl = toStr((current[0]! as Record<string, unknown>)['file_url']);

  // Best-effort delete of the R2 object (keyed images/<id>/<file>). We derive the key
  // from the stored stable url; failures here don't block the row delete.
  const env = getCloudflareContext().env;
  const base = (env.IMAGES_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (oldUrl && base && oldUrl.startsWith(base + '/')) {
    const key = oldUrl.slice(base.length + 1);
    try {
      await env.IMAGES.delete(key);
    } catch {
      // ignore — the DB row is the source of truth; orphan objects are harmless.
    }
  }

  await db.delete(images).where(eq(images.id, id));

  await postWrite(
    db,
    'images',
    id,
    [
      {
        entity: 'images',
        entityId: id,
        field: null,
        action: 'delete',
        oldValue: oldUrl,
        newValue: null,
        actor,
      },
    ],
    { rebuild: 'immediate' }
  );

  revalidatePath('/images');
  return { ok: true };
}

// =============================================================================
// FIELD BUILDER — field_definitions CRUD + reorder.
//
// These ADD to the write path. Each obeys the in-repo write conventions:
//   (1) gate on the Auth.js session role === 'admin' (Full-Admin only; isAdmin()),
//   (2) attribute via getCurrentUser() and write an audit_log row for the change,
//   (3) write D1 via the PRIMARY session (getDb → read-your-writes).
//
// Safety invariants (validated here AND in lib/field-builder.ts):
//   • SYSTEM fields are immutable in key/type and cannot be deleted (reorder/relabel/
//     group/visibility/half-width ARE allowed).
//   • Custom keys are safe snake_case, unique per entity, and never collide with a real
//     column / reserved name / existing field key.
//   • Only the v1 field types are creatable (bespoke widgets are system-only).
// The `entity` audited is `field_definitions:<entity>` so registry edits are
// distinguishable from record edits in the audit_log; `field` is the field key.
// =============================================================================

type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const AUDIT_REGISTRY = 'field_definitions';

/** Resolve {actor} after confirming Full-Admin; returns an error result otherwise. */
async function requireAdmin(): Promise<{ ok: true; actor: string } | { ok: false; error: string }> {
  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }
  if (!(await isAdmin())) {
    return { ok: false, error: 'Forbidden: Field Builder requires Full Admin.' };
  }
  return { ok: true, actor };
}

/** Audit a registry change and revalidate the builder page for the entity. */
async function postFieldWrite(
  db: Db,
  entity: EntityKey,
  fieldKey: string | null,
  action: string,
  oldValue: string | null,
  newValue: string | null,
  actor: string
): Promise<void> {
  const row: NewAuditLogRow = {
    entity: `${AUDIT_REGISTRY}:${entity}`,
    entityId: fieldKey ?? entity,
    field: fieldKey,
    action,
    oldValue,
    newValue,
    actor,
  };
  await db.insert(auditLog).values([row]);
}

export interface CreateFieldInput {
  entity: string;
  label: string;
  type: string;
  /** explicit key (optional — generated from the label when omitted). */
  key?: string;
  help?: string | null;
  groupLabel?: string | null;
  required?: boolean;
  visibleInForm?: boolean;
  visibleInList?: boolean;
  halfWidth?: boolean;
  /** {value,label}[] for a `select`; ignored for other types. */
  options?: Array<{ value: string; label: string }> | string[];
}

/**
 * Create a custom (non-system) field for an entity. Generates a safe snake_case key
 * (unique per entity) when none is supplied, validates the type + key, appends it after
 * the entity's current fields (sort = max+1), and audits a `field_create`.
 */
export async function createFieldDefinition(
  input: CreateFieldInput
): Promise<ActionResult<{ id: string; key: string }>> {
  const def = getEntity(input.entity);
  if (!def) return { ok: false, error: `Unknown entity: ${input.entity}` };

  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const { actor } = gate;

  const label = (input.label ?? '').trim();
  if (label === '') return { ok: false, error: 'Label is required' };

  const type = String(input.type ?? '');
  if (!isFieldType(type)) {
    return { ok: false, error: `Invalid field type: ${type}` };
  }

  const { db } = getDb();

  // Existing keys for the entity + the entity's reserved/real-column key set.
  const existing = (await db
    .select()
    .from(fieldDefinitions)
    .where(eq(fieldDefinitions.entity, def.key))
    .orderBy(asc(fieldDefinitions.sort))) as FieldDefinition[];
  const taken = reservedKeysForEntity(def.key);
  for (const r of existing) taken.add(r.key);

  // Resolve the key: explicit (validated) or generated from the label.
  let key: string;
  if (input.key && input.key.trim() !== '') {
    key = input.key.trim();
    if (!isValidKeyShape(key)) {
      return { ok: false, error: `Invalid key "${key}" — use lower snake_case (a–z, 0–9, _).` };
    }
    if (taken.has(key)) {
      return { ok: false, error: `Key "${key}" is reserved or already in use for ${def.label}.` };
    }
  } else {
    key = generateFieldKey(label, taken);
  }

  const optionsJson =
    type === 'select' ? JSON.stringify(normalizeOptions(input.options)) : null;

  const maxSort = existing.reduce((m, r) => Math.max(m, r.sort), -1);
  const id = `${def.key}__${key}`;
  const row: NewFieldDefinition = {
    id,
    entity: def.key,
    key,
    label,
    help: input.help?.trim() ? input.help.trim() : null,
    groupLabel: input.groupLabel?.trim() ? input.groupLabel.trim() : null,
    sort: maxSort + 1,
    type,
    optionsJson,
    required: Boolean(input.required),
    system: false, // builder-created fields are never system
    visibleInForm: input.visibleInForm ?? true,
    visibleInList: Boolean(input.visibleInList),
    halfWidth: Boolean(input.halfWidth),
  };

  await db.insert(fieldDefinitions).values(row);
  await postFieldWrite(db, def.key, key, 'field_create', null, `${type}:${label}`, actor);

  revalidatePath('/settings/fields');
  revalidatePath(`/${def.segment}`);
  return { ok: true, id, key };
}

export interface UpdateFieldInput {
  id: string;
  /** Presentation/visibility edits — all optional (only provided keys change). */
  label?: string;
  help?: string | null;
  groupLabel?: string | null;
  required?: boolean;
  visibleInForm?: boolean;
  visibleInList?: boolean;
  halfWidth?: boolean;
  /** retype — ALLOWED for custom fields only; rejected for system fields. */
  type?: string;
  /** select options — only honored when the (resulting) type is `select`. */
  options?: Array<{ value: string; label: string }> | string[];
}

/**
 * Update a field definition. SYSTEM fields may only have label/help/group/visibility/
 * half-width changed (key/type are immutable, and they can't be deleted). CUSTOM fields
 * may additionally retype + edit options. Audits a `field_update` with a compact diff.
 */
export async function updateFieldDefinition(input: UpdateFieldInput): Promise<ActionResult> {
  if (!input.id) return { ok: false, error: 'Missing field id' };

  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const { actor } = gate;

  const { db } = getDb();
  const rows = (await db
    .select()
    .from(fieldDefinitions)
    .where(eq(fieldDefinitions.id, input.id))
    .limit(1)) as FieldDefinition[];
  if (rows.length === 0) return { ok: false, error: `Field ${input.id} not found` };
  const cur = rows[0]!;
  const entity = cur.entity as EntityKey;

  const patch: Partial<NewFieldDefinition> = {};
  const changed: string[] = [];

  if (input.label !== undefined) {
    const label = input.label.trim();
    if (label === '') return { ok: false, error: 'Label cannot be blank' };
    if (label !== cur.label) {
      patch.label = label;
      changed.push('label');
    }
  }
  if (input.help !== undefined) {
    const help = input.help && input.help.trim() ? input.help.trim() : null;
    if (help !== cur.help) {
      patch.help = help;
      changed.push('help');
    }
  }
  if (input.groupLabel !== undefined) {
    const g = input.groupLabel && input.groupLabel.trim() ? input.groupLabel.trim() : null;
    if (g !== cur.groupLabel) {
      patch.groupLabel = g;
      changed.push('group');
    }
  }
  if (input.required !== undefined && Boolean(input.required) !== cur.required) {
    patch.required = Boolean(input.required);
    changed.push('required');
  }
  if (input.visibleInForm !== undefined && Boolean(input.visibleInForm) !== cur.visibleInForm) {
    patch.visibleInForm = Boolean(input.visibleInForm);
    changed.push('visibleInForm');
  }
  if (input.visibleInList !== undefined && Boolean(input.visibleInList) !== cur.visibleInList) {
    patch.visibleInList = Boolean(input.visibleInList);
    changed.push('visibleInList');
  }
  if (input.halfWidth !== undefined && Boolean(input.halfWidth) !== cur.halfWidth) {
    patch.halfWidth = Boolean(input.halfWidth);
    changed.push('halfWidth');
  }

  // RETYPE — system fields are immutable in type; custom fields may retype to a v1 type.
  let effectiveType = cur.type;
  if (input.type !== undefined && input.type !== cur.type) {
    if (cur.system) {
      return { ok: false, error: 'System fields cannot be retyped.' };
    }
    if (!isFieldType(input.type)) {
      return { ok: false, error: `Invalid field type: ${input.type}` };
    }
    patch.type = input.type;
    effectiveType = input.type;
    changed.push('type');
  }

  // OPTIONS — only meaningful for select. Editing options on a system field is allowed
  // only if it's already a select with static options (none are today); otherwise it's a
  // no-op. For custom selects this is the canonical options editor path.
  if (input.options !== undefined && effectiveType === 'select') {
    const optionsJson = JSON.stringify(normalizeOptions(input.options));
    // Compare against the current value normalized to '[]' when NULL/blank, so re-saving
    // the same options is a no-op.
    if (optionsJson !== (cur.optionsJson ?? '[]')) {
      patch.optionsJson = optionsJson;
      changed.push('options');
    }
  }
  // If a field is retyped AWAY from select, drop stale options.
  if (effectiveType !== 'select' && cur.optionsJson) {
    patch.optionsJson = null;
    if (!changed.includes('options')) changed.push('options');
  }

  if (changed.length === 0) return { ok: true }; // no-op

  patch.updatedAt = new Date().toISOString();
  await db.update(fieldDefinitions).set(patch).where(eq(fieldDefinitions.id, input.id));
  await postFieldWrite(
    db,
    entity,
    cur.key,
    'field_update',
    null,
    changed.join(','),
    actor
  );

  revalidatePath('/settings/fields');
  const ent = getEntity(entity);
  if (ent) revalidatePath(`/${ent.segment}`);
  return { ok: true };
}

/**
 * Delete a CUSTOM field definition. SYSTEM fields can NEVER be deleted. The stored
 * custom_fields VALUES on existing rows are intentionally left in place (harmless orphan
 * JSON keys); removing the registry row is enough to stop rendering/collecting the field.
 * Audits a `field_delete`.
 */
export async function deleteFieldDefinition(id: string): Promise<ActionResult> {
  if (!id) return { ok: false, error: 'Missing field id' };

  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const { actor } = gate;

  const { db } = getDb();
  const rows = (await db
    .select()
    .from(fieldDefinitions)
    .where(eq(fieldDefinitions.id, id))
    .limit(1)) as FieldDefinition[];
  if (rows.length === 0) return { ok: false, error: `Field ${id} not found` };
  const cur = rows[0]!;
  if (cur.system) {
    return { ok: false, error: 'System fields cannot be deleted.' };
  }
  const entity = cur.entity as EntityKey;

  await db.delete(fieldDefinitions).where(eq(fieldDefinitions.id, id));
  await postFieldWrite(db, entity, cur.key, 'field_delete', `${cur.type}:${cur.label}`, null, actor);

  revalidatePath('/settings/fields');
  const ent = getEntity(entity);
  if (ent) revalidatePath(`/${ent.segment}`);
  return { ok: true };
}

export interface ReorderItem {
  id: string;
  sort: number;
  /** assign/move to a section (NULL clears the group). */
  groupLabel?: string | null;
}

/**
 * Reorder (and re-group) an entity's fields in one shot: set `sort` + `group_label` for
 * each item. Reordering/regrouping is allowed for ALL fields (including system ones — the
 * spec permits reorder/group on synced fields). Items must all belong to `entity`. Audits
 * a single `field_reorder` summarizing the new order.
 */
export async function reorderFieldDefinitions(
  entity: string,
  items: ReorderItem[]
): Promise<ActionResult> {
  const def = getEntity(entity);
  if (!def) return { ok: false, error: `Unknown entity: ${entity}` };
  if (!Array.isArray(items) || items.length === 0) return { ok: true };

  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const { actor } = gate;

  const { db } = getDb();
  // Validate every id belongs to this entity (no cross-entity writes).
  const rows = (await db
    .select()
    .from(fieldDefinitions)
    .where(eq(fieldDefinitions.entity, def.key))) as FieldDefinition[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const it of items) {
    if (!byId.has(it.id)) {
      return { ok: false, error: `Field ${it.id} does not belong to ${def.label}` };
    }
  }

  const at = new Date().toISOString();
  for (const it of items) {
    const cur = byId.get(it.id)!;
    const group =
      it.groupLabel === undefined
        ? cur.groupLabel
        : it.groupLabel && it.groupLabel.trim()
          ? it.groupLabel.trim()
          : null;
    // Skip if nothing actually changed for this row.
    if (cur.sort === it.sort && (cur.groupLabel ?? null) === (group ?? null)) continue;
    await db
      .update(fieldDefinitions)
      .set({ sort: it.sort, groupLabel: group ?? null, updatedAt: at })
      .where(and(eq(fieldDefinitions.id, it.id), eq(fieldDefinitions.entity, def.key)));
  }

  const summary = [...items]
    .sort((a, b) => a.sort - b.sort)
    .map((it) => byId.get(it.id)?.key ?? it.id)
    .join(',');
  await postFieldWrite(db, def.key, null, 'field_reorder', null, summary, actor);

  revalidatePath('/settings/fields');
  revalidatePath(`/${def.segment}`);
  return { ok: true };
}

// =============================================================================
// SYNC NOW — triggerIngestSync.
//
// Dashboard "Sync now" button (client feedback 2026-06-10: editors wanted a
// manual trigger instead of waiting on the schedule). Calls the ingest worker's
// POST /run (lib/ingest-client.ts), which runs the same Snowflake→D1
// reconciliation as the 4-hour cron. The public read path reads D1 directly (via
// esperanza-api), so a synced write is live as soon as the cache TTL clears — no
// extra publish step. Any signed-in editor may run it — it's the same
// reconciliation the cron runs unattended, just sooner.
// =============================================================================

export async function triggerIngestSync(): Promise<
  { ok: true; skipped?: string } | { ok: false; error: string }
> {
  try {
    await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  const env = getCloudflareContext().env as unknown as import('./ingest-client').IngestEnv;
  let run: import('./ingest-client').IngestRunResponse;
  try {
    const { postIngestRun } = await import('./ingest-client');
    run = await postIngestRun(env);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sync failed' };
  }

  // A run that declined because another one holds the sync_lock returns HTTP 200
  // with { skipped }. This used to be discarded, so the button reported "Synced
  // from Mark Systems" for a run that did no work. Pass it through.
  if (run.skipped) return { ok: true, skipped: run.skipped };

  // The reconciliation may have touched any entity; refresh the worklist + lists.
  revalidatePath('/');
  return { ok: true };
}

// =============================================================================
// SITE SETTINGS — saveSiteSettings (migration 0013).
//
// Company-wide values the marketing team adjusts on a schedule — today that's
// the Mortgage Rate (%), reviewed biweekly, which the mortgage calculators on
// community / QMI / financing pages fetch from the api worker's
// GET /api/public/settings. Saving here updates D1, writes an audit_log row per
// changed key, and purges the api worker's edge cache so the new rate is live
// site-wide within moments (calculators fetch on page load).
// Any signed-in editor may save — these are content values, like prices.
// =============================================================================

const SITE_SETTING_KEYS = ['mortgage_rate', 'incentive_rate'] as const;
// Keys validated as a percentage (0 < n < 25). Both the standard mortgage rate and
// the promotional incentive rate drive the QMI card / calculator payment figures.
const RATE_SETTING_KEYS = new Set<string>(['mortgage_rate', 'incentive_rate']);
const RATE_SETTING_LABELS: Record<string, string> = {
  mortgage_rate: 'Mortgage Rate',
  incentive_rate: 'Incentive Rate',
};

export async function saveSiteSettings(
  values: Record<string, string>
): Promise<{ ok: true } | { ok: false; error: string }> {
  let actor: string;
  try {
    actor = await getCurrentUser();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not authenticated' };
  }

  // Allow-list keys; validate the rate is a sane percentage.
  const writes: Array<{ key: string; value: string }> = [];
  for (const key of SITE_SETTING_KEYS) {
    if (!(key in values)) continue;
    const raw = String(values[key] ?? '').trim();
    if (RATE_SETTING_KEYS.has(key)) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n >= 25) {
        const label = RATE_SETTING_LABELS[key] ?? key;
        return { ok: false, error: `${label} must be a percentage between 0 and 25 (e.g. 6.15).` };
      }
      writes.push({ key, value: String(n) });
    } else {
      writes.push({ key, value: raw });
    }
  }
  if (writes.length === 0) return { ok: false, error: 'Nothing to save.' };

  const { db } = getDb();
  const at = new Date().toISOString();
  for (const w of writes) {
    const prev = await db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(eq(siteSettings.key, w.key));
    const old = prev[0]?.value ?? null;
    if (old === w.value) continue; // no-op: skip write + audit spam

    await db
      .insert(siteSettings)
      .values({ key: w.key, value: w.value, updatedBy: actor, updatedAt: at })
      .onConflictDoUpdate({
        target: siteSettings.key,
        set: { value: w.value, updatedBy: actor, updatedAt: at },
      });
    await db.insert(auditLog).values({
      entity: 'site_settings',
      entityId: w.key,
      field: w.key,
      action: 'update',
      oldValue: old,
      newValue: w.value,
      actor,
      at,
    } as NewAuditLogRow);
  }

  // Purge the api worker's edge cache so calculators pick the new value up on the
  // next page load instead of after the 5-minute TTL. Best-effort: a purge failure
  // must not fail the save (the TTL is the backstop).
  try {
    const env = getCloudflareContext().env as Parameters<typeof purgePublicCache>[0];
    await purgePublicCache(env, 'settings');
  } catch {
    /* TTL backstop */
  }

  revalidatePath('/settings/site');
  return { ok: true };
}
