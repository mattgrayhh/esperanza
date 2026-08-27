'use client';

// =============================================================================
// CommunityHero — banner with featured image as background, gradient scrim,
// community name + description overlaid. A children slot receives the status
// badge/actions from the shell (PublishedToggle etc.).
// =============================================================================

import type { CommunityDetailView } from '../../../lib/community-detail';

export function CommunityHero({
  view,
  children,
}: {
  view: CommunityDetailView;
  children?: React.ReactNode;
}) {
  const { featuredImageUrl, description } = view.hero;

  if (!featuredImageUrl) {
    // Neutral block — no hero image yet
    return (
      <div className="rounded-xl border bg-muted/40 px-6 py-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{view.displayName}</h1>
            {view.subtitle ? (
              <p className="text-sm text-muted-foreground">{view.subtitle}</p>
            ) : null}
            {description ? (
              <p className="mt-2 max-w-prose text-sm text-muted-foreground line-clamp-2">
                {description}
              </p>
            ) : null}
          </div>
          {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{ minHeight: 220 }}
    >
      {/* Background image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={featuredImageUrl}
        alt={view.displayName}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Gradient scrim — dark at the bottom for the title/description. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
      {/* Top-right scrim — darkens the corner so the white status control stays legible
          over any photo. Anchored at the top-right (gradient-to-bl), fading to transparent. */}
      <div className="absolute inset-0 bg-gradient-to-bl from-black/60 via-black/10 to-transparent" />

      {/* Content overlay */}
      <div className="relative flex flex-col justify-end gap-3 p-6" style={{ minHeight: 220 }}>
        {/* Actions slot — top-right. White text + lightened control borders so the status
            dropdown reads clearly against the scrimmed image. (The portaled dropdown menu
            is unaffected — it renders outside this subtree.) */}
        {children ? (
          <div className="absolute right-4 top-4 flex flex-wrap items-center gap-2 text-white drop-shadow-sm [&_[data-slot=select-trigger]]:border-white/40 [&_[data-slot=select-trigger]]:bg-black/20 [&_[data-slot=select-trigger]]:hover:bg-black/30 [&_svg]:text-white/80">
            {children}
          </div>
        ) : null}

        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow">
            {view.displayName}
          </h1>
          {view.subtitle ? (
            <p className="text-sm text-white/80">{view.subtitle}</p>
          ) : null}
          {description ? (
            <p className="mt-1 max-w-prose text-sm text-white/70 line-clamp-2">{description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
