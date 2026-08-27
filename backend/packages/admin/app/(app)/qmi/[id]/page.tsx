// =============================================================================
// BESPOKE QMI DETAIL — /qmi/[id]. This STATIC segment takes precedence over the
// dynamic /[entity]/[id] route, so QMI gets its own real-estate property-detail
// screen while the other 8 entities keep the generic shadcn editor.
//
// SERVER COMPONENT. Reads the BASE qmi row (drafts included) on the primary session
// via buildQmiDetailView (lib/qmi-detail) — NOT v_public_qmi, which would hide drafts.
// All WRITES still route through the existing server actions (saveEntity /
// togglePublished / uploadImage) inside the client shell; nothing here mutates.
// =============================================================================

import { notFound } from 'next/navigation';
import { buildQmiDetailView } from '@/lib/qmi-detail';
import { QmiDetail } from '@/components/qmi/detail/QmiDetail';

export const dynamic = 'force-dynamic';

export default async function QmiDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = await buildQmiDetailView(id);
  if (!view) notFound();

  return <QmiDetail view={view} />;
}
