// =============================================================================
// Site pipeline — which automatic publish hooks are configured on this Worker.
// Reads only presence of secrets/vars (never exposes values). Shown on the
// dashboard so editors know whether saves auto-rebuild the public site.
// =============================================================================

export interface SitePipelineStatus {
  /** X-Purge-Key set — postWrite can bust esperanza-api + frontend proxy cache. */
  purgeConfigured: boolean;
  /** GitHub dispatch or deploy hook — postWrite can trigger esperanza-frontend CI. */
  frontendRebuildConfigured: boolean;
  /** Bearer token for ingest POST /run (Sync now + same auth as cron backfill). */
  ingestTriggerConfigured: boolean;
  /** All three configured — routine admin saves should reach the site without manual deploy. */
  ready: boolean;
  /** Human-readable gaps for the dashboard banner. */
  gaps: string[];
}

export function getSitePipelineStatus(env: {
  PURGE_KEY?: string;
  GITHUB_DISPATCH_TOKEN?: string;
  FRONTEND_DEPLOY_HOOK_URL?: string;
  INGEST_TRIGGER_TOKEN?: string;
}): SitePipelineStatus {
  const purgeConfigured = Boolean((env.PURGE_KEY ?? '').trim());
  const frontendRebuildConfigured = Boolean(
    (env.GITHUB_DISPATCH_TOKEN ?? '').trim() || (env.FRONTEND_DEPLOY_HOOK_URL ?? '').trim()
  );
  const ingestTriggerConfigured = Boolean((env.INGEST_TRIGGER_TOKEN ?? '').trim());

  const gaps: string[] = [];
  if (!purgeConfigured) {
    gaps.push(
      'API cache purge (PURGE_KEY) is not set on the admin worker — live promo/QMI data can lag up to ~5 minutes.'
    );
  }
  if (!frontendRebuildConfigured) {
    gaps.push(
      'Automatic frontend rebuild is not configured (GITHUB_DISPATCH_TOKEN or FRONTEND_DEPLOY_HOOK_URL) — copy, galleries, and the /incentives index need a manual esperanza-frontend deploy after edits.'
    );
  }
  if (!ingestTriggerConfigured) {
    gaps.push(
      'Sync now is not configured (INGEST_TRIGGER_TOKEN missing on the admin worker). MarkSystems changes still sync on the 4-hour schedule.'
    );
  }

  return {
    purgeConfigured,
    frontendRebuildConfigured,
    ingestTriggerConfigured,
    ready: purgeConfigured && frontendRebuildConfigured && ingestTriggerConfigured,
    gaps,
  };
}
