export class BadCollection extends Error {}

// Allowlist: public collection name → normalized D1 view.
export const READ_COLLECTIONS: Record<string, string> = {
  qmi: 'v_public_qmi',
  communities: 'v_public_communities',
  floor_plans: 'v_public_floor_plans',
  cities: 'v_public_cities',
  blogs: 'v_public_blogs',
  collections: 'v_public_collections',
  testimonials: 'v_public_testimonials',
};

// Clamp caller-supplied paging so a read-tier token can't request a full-view
// scan (limit=1e6) or an O(offset) deep page. 200 covers every real caller.
const MAX_LIMIT = 200;
const MAX_OFFSET = 10_000;
function clampLimit(limit: number): number {
  return Math.min(Math.max(1, Math.floor(limit) || 1), MAX_LIMIT);
}
function clampOffset(offset: number): number {
  return Math.min(Math.max(0, Math.floor(offset) || 0), MAX_OFFSET);
}

export async function syncStatus(db: D1Database, source?: string, limit = 20) {
  limit = clampLimit(limit);
  const sql = source
    ? `SELECT * FROM sync_log WHERE source = ? ORDER BY at DESC LIMIT ?`
    : `SELECT * FROM sync_log ORDER BY at DESC LIMIT ?`;
  const stmt = source ? db.prepare(sql).bind(source, limit) : db.prepare(sql).bind(limit);
  const { results } = await stmt.all<Record<string, unknown>>();
  return results;
}

export async function recentChanges(db: D1Database, entity?: string, limit = 50) {
  limit = clampLimit(limit);
  const sql = entity
    ? `SELECT * FROM audit_log WHERE entity = ? ORDER BY at DESC LIMIT ?`
    : `SELECT * FROM audit_log ORDER BY at DESC LIMIT ?`;
  const stmt = entity ? db.prepare(sql).bind(entity, limit) : db.prepare(sql).bind(limit);
  const { results } = await stmt.all<Record<string, unknown>>();
  return results;
}

function viewFor(collection: string): string {
  const view = READ_COLLECTIONS[collection];
  if (!view) throw new BadCollection(`Unknown collection: ${collection}`);
  return view;
}

export async function getRecord(db: D1Database, collection: string, id: string) {
  const view = viewFor(collection);
  return db.prepare(`SELECT * FROM ${view} WHERE id = ? LIMIT 1`).bind(id).first<Record<string, unknown>>();
}

export async function listRecords(db: D1Database, collection: string, limit = 50, offset = 0) {
  limit = clampLimit(limit);
  offset = clampOffset(offset);
  const view = viewFor(collection);
  const { results } = await db
    .prepare(`SELECT * FROM ${view} ORDER BY id LIMIT ? OFFSET ?`)
    .bind(limit, offset)
    .all<Record<string, unknown>>();
  return results;
}
