// =============================================================================
// esperanza-cf — Field Builder Phase A seed.
//
// Populates field_definitions (migration 0002) from TODAY'S static admin field
// config (packages/admin/lib/field-config.ts + lib/entities.ts) so the data-driven
// engine renders EXACTLY the same fields/widgets/order it does now. One row per
// existing field, per entity. Idempotent on UNIQUE(entity, key): re-running upserts.
//
// We IMPORT the real FIELD_CONFIG / ENTITY_LIST objects (the single source of truth)
// rather than text-parsing the file — same enumeration the admin engine uses, so
// the seed can never drift from what the admin renders.
//
// Maps each config field to the Phase-A field_definitions shape:
//   type            — current widget → field-builder type (text/long/rich/number/
//                     currency/bool/date/url/image/select). Bespoke widgets
//                     (syncedOverride/hoaLinks/jsonBlocks/promoScopeTag) are stored
//                     verbatim so nothing is lost; they're flagged system.
//   system          — 1 for Snowflake-synced / locked fields:
//                       · QMI override-routed fields (price/beds/baths/sqft/address/
//                         postal/elevation/construction_stage/links — the synced_/
//                         override_ write-set) and the publish gate,
//                       · communities.square_footage_range (synced),
//                       · cities synced counts (community/move-in/floor-plans),
//                     0 for plain marketing-authored fields.
//   sort            — the field's index in the current config order.
//   half_width      — per the config's halfWidth flag.
//   visible_in_form — 1 for every seeded field (matches today: the engine renders
//                     them all; the publish-gate is still seeded but rendered as the
//                     header toggle, exactly as now).
//   visible_in_list — 1 iff the field's column appears in that entity's listColumns.
//   options_json    — JSON array for static select options (testimonials.status).
//
// Usage:
//   tsx scripts/seed-field-definitions.ts            (local D1, default)
//   tsx scripts/seed-field-definitions.ts --remote   (remote/prod D1)
//   tsx scripts/seed-field-definitions.ts --dry-run  (print SQL, execute nothing)
// =============================================================================

import { FIELD_CONFIG } from '../../admin/lib/field-config';
import type { Bucket, Widget, ListColumn, FieldConfig } from '../../admin/lib/field-config';
import { ENTITY_LIST, type EntityKey } from '../../admin/lib/entities';
import { QMI_OVERRIDABLE_FIELDS } from '../lib/override';
import { parseArgs, getMode, n } from './lib/cli';
import { D1Sink, buildUpsert } from './lib/d1';

// ── widget → field-builder type ────────────────────────────────────────────
// v1 set: text · long · rich · number · currency · bool · date · url · image · select.
// Bespoke widgets are kept verbatim (not in v1) so the registry round-trips them.
type FieldType =
  | 'text'
  | 'long'
  | 'rich'
  | 'number'
  | 'currency'
  | 'bool'
  | 'date'
  | 'url'
  | 'image'
  | 'select'
  // bespoke widgets (preserved as-is; Phase B/C own their treatment)
  | 'syncedOverride'
  | 'hoaLinks'
  | 'jsonBlocks'
  | 'promoScopeTag'
  | 'communityFloorPlans';

function widgetToType(f: FieldConfig): FieldType {
  switch (f.widget) {
    case 'text':
      return 'text';
    case 'textarea':
      return 'long';
    case 'richtext':
      return 'rich';
    case 'number':
      return 'number';
    // The `currency` admin widget (Phase B) maps to the `currency` field-builder type
    // (a numeric type). No static config field uses it today; it's here for exhaustiveness
    // so the widget union and the seed never drift.
    case 'currency':
      return 'currency';
    case 'boolean':
      return 'bool';
    case 'date':
      return 'date';
    case 'image':
      return 'image';
    case 'select':
      return 'select';
    // bespoke widgets — store verbatim
    case 'syncedOverride':
      return 'syncedOverride';
    case 'hoaLinks':
      return 'hoaLinks';
    case 'jsonBlocks':
      return 'jsonBlocks';
    case 'promoScopeTag':
      return 'promoScopeTag';
    case 'communityFloorPlans':
      return 'communityFloorPlans';
    default: {
      const _exhaustive: never = f.widget;
      return _exhaustive;
    }
  }
}

// ── system (locked / synced) flag ───────────────────────────────────────────
// system=1 = the data source is NOT marketing-editable as a free field (Snowflake
// synced, or a publish gate / targeting widget the engine owns). The builder may
// reorder/relabel/group/hide these but not delete/retype them.
const QMI_OVERRIDE_SET = new Set<string>(QMI_OVERRIDABLE_FIELDS);

function isSystemField(entity: EntityKey, f: FieldConfig): boolean {
  // Any explicitly synced (read-only) field is system, on every entity:
  //   communities.square_footage_range, cities synced counts.
  if (f.bucket === 'synced') return true;

  // QMI Snowflake write-set: every synced_/override_ paired field is system-locked
  // (price/beds/baths/sqft/address/postal/elevation/construction_stage/links/ids).
  if (entity === 'qmi' && f.bucket === 'override' && QMI_OVERRIDE_SET.has(f.field)) {
    return true;
  }

  // Everything else (admin/publish/target) is marketing-authored / engine-owned but
  // not a Snowflake source — keep editable (system=0). The publish gate stays
  // system=0: it's the same single boolean the admin already toggles.
  return false;
}

interface SeedRow {
  id: string;
  entity: string;
  key: string;
  label: string;
  help: string | null;
  group_label: string | null;
  sort: number;
  type: string;
  options_json: string | null;
  required: number;
  system: number;
  visible_in_form: number;
  visible_in_list: number;
  half_width: number;
  /** 0 for every static-config field (they map real columns / bespoke widgets). */
  custom: number;
}

function listColumnKeys(listColumns: ListColumn[]): Set<string> {
  return new Set(listColumns.map((c) => c.field));
}

function buildRows(): { rows: SeedRow[]; perEntity: Record<string, number> } {
  const rows: SeedRow[] = [];
  const perEntity: Record<string, number> = {};

  for (const def of ENTITY_LIST) {
    const key = def.key;
    const cfg = FIELD_CONFIG[key];
    const listKeys = listColumnKeys(cfg.listColumns);
    let count = 0;

    cfg.fields.forEach((f: FieldConfig, idx: number) => {
      const type = widgetToType(f);
      const row: SeedRow = {
        id: `${key}__${f.field}`,
        entity: key,
        key: f.field,
        label: f.label,
        help: f.help ?? null,
        group_label: null, // flat Phase-A list; grouping arrives in Phase B
        sort: idx, // preserve the current declared order exactly
        type,
        options_json: f.options ? JSON.stringify(f.options) : null,
        required: 0,
        system: isSystemField(key, f) ? 1 : 0,
        // Every config field is part of today's rendered form (the publish-gate is
        // seeded too; the engine renders it as the header toggle, unchanged).
        visible_in_form: 1,
        visible_in_list: listKeys.has(f.field) ? 1 : 0,
        half_width: f.halfWidth ? 1 : 0,
        custom: 0, // every static-config field maps a real column / bespoke widget
      };
      // The publish-gate (bucket 'publish') is rendered as the detail-header toggle,
      // NOT as a form input — build-edit-view skips it in the form loop. Mark it
      // visible_in_form=0 so a flag-driven engine reproduces today's exact partition
      // (the gate still shows in the header, exactly as now).
      if (f.bucket === 'publish') row.visible_in_form = 0;
      // [P1] redundancy cleanup: a field explicitly flagged `visibleInForm: false` in the
      // static config (e.g. coming_soon / status — the header Status control owns publish
      // state) seeds hidden. Honoring the flag here is what makes the hide DURABLE: the
      // upsert SETs visible_in_form = excluded.visible_in_form, so without this a re-seed
      // (run after every migration) would resurrect the field to visible_in_form = 1.
      if (f.visibleInForm === false) row.visible_in_form = 0;
      rows.push(row);
      count++;
    });

    perEntity[key] = count;
  }

  return { rows, perEntity };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = getMode(args); // 'local' | 'remote'
  const dryRun = args.flags.has('dry-run');

  const { rows, perEntity } = buildRows();

  console.log(
    `Seeding field_definitions → ${mode}${dryRun ? ' (DRY RUN — no writes)' : ''}`
  );
  console.log(`Parsed admin field-config: ${rows.length} fields across ${ENTITY_LIST.length} entities.`);

  const sink = new D1Sink({
    kind: 'wrangler',
    mode,
    dbName: 'esperanza',
    cwd: process.cwd(), // run from packages/db (has wrangler.toml + DB binding)
    dryRun,
  });

  for (const r of rows) {
    // buildUpsert keys on `id` (PRIMARY KEY); `<entity>__<key>` is stable, and the
    // table's UNIQUE(entity,key) guarantees the same row is targeted on re-seed.
    const stmt = buildUpsert('field_definitions', {
      id: r.id,
      entity: r.entity,
      key: r.key,
      label: r.label,
      help: r.help,
      group_label: r.group_label,
      sort: r.sort,
      type: r.type,
      options_json: r.options_json,
      required: r.required,
      system: r.system,
      visible_in_form: r.visible_in_form,
      visible_in_list: r.visible_in_list,
      half_width: r.half_width,
      custom: r.custom,
    });
    sink.add(stmt.sql, stmt.params);
  }

  sink.close();

  console.log('\nRow counts per entity:');
  for (const def of ENTITY_LIST) {
    console.log(`  ${def.key.padEnd(13)} ${String(perEntity[def.key] ?? 0).padStart(3)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(13)} ${String(rows.length).padStart(3)}`);
  console.log(`\n${dryRun ? 'Would upsert' : 'Upserted'} ${n(sink.executed)} statement(s).`);

  if (dryRun) {
    console.log('\n--- first 3 rendered statements ---');
    for (const s of sink.collectedSql.slice(0, 3)) console.log(s);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
