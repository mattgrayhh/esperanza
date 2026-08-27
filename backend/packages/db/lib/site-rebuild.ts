// =============================================================================
// @esperanza/db — static frontend rebuild hook.
//
// The public site bakes most page HTML at build time. Purging API cache updates
// live islands but not baked copy, galleries, or grids, which require a frontend
// deploy. The result below is deliberately returned to the admin write path: a
// failed dispatch is a distinct, user-visible state, never a log-only success.
// =============================================================================

export interface SiteRebuildEnv {
  FRONTEND_DEPLOY_HOOK_URL?: string;
  GITHUB_DISPATCH_TOKEN?: string;
  FRONTEND_REPO?: string;
  FRONTEND_DEPLOY_WORKFLOW?: string;
  FRONTEND_DEPLOY_REFS?: string;
}

export type FrontendRebuildResult =
  | { status: 'scheduled'; transport: 'hook' | 'github'; refs: string[] }
  | { status: 'failed'; transport: 'hook' | 'github'; refs: string[]; detail: string }
  | { status: 'not_configured'; transport: 'none'; refs: []; detail: string };

/**
 * Request a static-site rebuild and report whether the request was accepted.
 * This confirms scheduling, not that the later bake/deploy completed.
 */
export async function triggerFrontendRebuild(env: SiteRebuildEnv): Promise<FrontendRebuildResult> {
  const hookUrl = (env.FRONTEND_DEPLOY_HOOK_URL ?? '').trim();
  if (hookUrl) {
    try {
      const res = await fetch(hookUrl, { method: 'POST' });
      if (res.ok) return { status: 'scheduled', transport: 'hook', refs: [] };
      const detail = `deploy hook returned HTTP ${res.status}`;
      console.error(`[site-rebuild] ${detail}`);
      return { status: 'failed', transport: 'hook', refs: [], detail };
    } catch (err) {
      const detail = `deploy hook request failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[site-rebuild]', err);
      return { status: 'failed', transport: 'hook', refs: [], detail };
    }
  }

  const token = (env.GITHUB_DISPATCH_TOKEN ?? '').trim();
  if (!token) {
    const detail = 'no FRONTEND_DEPLOY_HOOK_URL or GITHUB_DISPATCH_TOKEN is configured';
    console.warn(`[site-rebuild] ${detail} — static pages not rebuilt`);
    return { status: 'not_configured', transport: 'none', refs: [], detail };
  }
  const repo = (env.FRONTEND_REPO ?? 'Hazard-House/esperanza-frontend').trim();
  const workflow = (env.FRONTEND_DEPLOY_WORKFLOW ?? 'deploy.yml').trim();
  const refs = (env.FRONTEND_DEPLOY_REFS ?? 'main').split(',').map((s) => s.trim()).filter(Boolean);

  const results = await Promise.all(refs.map(async (ref) => {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'esperanza-admin',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref }),
      });
      if (res.ok) return { ref, detail: null };
      return { ref, detail: `HTTP ${res.status} ${await res.text().catch(() => '')}`.trim() };
    } catch (err) {
      return { ref, detail: err instanceof Error ? err.message : String(err) };
    }
  }));
  const failures = results.filter((result) => result.detail);
  if (failures.length === 0) return { status: 'scheduled', transport: 'github', refs };
  const detail = failures.map(({ ref, detail }) => `${ref}: ${detail}`).join('; ');
  console.error(`[site-rebuild] dispatch failed: ${detail}`);
  return { status: 'failed', transport: 'github', refs, detail };
}

interface RebuildSettingsDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export const FRONTEND_REBUILD_DEBOUNCE_KEY = '_admin_frontend_rebuild_at';
export const FRONTEND_REBUILD_DEBOUNCE_MS = 120_000;

export async function triggerFrontendRebuildDebounced(
  env: SiteRebuildEnv,
  d1?: RebuildSettingsDb
): Promise<FrontendRebuildResult> {
  if (!d1) return triggerFrontendRebuild(env);
  const now = Date.now();
  try {
    const row = await d1.prepare('SELECT value FROM site_settings WHERE key = ?')
      .bind(FRONTEND_REBUILD_DEBOUNCE_KEY).first<{ value: string }>();
    const last = row?.value ? Number(row.value) : 0;
    if (Number.isFinite(last) && now - last < FRONTEND_REBUILD_DEBOUNCE_MS) {
      return { status: 'scheduled', transport: 'github', refs: [] };
    }
    await d1.prepare(`INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(FRONTEND_REBUILD_DEBOUNCE_KEY, String(now), new Date().toISOString()).run();
  } catch (err) {
    console.error('[site-rebuild] debounce read/write failed — dispatching anyway', err);
  }
  return triggerFrontendRebuild(env);
}
