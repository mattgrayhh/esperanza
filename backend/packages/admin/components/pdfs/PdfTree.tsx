'use client';
// =============================================================================
// packages/admin/components/pdfs/PdfTree.tsx — PDF drill-down tree.
//
// Collapsible City → Community → {Plans (floorplan), Specs (qmi)} tree with
// city-level list renders. Each leaf shows:
//   • a freshness dot (green=up to date, orange=out of date, red=error/never built,
//     blue=rendering) — hybrid of currency + age, see pdfFreshness()
//   • the slug + a "Generated 2d ago" timestamp
//   • a Download link (opens the R2 PDF in a new tab)
//   • a Regenerate button (calls regeneratePdf server action)
// Each city header has a "Rebuild stale" button (calls rebuildStaleForCity).
// =============================================================================

import * as React from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { regeneratePdf, rebuildStaleForCity } from '@/lib/pdf-actions';
import { pdfFreshness, formatGeneratedAt, type PdfCityNode, type PdfLeaf } from '@/lib/pdf-tree';

// =============================================================================
// Freshness dot — green / orange / red (+ blue while rendering)
// =============================================================================
const FRESHNESS_DOT = {
  green: 'bg-green-500',
  orange: 'bg-amber-500',
  red: 'bg-red-500',
} as const;
const FRESHNESS_LABEL = {
  green: 'Up to date',
  orange: 'Out of date',
  red: 'Error or never built',
} as const;

/** Status dot driven by hybrid freshness; 'rendering' is a transient blue state. */
function StatusDot({
  leaf,
  themeVersion,
  now,
}: {
  leaf: Pick<PdfLeaf, 'status' | 'lastRenderedAt' | 'themeVersion'>;
  themeVersion: number | null;
  now: number;
}) {
  if (leaf.status === 'rendering') {
    return (
      <span
        className="inline-block size-2 shrink-0 rounded-full bg-blue-500"
        title="Rendering"
        aria-label="Rendering"
      />
    );
  }
  const fresh = pdfFreshness(leaf, themeVersion, now);
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', FRESHNESS_DOT[fresh])}
      title={FRESHNESS_LABEL[fresh]}
      aria-label={FRESHNESS_LABEL[fresh]}
    />
  );
}

// =============================================================================
// Leaf row — one pdf_renders row rendered as a table row
// =============================================================================
function LeafRow({
  leaf,
  publicBase,
  themeVersion,
  now,
  indent,
}: {
  leaf: PdfLeaf;
  publicBase: string;
  themeVersion: number | null;
  now: number;
  indent?: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const href = `${publicBase}/pdf/${leaf.type}/${leaf.slug}`;
  const generated = formatGeneratedAt(leaf.lastRenderedAt, now);

  function handleRegenerate() {
    startTransition(async () => {
      await regeneratePdf(leaf.type, leaf.slug);
    });
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent/30',
        indent && 'ml-6',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot leaf={leaf} themeVersion={themeVersion} now={now} />
        <span className="truncate font-mono text-xs text-foreground/80">{leaf.slug}</span>
        <Badge variant="outline" className="h-4 px-1 text-[10px] leading-none text-muted-foreground">
          {leaf.type}
        </Badge>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="mr-1 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground" title={leaf.lastRenderedAt ?? 'never generated'}>
          {generated === 'never' ? 'Never generated' : `Generated ${generated}`}
        </span>
        {leaf.status !== 'not_built' ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="icon-sm" title="Download PDF" aria-label="Download PDF">
              <Download className="size-3.5" />
            </Button>
          </a>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Regenerate"
          aria-label="Regenerate"
          disabled={pending || leaf.status === 'rendering'}
          onClick={handleRegenerate}
        >
          <RefreshCw className={cn('size-3.5', pending && 'animate-spin')} />
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Community section — collapsible block within a city
// =============================================================================
function CommunitySection({
  node,
  publicBase,
  themeVersion,
  now,
}: {
  node: import('@/lib/pdf-tree').PdfCommunityNode;
  publicBase: string;
  themeVersion: number | null;
  now: number;
}) {
  const [open, setOpen] = React.useState(false);
  const total = (node.self ? 1 : 0) + node.plans.length + node.specs.length;

  return (
    <div className="border-l border-border/60 pl-3">
      {/* Community header row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-foreground hover:bg-accent/30"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-left">{node.communityId}</span>
        <span className="text-xs text-muted-foreground">{total}</span>
        {node.self ? <StatusDot leaf={node.self} themeVersion={themeVersion} now={now} /> : null}
      </button>

      {open ? (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {/* Community brochure self-render */}
          {node.self ? <LeafRow leaf={node.self} publicBase={publicBase} themeVersion={themeVersion} now={now} indent /> : null}

          {/* Floor plan renders */}
          {node.plans.length > 0 ? (
            <div>
              <p className="ml-8 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Floor Plans ({node.plans.length})
              </p>
              {node.plans.map((leaf) => (
                <LeafRow key={leaf.slug} leaf={leaf} publicBase={publicBase} themeVersion={themeVersion} now={now} indent />
              ))}
            </div>
          ) : null}

          {/* QMI spec sheet renders */}
          {node.specs.length > 0 ? (
            <div>
              <p className="ml-8 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                QMI Specs ({node.specs.length})
              </p>
              {node.specs.map((leaf) => (
                <LeafRow key={leaf.slug} leaf={leaf} publicBase={publicBase} themeVersion={themeVersion} now={now} indent />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// City section — top-level collapsible block
// =============================================================================
function CitySection({
  node,
  publicBase,
  themeVersion,
  now,
}: {
  node: PdfCityNode;
  publicBase: string;
  themeVersion: number | null;
  now: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [rebuilding, startRebuild] = React.useTransition();

  function handleRebuildStale() {
    startRebuild(async () => {
      await rebuildStaleForCity(node.citySlug);
    });
  }

  const total = node.lists.length + node.communities.reduce((n, c) => n + (c.self ? 1 : 0) + c.plans.length + c.specs.length, 0);

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* City header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-sm font-semibold text-foreground"
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="capitalize">{node.citySlug}</span>
          <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px] leading-none tabular-nums">
            {total}
          </Badge>
        </button>
        <Button
          variant="outline"
          size="sm"
          disabled={rebuilding}
          onClick={handleRebuildStale}
          title="Mark all stale renders for this city for rebuild"
          className="h-7 gap-1.5 text-xs"
        >
          <RefreshCw className={cn('size-3', rebuilding && 'animate-spin')} />
          Rebuild stale
        </Button>
      </div>

      {/* City body */}
      {open ? (
        <div className="border-t border-border px-2 py-2">
          {/* City-level list renders */}
          {node.lists.length > 0 ? (
            <div className="mb-2">
              <p className="mb-0.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Lists ({node.lists.length})
              </p>
              {node.lists.map((leaf) => (
                <LeafRow key={leaf.slug} leaf={leaf} publicBase={publicBase} themeVersion={themeVersion} now={now} />
              ))}
            </div>
          ) : null}

          {/* Communities */}
          {node.communities.length > 0 ? (
            <div className="flex flex-col gap-1">
              {node.communities.map((comm) => (
                <CommunitySection key={comm.communityId} node={comm} publicBase={publicBase} themeVersion={themeVersion} now={now} />
              ))}
            </div>
          ) : null}

          {total === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">No renders yet.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// PdfTree — root export
// =============================================================================
export function PdfTree({
  tree,
  publicBase,
  themeVersion,
  now,
}: {
  tree: PdfCityNode[];
  publicBase: string;
  themeVersion: number | null;
  now: number;
}) {
  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <FileText className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No PDF renders found.</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          PDF renders are created when the PDF worker processes a community, floor plan, or QMI
          record. Check back after the worker has run.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Freshness legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="font-medium">Status:</span>
        {[
          { cls: 'bg-green-500', label: 'Up to date' },
          { cls: 'bg-amber-500', label: 'Out of date (stale, older theme, or >30d)' },
          { cls: 'bg-red-500', label: 'Error / never built' },
          { cls: 'bg-blue-500', label: 'Rendering' },
        ].map(({ cls, label }) => (
          <span key={label} className="flex items-center gap-1">
            <span className={cn('inline-block size-2 shrink-0 rounded-full', cls)} />
            {label}
          </span>
        ))}
        {themeVersion != null ? (
          <span className="ml-auto tabular-nums">Theme v{themeVersion}</span>
        ) : null}
      </div>

      {/* Cities */}
      {tree.map((city) => (
        <CitySection key={city.citySlug} node={city} publicBase={publicBase} themeVersion={themeVersion} now={now} />
      ))}
    </div>
  );
}
