// =============================================================================
// Rhodes Living — Availability  (/rhodes, SERVER COMPONENT).
//
// The RENTAL tenant. Unlike the Esperanza entities (D1-backed), this screen's data
// lives in the standalone rhodes-availability Worker (Snowflake→KV). The RSC fetches
// both communities server-side via getRhodesData (which carries the Bearer admin key
// — it never reaches the browser), then hands serializable rows to the client table.
//
// If the Worker is unreachable or RHODES_ADMIN_KEY is unset/wrong, we still render the
// shell and surface the error inline rather than crashing the route.
// =============================================================================
import { getRhodesData } from "@/lib/rhodes-actions";
import { RHODES_COMMUNITIES, type RhodesData } from "@/lib/rhodes-client";
import { RhodesAvailability } from "@/components/rhodes/rhodes-availability";

export const dynamic = "force-dynamic";

export default async function RhodesPage() {
  const results = await Promise.all(
    RHODES_COMMUNITIES.map(async (c) => [c.key, await getRhodesData(c.key)] as const)
  );

  const initial: Record<string, RhodesData> = {};
  let configError: string | null = null;
  for (const [key, res] of results) {
    if (res.ok) {
      initial[key] = res.data;
    } else {
      configError = res.error;
      initial[key] = { units: [], overrides: {}, fetchedAt: null };
    }
  }

  return <RhodesAvailability initial={initial} configError={configError} />;
}
