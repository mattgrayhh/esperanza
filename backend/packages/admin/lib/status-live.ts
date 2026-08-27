// =============================================================================
// Status page — LIVE data loaders (server-only). Replaces the placeholder
// snapshot (status-page.ts keeps the shared health types/helpers).
//
//   • Live health checks: ops /health/sync, public API, public website.
//   • Latest GitHub Actions deploy runs for esperanza-backend + esperanza-frontend.
//     Token: GITHUB_STATUS_TOKEN (preferred, fine-grained Actions:read) with
//     GITHUB_DISPATCH_TOKEN as fallback (already on the worker for rebuild dispatch).
//   • Sentry unresolved issues (org rhodes-enterprises / project esperanza-homes).
//     Token: SENTRY_STATUS_TOKEN (org auth token, Settings → Auth Tokens).
//
// Every loader degrades to a "not configured / unreachable" state instead of
// throwing — the status page must render even when an integration is down.
// =============================================================================

import type { ComponentHealth } from './status-page';

const GH_REPOS = [
  { key: 'backend', repo: 'mattgrayhh/esperanza-backend', label: 'esperanza-backend' },
  { key: 'frontend', repo: 'Hazard-House/esperanza-frontend', label: 'esperanza-frontend' },
] as const;

const SENTRY_ORG = 'rhodes-enterprises';
const SENTRY_PROJECT = 'esperanza-homes';

const OPS_HEALTH_URL = 'https://esperanza-ops.round-base-ed8c.workers.dev/health/sync';
const PUBLIC_API_URL = 'https://esperanzahomes.hazardhouse.ai/api/public/settings';
const WEBSITE_URL = 'https://esperanzahomes.hazardhouse.ai/';

const RUN_LIMIT = 5;
const TIMEOUT_MS = 6000;

function timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// ── Live health ──────────────────────────────────────────────────────────────

export interface LiveCheck {
  id: string;
  name: string;
  description: string;
  status: ComponentHealth;
  detail: string;
}

export async function loadLiveChecks(env?: { OPS?: Fetcher }): Promise<LiveCheck[]> {
  const [sync, api, site] = await Promise.all([
    (async (): Promise<LiveCheck> => {
      try {
        // Same-account workers.dev fetches are blocked from inside a Worker —
        // use the OPS service binding when present (public URL = local dev only).
        const r = env?.OPS
          ? await env.OPS.fetch(OPS_HEALTH_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
          : await timedFetch(OPS_HEALTH_URL);
        const body = (await r.json().catch(() => null)) as {
          ok?: boolean;
          ageHours?: number;
          staleAfterHours?: number;
        } | null;
        if (r.ok && body?.ok) {
          return {
            id: 'sync',
            name: 'MarkSystems sync',
            description: 'Snowflake → D1 ingest freshness (esperanza-ops /health/sync).',
            status: 'operational',
            detail: `Last good run ${body.ageHours ?? '?'}h ago (stale after ${body.staleAfterHours ?? 12}h).`,
          };
        }
        return {
          id: 'sync',
          name: 'MarkSystems sync',
          description: 'Snowflake → D1 ingest freshness (esperanza-ops /health/sync).',
          status: 'outage',
          detail: body
            ? `Sync is stale — last good run ${body.ageHours ?? 'unknown'}h ago.`
            : `Health endpoint returned ${r.status}.`,
        };
      } catch {
        return {
          id: 'sync',
          name: 'MarkSystems sync',
          description: 'Snowflake → D1 ingest freshness (esperanza-ops /health/sync).',
          status: 'degraded',
          detail: 'Health endpoint unreachable from the admin worker.',
        };
      }
    })(),
    (async (): Promise<LiveCheck> => {
      try {
        const r = await timedFetch(PUBLIC_API_URL);
        return {
          id: 'api',
          name: 'Public API',
          description: 'esperanza-api — the live read path the website hydrates from.',
          status: r.ok ? 'operational' : 'outage',
          detail: r.ok ? 'Responding.' : `Returned ${r.status}.`,
        };
      } catch {
        return {
          id: 'api',
          name: 'Public API',
          description: 'esperanza-api — the live read path the website hydrates from.',
          status: 'outage',
          detail: 'Unreachable.',
        };
      }
    })(),
    (async (): Promise<LiveCheck> => {
      try {
        const r = await timedFetch(WEBSITE_URL, { method: 'HEAD' });
        return {
          id: 'site',
          name: 'Website',
          description: 'esperanzahomes.hazardhouse.ai — the public site.',
          status: r.ok ? 'operational' : 'outage',
          detail: r.ok ? 'Responding.' : `Returned ${r.status}.`,
        };
      } catch {
        return {
          id: 'site',
          name: 'Website',
          description: 'esperanzahomes.hazardhouse.ai — the public site.',
          status: 'outage',
          detail: 'Unreachable.',
        };
      }
    })(),
  ]);
  return [sync, api, site];
}

// ── GitHub deployments ───────────────────────────────────────────────────────

export interface DeployRun {
  id: number;
  title: string;
  workflow: string;
  branch: string;
  event: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | ...
  createdAt: string;
  url: string;
}

export interface RepoDeployments {
  key: string;
  label: string;
  repo: string;
  runs: DeployRun[];
  /** Human-readable problem when runs could not be loaded ('' = fine). */
  error: string;
}

export async function loadDeployments(env: {
  GITHUB_STATUS_TOKEN?: string;
  GITHUB_DISPATCH_TOKEN?: string;
}): Promise<RepoDeployments[]> {
  const token = (env.GITHUB_STATUS_TOKEN ?? env.GITHUB_DISPATCH_TOKEN ?? '').trim();
  if (!token) {
    return GH_REPOS.map((r) => ({
      key: r.key,
      label: r.label,
      repo: r.repo,
      runs: [],
      error:
        'Not configured — set the GITHUB_STATUS_TOKEN secret on esperanza-admin (fine-grained PAT, Actions: read on both repos).',
    }));
  }
  return Promise.all(
    GH_REPOS.map(async (r): Promise<RepoDeployments> => {
      try {
        const resp = await timedFetch(
          `https://api.github.com/repos/${r.repo}/actions/runs?per_page=${RUN_LIMIT}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'esperanza-admin-status',
            },
          }
        );
        if (!resp.ok) {
          return {
            key: r.key,
            label: r.label,
            repo: r.repo,
            runs: [],
            error: `GitHub returned ${resp.status} — check the token's access to ${r.repo}.`,
          };
        }
        const data = (await resp.json()) as {
          workflow_runs?: Array<{
            id: number;
            display_title?: string;
            name?: string;
            head_branch?: string;
            event?: string;
            status?: string;
            conclusion?: string | null;
            created_at?: string;
            html_url?: string;
          }>;
        };
        const runs = (data.workflow_runs ?? []).map(
          (w): DeployRun => ({
            id: w.id,
            title: w.display_title || w.name || String(w.id),
            workflow: w.name || '',
            branch: w.head_branch || '',
            event: w.event || '',
            status: w.status || '',
            conclusion: w.conclusion ?? null,
            createdAt: w.created_at || '',
            url: w.html_url || `https://github.com/${r.repo}/actions/runs/${w.id}`,
          })
        );
        return { key: r.key, label: r.label, repo: r.repo, runs, error: '' };
      } catch {
        return { key: r.key, label: r.label, repo: r.repo, runs: [], error: 'GitHub unreachable.' };
      }
    })
  );
}

// ── Sentry ───────────────────────────────────────────────────────────────────

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  count: string;
  userCount: number;
  lastSeen: string;
  level: string;
  permalink: string;
}

export interface SentryStatus {
  org: string;
  project: string;
  issues: SentryIssue[];
  /** '' when loaded fine; otherwise why the section is empty. */
  error: string;
}

export async function loadSentryIssues(env: {
  SENTRY_STATUS_TOKEN?: string;
}): Promise<SentryStatus> {
  const base: SentryStatus = { org: SENTRY_ORG, project: SENTRY_PROJECT, issues: [], error: '' };
  const token = (env.SENTRY_STATUS_TOKEN ?? '').trim();
  if (!token) {
    return {
      ...base,
      error:
        'Not configured — create an Auth Token in Sentry (Settings → Auth Tokens) and set it as the SENTRY_STATUS_TOKEN secret on esperanza-admin.',
    };
  }
  try {
    const resp = await timedFetch(
      `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is%3Aunresolved&statsPeriod=14d&limit=${RUN_LIMIT}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) {
      return {
        ...base,
        error: `Sentry returned ${resp.status} — the SENTRY_STATUS_TOKEN may be expired or under-scoped.`,
      };
    }
    const data = (await resp.json()) as Array<{
      id: string;
      shortId?: string;
      title?: string;
      culprit?: string;
      count?: string;
      userCount?: number;
      lastSeen?: string;
      level?: string;
      permalink?: string;
    }>;
    return {
      ...base,
      issues: data.map((i) => ({
        id: i.id,
        shortId: i.shortId || i.id,
        title: i.title || '(untitled)',
        culprit: i.culprit || '',
        count: i.count || '0',
        userCount: i.userCount ?? 0,
        lastSeen: i.lastSeen || '',
        level: i.level || 'error',
        permalink: i.permalink || `https://${SENTRY_ORG}.sentry.io/issues/${i.id}/`,
      })),
    };
  } catch {
    return { ...base, error: 'Sentry unreachable from the admin worker.' };
  }
}
