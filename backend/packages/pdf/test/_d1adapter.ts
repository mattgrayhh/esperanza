import type Database from 'better-sqlite3';
export function d1FromSqlite(raw: Database.Database): any {
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = raw.prepare(sql);
    const api = {
      bind: (...args: unknown[]) => { binds = args; return api; },
      first: async <T,>() => (stmt.get(...binds) as T) ?? null,
      all: async <T,>() => ({ results: stmt.all(...binds) as T[] }),
      run: async () => { const r = stmt.run(...binds); return { success: true, meta: { changes: r.changes } }; },
    };
    return api;
  };
  return { prepare, batch: async (stmts: any[]) => Promise.all(stmts) };
}
