// =============================================================================
// BESPOKE COMMUNITY DETAIL — /communities/[id]. This static segment takes
// precedence over the dynamic /[entity]/[id] route, so communities get the
// bespoke detail screen while other entities keep the generic editor.
//
// SERVER COMPONENT. Reads the community row (drafts included) via
// buildCommunityDetailView. All WRITES route through the existing server
// actions inside the client shell (saveEntity / setStatus / uploadImage).
// =============================================================================

import { notFound } from 'next/navigation';
import { buildCommunityDetailView } from '@/lib/community-detail';
import { CommunityDetail } from '@/components/communities/detail/CommunityDetail';

export const dynamic = 'force-dynamic';

export default async function CommunityDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await buildCommunityDetailView(id);
  if (!view) notFound();
  return <CommunityDetail view={view} />;
}
