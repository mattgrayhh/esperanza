// =============================================================================
// BESPOKE Quick Move-In list — /qmi  (SERVER COMPONENT).
//
// This static segment (app/qmi/page.tsx) takes precedence over the dynamic
// app/[entity]/page.tsx for the `/qmi` path, so QMI gets its own richer screen
// while the other 8 entities keep using the generic shadcn list. The editor route
// /qmi/<id> resolves to the BESPOKE detail screen (app/qmi/[id]/page.tsx), which
// takes precedence over app/[entity]/[id] for QMI only — it still saves through the
// existing server actions UNCHANGED.
//
// Data path is the EXISTING one: a server-side read via getReadDb() (lib/qmi-list.ts
// → buildQmiListView), reading the BASE qmi table so BOTH published and DRAFT QMIs
// are visible, with community/floor-plan names + base price + thumbnail resolved by
// JOIN. NO client-side data fetching: the RSC fetches, the client table renders.
// =============================================================================
import { buildQmiListView } from "@/lib/qmi-list"
import { QmiDataTable, type QmiRow } from "@/components/qmi/qmi-data-table"

export const dynamic = "force-dynamic"

export default async function QmiListPage() {
  const view = await buildQmiListView()

  // Project the server view into the table's serializable props (already display-
  // ready scalars/flags — no server-only objects cross the boundary).
  const rows: QmiRow[] = view.rows.map((r) => ({
    id: r.id,
    address: r.address,
    syncedAddress: r.syncedAddress,
    housenumber: r.housenumber,
    lotNumber: r.lotNumber,
    communityName: r.communityName,
    floorPlanName: r.floorPlanName,
    floorPlanId: r.floorPlanId,
    basePrice: r.basePrice,
    currentPrice: r.currentPrice,
    priceOverridden: r.priceOverridden,
    thumbnail: r.thumbnail,
    moveInDate: r.moveInDate,
    availableNow: r.availableNow,
    published: r.published,
    effectiveBadge: r.effectiveBadge,
  }))

  return <QmiDataTable rows={rows} truncated={view.truncated} />
}
