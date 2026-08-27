// =============================================================================
// BESPOKE QMI "new record" route: /qmi/new — the match-and-create surface.
//
// The bespoke static /qmi segment (app/qmi/page.tsx + app/qmi/[id]/page.tsx) SHADOWS
// the dynamic /[entity] route for `qmi`, so this file owns /qmi/new (without it the
// path would fall through to /qmi/[id] with id="new" → 404).
//
// SERVER COMPONENT. Loads the unmatched Snowflake drafts (ingest-created, no floor plan
// linked) + the floor-plan options, computes a suggested floor plan per house, and hands
// them to the client form. The form matches a house to its floor plan and triggers the
// brochure render via matchAndRenderQmi (reusing the existing write path). A blank-create
// escape hatch (createEntity) lives inside the form. No data fetching on the client.
// =============================================================================
import { loadOptions } from '@/lib/select-options';
import { loadUnmatchedHouses } from '@/lib/qmi-match';
import { QmiCreateMatch } from '@/components/qmi/qmi-create-match';

export const dynamic = 'force-dynamic';

export default async function NewQmiPage() {
  const floorPlans = await loadOptions('floor_plans');
  const houses = await loadUnmatchedHouses(floorPlans);
  return <QmiCreateMatch houses={houses} floorPlans={floorPlans} />;
}
