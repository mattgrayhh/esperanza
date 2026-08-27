'use client';

import Link from 'next/link';
import { ChevronDownIcon, CopyIcon, ExternalLinkIcon, SaveIcon } from 'lucide-react';
import type { LiveSitePlacement } from '@/lib/live-site';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export function PlacementRail({
  placement,
  activeSectionId,
  media,
  trailing,
  publishControl,
}: {
  placement: LiveSitePlacement;
  activeSectionId?: string;
  media?: React.ReactNode;
  /** Rendered after media — last block in the rail (e.g. recent activity). */
  trailing?: React.ReactNode;
  /** Publish/status gate — replaces the read-only visitor status badge when set. */
  publishControl?: React.ReactNode;
}) {
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-[calc(var(--app-header-height)+3.5rem)] lg:self-start">
      <div className="rounded-xl border bg-card p-4">
        <div>
          {publishControl ?? (
            <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {placement.visitorStatus}
            </span>
          )}
        </div>
        {placement.path ? (
          <div className="mt-3 flex items-start gap-1.5">
            <p className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground">{placement.path}</p>
            {placement.fullUrl ? (
              <button
                type="button"
                aria-label="Copy link"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => void navigator.clipboard?.writeText(placement.fullUrl!)}
              >
                <CopyIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">No public page URL for this record type.</p>
        )}

        {placement.fullUrl && placement.isLive ? (
          <div className="mt-2">
            <a
              href={placement.fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-foreground hover:bg-muted"
            >
              Preview live page
              <ExternalLinkIcon className="size-3" />
            </a>
          </div>
        ) : null}

        {/* Staging preview: works for ANY QMI home (published or draft). It renders the
            home live from the latest D1 edits (publish state + resolved incentive) on the
            staging site — the public static page only updates on a site rebuild. */}
        {placement.previewUrl ? (
          <div className="mt-2 space-y-1">
            <a
              href={placement.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-foreground hover:bg-muted"
            >
              Preview on staging
              <ExternalLinkIcon className="size-3" />
            </a>
            <p className="text-[11px] text-muted-foreground">
              Renders this home live from your latest edits (publish state + incentive) on the
              staging site — the public URL only updates on the next site rebuild. Shareable.
            </p>
          </div>
        ) : !placement.isLive && placement.fullUrl ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Preview available once published — this page isn’t live on the public site yet.
          </p>
        ) : null}

        {placement.sections.length > 0 ? (
          <ul className="mt-4 space-y-1.5 border-t pt-3">
            {placement.sections.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <span
                  className={
                    activeSectionId === s.id
                      ? 'mt-1 size-1.5 shrink-0 rounded-full bg-primary'
                      : 'mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/40'
                  }
                  aria-hidden
                />
                <span className={activeSectionId === s.id ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  {s.label}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {media ? <div className="min-w-0 overflow-hidden rounded-xl border bg-card p-4">{media}</div> : null}
      {trailing ? <div className="rounded-xl border bg-card p-4">{trailing}</div> : null}
    </aside>
  );
}

export function RecordEditBreadcrumb({
  collectionLabel,
  collectionHref,
  recordName,
}: {
  collectionLabel: string;
  collectionHref: string;
  recordName: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <Link href={collectionHref} className="hover:text-foreground">
        {collectionLabel}
      </Link>
      <span className="mx-1.5 text-muted-foreground/60">/</span>
      <span className="text-foreground">{recordName}</span>
    </nav>
  );
}

export function StickyActionBar({
  formId,
  pending,
  statusText,
  statusTone,
  title,
  children,
  footer,
}: {
  formId: string;
  pending: boolean;
  statusText: string | null;
  statusTone: 'neutral' | 'success' | 'error';
  /** Plain string → truncated h1. React node → left slot (e.g. title + status badges). */
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const toneClass =
    statusTone === 'error'
      ? 'text-destructive'
      : statusTone === 'success'
        ? 'text-primary'
        : 'text-muted-foreground';
  const hasTitle = title != null && title !== '';

  return (
    <div className="sticky top-(--app-header-height) z-30 -mx-4 border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/80 md:-mx-6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 md:px-6">
        {hasTitle ? (
          typeof title === 'string' ? (
            <h1 className="min-w-0 truncate font-heading text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
          ) : (
            <div className="min-w-0 flex-1">{title}</div>
          )
        ) : null}
        <div
          className={cn(
            'flex min-w-0 flex-wrap items-center gap-3',
            hasTitle ? 'shrink-0' : 'ml-auto',
          )}
        >
          {statusText ? (
            <p className={`min-w-0 text-sm ${toneClass}`}>{statusText}</p>
          ) : null}
          {children}
          <Button type="submit" form={formId} disabled={pending} size="lg" className="shrink-0">
            <SaveIcon aria-hidden="true" data-icon="inline-start" />
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
      {footer ? <div className="border-t px-4 py-2 md:px-6">{footer}</div> : null}
    </div>
  );
}

export function RecordEditLayout({
  main,
  rail,
}: {
  main: React.ReactNode;
  rail?: React.ReactNode;
}) {
  return (
    <div
      className={
        rail
          ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_min(100%,20rem)] xl:grid-cols-[minmax(0,1fr)_20rem]'
          : 'grid gap-6'
      }
    >
      <div className="min-w-0 lg:order-1">{main}</div>
      {rail ? <div className="min-w-0 order-first lg:order-2">{rail}</div> : null}
    </div>
  );
}

export function MarkSystemsSection({
  title = 'From MarkSystems',
  defaultOpen = false,
  children,
}: {
  title?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50">
        <span>{title}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform in-data-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-4 py-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function SectionJumpNav({ sections }: { sections: { id: string; label: string }[] }) {
  if (sections.length < 2) return null;
  return (
    <nav aria-label="Jump to section" className="flex flex-wrap gap-2">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

export function sectionId(label: string): string {
  return `section-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
}

export function EditToast({
  message,
  tone,
  onDismiss,
}: {
  message: string | null;
  tone: 'success' | 'error';
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="status"
      className={
        tone === 'error'
          ? 'fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-destructive/30 bg-background px-4 py-3 text-sm text-destructive shadow-lg'
          : 'fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border bg-background px-4 py-3 text-sm text-foreground shadow-lg'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <span>{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function UnsavedLeaveToast({
  open,
  pending,
  onSave,
  onDiscard,
  onStay,
}: {
  open: boolean;
  pending: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="alertdialog"
      aria-labelledby="unsaved-leave-title"
      aria-describedby="unsaved-leave-desc"
      className="fixed bottom-6 right-6 z-50 w-[min(100vw-3rem,22rem)] rounded-lg border border-warning/30 bg-background px-4 py-3 text-sm text-foreground shadow-lg"
    >
      <p id="unsaved-leave-title" className="font-medium">
        Unsaved changes
      </p>
      <p id="unsaved-leave-desc" className="mt-1 text-muted-foreground">
        Save your work before leaving, or discard changes to continue.
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onStay} disabled={pending}>
          Stay
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={pending}>
          Discard
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
