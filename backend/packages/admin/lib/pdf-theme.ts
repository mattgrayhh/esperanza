type Sqlish = { prepare(s: string): { run(...b: unknown[]): unknown; get(...b: unknown[]): any } };

/** Copy draft → active with a new version; record history. Returns the new version. */
export function applyPublish(db: Sqlish, publishedBy: string): number {
  const draft = db.prepare(`SELECT theme_json FROM pdf_themes WHERE kind='draft'`).get();
  const next = ((db.prepare(`SELECT COALESCE(MAX(version),0) m FROM pdf_theme_history`).get()?.m ?? 0) as number) + 1;
  db.prepare(`UPDATE pdf_themes SET theme_json=?, version=?, updated_by=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE kind='active'`).run(draft.theme_json, next, publishedBy);
  db.prepare(`INSERT INTO pdf_theme_history (version, theme_json, published_by) VALUES (?,?,?)`).run(next, draft.theme_json, publishedBy);
  return next;
}

/** Load a historical version into the draft (publish to apply). */
export function applyRollback(db: Sqlish, version: number): void {
  const h = db.prepare(`SELECT theme_json FROM pdf_theme_history WHERE version=?`).get(version);
  if (!h) throw new Error('no such version');
  db.prepare(`UPDATE pdf_themes SET theme_json=? WHERE kind='draft'`).run(h.theme_json);
}
