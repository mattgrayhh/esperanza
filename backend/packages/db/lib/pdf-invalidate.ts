// Dependency fanout: given an edited entity, which pdf_renders (by type+entityId) and
// city lists must be marked stale. Injected async resolver `q(sql, binds) => rows[]`
// so the same logic runs against better-sqlite3 (tests) and D1 (admin/ingest).
export type QueryFn = (sql: string, binds: unknown[]) => Promise<any[]>;
export type RenderKey =
  | { type: 'community' | 'qmi' | 'floorplan'; entityId: string }
  | { type: 'list'; citySlug: string };

export async function affectedRenderKeys(q: QueryFn, entity: string, id: string): Promise<RenderKey[]> {
  const keys: RenderKey[] = [];
  const citySlugs = new Set<string>();
  const addCityById = async (cityId?: string | null) => {
    if (!cityId) return;
    const rows = await q(`SELECT slug FROM cities WHERE id=?`, [cityId]);
    const slug = rows[0]?.slug;
    if (slug) citySlugs.add(String(slug));
  };

  if (entity === 'floor_plans') {
    keys.push({ type: 'floorplan', entityId: id });
    const qmis = await q(
      `SELECT id, COALESCE(override_community_id,synced_community_id) comm, COALESCE(override_city_id,synced_city_id) city
         FROM qmi WHERE COALESCE(override_floor_plan_id,synced_floor_plan_id)=? AND published=1`, [id]);
    const comms = new Set<string>();
    for (const r of qmis) { keys.push({ type: 'qmi', entityId: String(r.id) }); if (r.comm) comms.add(String(r.comm)); await addCityById(r.city); }
    for (const c of comms) {
      keys.push({ type: 'community', entityId: c });
      const cr = await q(`SELECT city_id FROM communities WHERE id=?`, [c]);
      await addCityById(cr[0]?.city_id);
    }
  } else if (entity === 'qmi') {
    keys.push({ type: 'qmi', entityId: id });
    const rows = await q(`SELECT COALESCE(override_community_id,synced_community_id) comm, COALESCE(override_city_id,synced_city_id) city FROM qmi WHERE id=?`, [id]);
    const r = rows[0];
    if (r?.comm) {
      keys.push({ type: 'community', entityId: String(r.comm) });
      const cr = await q(`SELECT city_id FROM communities WHERE id=?`, [r.comm]);
      await addCityById(cr[0]?.city_id);
    }
    await addCityById(r?.city);
  } else if (entity === 'communities') {
    keys.push({ type: 'community', entityId: id });
    const cr = await q(`SELECT city_id FROM communities WHERE id=?`, [id]);
    await addCityById(cr[0]?.city_id);
  } else if (entity === 'cities') {
    await addCityById(id);
  }
  // promotions/collections/images/blogs/testimonials → no per-entity PDF → no keys.

  for (const slug of citySlugs) keys.push({ type: 'list', citySlug: slug });
  return keys;
}
