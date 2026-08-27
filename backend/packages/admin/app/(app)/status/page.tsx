import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getStatusSnapshot } from '@/lib/status-page';
import { loadDeployments, loadSentryIssues } from '@/lib/status-live';
import { StatusPageView } from '@/components/status-page-view';
import { DeploymentsSection, SentrySection } from '@/components/status-integrations';

export const dynamic = 'force-dynamic';

export default async function StatusPage() {
  const env = getCloudflareContext().env as {
    GITHUB_STATUS_TOKEN?: string;
    GITHUB_DISPATCH_TOKEN?: string;
    SENTRY_STATUS_TOKEN?: string;
    OPS?: Fetcher;
  };
  const [snapshot, deployments, sentry] = await Promise.all([
    getStatusSnapshot(env),
    loadDeployments(env),
    loadSentryIssues(env),
  ]);
  return (
    <StatusPageView snapshot={snapshot}>
      <DeploymentsSection repos={deployments} />
      <SentrySection sentry={sentry} />
    </StatusPageView>
  );
}
