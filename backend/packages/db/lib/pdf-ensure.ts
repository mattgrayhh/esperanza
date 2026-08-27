// Idempotently ensure a pdf_renders row + URL backfill exist for a written entity.
// Slug logic MUST match packages/pdf/src/slug.ts slugFor (community/floorplan: slug||id;
// qmi: slug||housenumber||id; list: <citySlug>-<kind>). r2 key = pdf/<type>/<id>.pdf.
export type QueryFn = (sql: string, binds: unknown[]) => Promise<any[]>;
export type RunFn = (sql: string, binds: unknown[]) => Promise<void>;

const slugify = (s: unknown): string =>
  String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** entity = the admin EntityKey ('communities'|'qmi'|'floor_plans'|'cities'|...). Others no-op. */
export async function ensurePdfRender(query: QueryFn, run: RunFn, entity: string, id: string, baseUrl: string): Promise<void> {
  const url = (type: string, slug: string) => `${baseUrl.replace(/\/$/, '')}/pdf/${type}/${slug}`;
  const citySlugFromId = async (cityId: unknown): Promise<string | null> => {
    if (!cityId) return null;
    const c = (await query(`SELECT slug FROM cities WHERE id=?`, [cityId]))[0];
    return c?.slug ? slugify(c.slug) : null;
  };

  if (entity === 'communities') {
    const r = (await query(`SELECT slug, city_id FROM communities WHERE id=?`, [id]))[0];
    if (!r) return;
    const slug = slugify(r.slug) || slugify(id);
    const citySlug = await citySlugFromId(r.city_id);
    await run(`INSERT OR IGNORE INTO pdf_renders (type,slug,entity_id,city_slug,community_id,r2_key,status) VALUES ('community',?,?,?,?,?, 'not_built')`, [slug, id, citySlug, id, `pdf/community/${id}.pdf`]);
    await run(`UPDATE communities SET brochure_pdf_url=? WHERE id=? AND (brochure_pdf_url IS NULL OR brochure_pdf_url='')`, [url('community', slug), id]);
  } else if (entity === 'qmi') {
    const r = (await query(`SELECT slug, housenumber, COALESCE(override_community_id,synced_community_id) comm, COALESCE(override_city_id,synced_city_id) city FROM qmi WHERE id=?`, [id]))[0];
    if (!r) return;
    const slug = slugify(r.slug) || slugify(r.housenumber) || slugify(id);
    const citySlug = await citySlugFromId(r.city);
    await run(`INSERT OR IGNORE INTO pdf_renders (type,slug,entity_id,city_slug,community_id,r2_key,status) VALUES ('qmi',?,?,?,?,?, 'not_built')`, [slug, id, citySlug, r.comm ?? null, `pdf/qmi/${id}.pdf`]);
    await run(`UPDATE qmi SET dynamic_pdf=? WHERE id=? AND (dynamic_pdf IS NULL OR dynamic_pdf='')`, [url('qmi', slug), id]);
  } else if (entity === 'floor_plans') {
    const r = (await query(`SELECT slug FROM floor_plans WHERE id=?`, [id]))[0];
    if (!r) return;
    const slug = slugify(r.slug) || slugify(id);
    await run(`INSERT OR IGNORE INTO pdf_renders (type,slug,entity_id,r2_key,status) VALUES ('floorplan',?,?,?, 'not_built')`, [slug, id, `pdf/floorplan/${id}.pdf`]);
    await run(`UPDATE floor_plans SET brochure_pdf_url=? WHERE id=? AND (brochure_pdf_url IS NULL OR brochure_pdf_url='')`, [url('floorplan', slug), id]);
  } else if (entity === 'cities') {
    const r = (await query(`SELECT slug FROM cities WHERE id=?`, [id]))[0];
    if (!r?.slug) return;
    const citySlug = slugify(r.slug);
    for (const kind of ['locations', 'qmis', 'plans']) {
      const eid = `list:${citySlug}:${kind}`;
      await run(`INSERT OR IGNORE INTO pdf_renders (type,slug,entity_id,city_slug,r2_key,status) VALUES ('list',?,?,?,?, 'not_built')`, [`${citySlug}-${kind}`, eid, citySlug, `pdf/list/${eid}.pdf`]);
    }
  }
  // promotions/collections/images/blogs/testimonials → no PDF → no-op.
}
