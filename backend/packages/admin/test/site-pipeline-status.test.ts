import { describe, expect, it } from 'vitest';
import { getSitePipelineStatus } from '../lib/site-pipeline-status';

describe('getSitePipelineStatus', () => {
  it('reports gaps when secrets are unset', () => {
    const s = getSitePipelineStatus({});
    expect(s.ready).toBe(false);
    expect(s.gaps).toHaveLength(3);
  });

  it('is ready when purge, rebuild, and ingest tokens are set', () => {
    const s = getSitePipelineStatus({
      PURGE_KEY: 'x',
      GITHUB_DISPATCH_TOKEN: 'pat',
      INGEST_TRIGGER_TOKEN: 'ingest',
    });
    expect(s.ready).toBe(true);
    expect(s.gaps).toHaveLength(0);
  });

  it('accepts FRONTEND_DEPLOY_HOOK_URL instead of GitHub token', () => {
    const s = getSitePipelineStatus({
      PURGE_KEY: 'x',
      FRONTEND_DEPLOY_HOOK_URL: 'https://hooks.example/deploy',
      INGEST_TRIGGER_TOKEN: 'ingest',
    });
    expect(s.frontendRebuildConfigured).toBe(true);
    expect(s.ready).toBe(true);
  });
});
