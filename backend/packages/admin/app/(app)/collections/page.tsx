// =============================================================================
// /collections — bespoke CARD view (feedback item 18). There are only ~6 collections,
// so a card grid reads better than the generic table. This STATIC route takes precedence
// over the dynamic app/[entity] list page for /collections only; edit (/collections/<id>)
// and create (/collections/new) still flow through the generic [entity] routes.
//
// SERVER COMPONENT: reads the base collections table via getReadDb() (drafts stay visible
// to the operator), then renders cards linking to the generic editor.
// =============================================================================
import Link from 'next/link';
import { Plus, ImageOff } from 'lucide-react';
import { desc } from 'drizzle-orm';
import { collections } from '@esperanza/db';
import { getReadDb } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default async function CollectionsPage() {
  const db = getReadDb();
  const rows = await db
    .select({
      id: collections.id,
      title: collections.title,
      slug: collections.slug,
      headerImage: collections.headerImage,
      headerImageAlt: collections.headerImageAlt,
      startingAt: collections.startingAt,
      endingAt: collections.endingAt,
      published: collections.published,
    })
    .from(collections)
    .orderBy(desc(collections.published), collections.title);

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">Collections</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rows.length} record{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button render={<Link href="/collections/new" />}>
          <Plus className="size-4" />
          New
        </Button>
      </div>

      {/* card grid */}
      {rows.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => {
            const range =
              c.startingAt != null
                ? `${USD.format(c.startingAt)}${c.endingAt != null ? ` – ${USD.format(c.endingAt)}` : '+'}`
                : null;
            return (
              <Link
                key={c.id}
                href={`/collections/${c.id}`}
                className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20 hover:bg-accent/30"
              >
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
                  {c.headerImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.headerImage}
                      alt={c.headerImageAlt || c.title || 'Collection'}
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-muted-foreground/40">
                      <ImageOff className="size-8" />
                    </div>
                  )}
                  <div className="absolute right-2 top-2">
                    {c.published ? (
                      <Badge className="bg-status-published/15 text-status-published">Live</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-card/80 backdrop-blur">Draft</Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 p-3">
                  <span className="truncate text-sm font-medium text-foreground">
                    {c.title || <span className="italic text-muted-foreground">Untitled</span>}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{c.slug || '—'}</span>
                  {range ? <span className="mt-0.5 text-xs text-muted-foreground">{range}</span> : null}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          No collections yet.
        </div>
      )}
    </div>
  );
}
