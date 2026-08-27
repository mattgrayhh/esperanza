// =============================================================================
// packages/admin — shared formatting for the audit_log "activity" surfaces.
//
// Pure, framework-free helpers used by BOTH the dashboard (app/page.tsx) and the
// full activity log (app/activity/page.tsx). They turn raw audit rows — snake_case
// field names, terse action codes, email actors — into human phrases, and collapse
// runs of same-actor/same-entity/same-day edits into single lines.
// =============================================================================

import { ENTITY_LIST, type EntityKey } from './entities';

export interface AuditRow {
  entity: string;
  field: string | null;
  action: string;
  actor: string | null;
  at: string;
}

export interface ActivityGroup {
  entity: string;
  action: string;
  actor: string | null;
  field: string | null;
  count: number;
  at: string; // newest in the run
}

export function entityLabel(key: string): string {
  if (key.startsWith('field_definitions')) return 'Field settings';
  return ENTITY_LIST.find((e) => e.key === key)?.label ?? key;
}

export function entitySegment(key: string): string | null {
  return ENTITY_LIST.find((e) => e.key === key)?.segment ?? null;
}

export function entityKeyOf(key: string): EntityKey | null {
  return ENTITY_LIST.find((e) => e.key === key)?.key ?? null;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// snake_case column → human label. Strips the _url suffix, spaces the rest, and
// fixes the acronyms that would otherwise read as "Pdf" / "Url".
export function prettyField(field: string | null): string | null {
  if (!field) return null;
  let s = field.replace(/_url$/i, '').replace(/_/g, ' ').trim();
  if (!s) return null;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.replace(/\bpdf\b/gi, 'PDF').replace(/\burl\b/gi, 'URL');
}

export function actorName(actor: string | null): string {
  if (!actor) return 'System';
  if (actor === 'ingest') return 'Snowflake sync';
  // Machine flips of `published`. Before these existed the ingest wrote only sync_log,
  // so a machine-published or removed home showed no actor anywhere in the admin and
  // editors could not tell why its publication state changed (2026-07-28).
  if (actor === 'ingest-autopublish') return 'Snowflake sync (auto-publish)';
  if (actor === 'ingest-snowflake-departure') return 'Snowflake sync (removed from feed)';
  if (actor === 'readiness-reconcile') return 'Readiness cleanup';
  if (actor === 'cron') return 'Scheduled job';
  return actor.split('@')[0] ?? actor;
}

// Rows must arrive newest-first. Collapse runs of the same (entity, action, actor)
// within a single day into one group.
export function groupActivity(rows: AuditRow[]): ActivityGroup[] {
  const out: ActivityGroup[] = [];
  for (const r of rows) {
    const day = r.at.slice(0, 10);
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.entity === r.entity &&
      prev.action === r.action &&
      prev.actor === r.actor &&
      prev.at.slice(0, 10) === day
    ) {
      prev.count += 1;
    } else {
      out.push({ entity: r.entity, action: r.action, actor: r.actor, field: r.field, count: 1, at: r.at });
    }
  }
  return out;
}

export function activityPhrase(g: ActivityGroup): string {
  const f = prettyField(g.field);
  switch (g.action) {
    case 'upload_image':
      return g.count > 1 ? `Updated ${g.count} images` : `Updated ${f ? f.toLowerCase() : 'an image'}`;
    case 'create':
      return g.count > 1 ? `Created ${g.count} records` : 'Created a record';
    case 'update':
      return g.count > 1 ? `Edited ${g.count} fields` : f ? `Edited ${f.toLowerCase()}` : 'Edited a field';
    case 'publish':
      return g.count > 1 ? `Published ${g.count} records` : 'Published';
    case 'unpublish':
      return g.count > 1 ? `Unpublished ${g.count} records` : 'Unpublished';
    case 'override_set':
      return f ? `Overrode ${f.toLowerCase()}` : 'Set an override';
    case 'override_revert':
      return f ? `Reverted ${f.toLowerCase()} to synced` : 'Reverted an override';
    case 'field_update':
      return g.count > 1 ? `Changed ${g.count} fields` : 'Changed a field';
    case 'field_delete':
      return g.count > 1 ? `Removed ${g.count} fields` : 'Removed a field';
    case 'field_reorder':
      return 'Reordered fields';
    default: {
      const phrase = g.action.replace(/_/g, ' ');
      return phrase.charAt(0).toUpperCase() + phrase.slice(1);
    }
  }
}
