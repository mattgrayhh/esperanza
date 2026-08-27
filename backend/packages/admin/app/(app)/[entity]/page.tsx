// Generic config-driven list page: /<segment>. SERVER COMPONENT — it keeps the
// EXISTING server-side data path (buildListView -> getReadDb(), reading the base table
// so drafts stay visible to the operator) and passes the already-fetched columns+rows
// to the client <DataTable/>. NO client-side data fetching is introduced: the RSC
// renders the data, the client component only re-skins it (sort/filter/paginate).
import { notFound } from 'next/navigation';
import { ENTITY_LIST } from '@/lib/entities';
import { HELP_LINKS_BY_ENTITY } from '@/lib/help-links.generated';
import { buildListView } from '@/lib/build-list-view';
import { createCommunityDraft } from '@/lib/actions';
import {
  DataTable,
  type DataTableColumn,
  type DataTableRow,
} from '@/components/data-table';
import { PromoHealthBanner } from '@/components/PromoHealthBanner';
import { buildPromoHealth } from '@/lib/promo-health';

export const dynamic = 'force-dynamic';

function bySegment(segment: string) {
  return ENTITY_LIST.find((e) => e.segment === segment);
}

export default async function EntityListPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = await params;
  const def = bySegment(entity);
  if (!def) notFound();

  // Existing server-side read path — unchanged source of truth.
  const view = await buildListView(def.key);

  // Project the server ListView into the DataTable's serializable props.
  const columns: DataTableColumn[] = view.columns.map((c) => ({
    field: c.field,
    label: c.label,
    kind: c.kind,
  }));

  const rows: DataTableRow[] = view.rows.map((r) => ({
    id: r.id,
    values: Object.fromEntries(r.cells.map((cell) => [cell.field, cell.value])),
    live: r.live,
    status: r.status,
  }));

  // Promotions page: surface overlap/coverage warnings where scopes are managed.
  const promoHealth = def.key === 'promotions' ? await buildPromoHealth() : null;

  return (
    <div className="flex flex-col gap-4">
      {promoHealth && <PromoHealthBanner health={promoHealth} />}
      <DataTable
      segment={def.segment}
      label={def.label}
      helpHref={HELP_LINKS_BY_ENTITY[def.key] ? `/help/${HELP_LINKS_BY_ENTITY[def.key]!.slug}` : null}
      helpTitle={HELP_LINKS_BY_ENTITY[def.key]?.title ?? null}
      columns={columns}
      rows={rows}
      gateColumn={view.gateColumn}
      truncated={view.truncated}
      groupByField={def.segment === 'communities' ? 'town' : undefined}
      groupByLabel={def.segment === 'communities' ? 'Town' : undefined}
      createAction={def.segment === 'communities' ? createCommunityDraft : undefined}
      />
    </div>
  );
}
