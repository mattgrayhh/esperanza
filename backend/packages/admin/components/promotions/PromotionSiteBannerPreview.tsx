'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SiteBannerSpotlight = 'text' | 'cta' | null;

export type PromotionSiteBannerPreviewProps = {
  bannerText: string;
  ctaLabel: string;
  showButton: boolean;
  spotlight: SiteBannerSpotlight;
  active: boolean;
  className?: string;
};

function regionDimmed(
  spotlight: SiteBannerSpotlight,
  region: Exclude<SiteBannerSpotlight, null>
): boolean {
  return spotlight != null && spotlight !== region;
}

/**
 * Admin preview of the site-wide green header ticker (Show on Site Banner).
 * Center copy = Banner Overlay Promo; right pill = CTA when Show Banner Button is on.
 */
export function PromotionSiteBannerPreview({
  bannerText,
  ctaLabel,
  showButton,
  spotlight,
  active,
  className,
}: PromotionSiteBannerPreviewProps) {
  const text = bannerText.trim() || 'Banner Overlay Promo';
  const label = ctaLabel.trim() || 'LEARN MORE!';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border shadow-sm transition-opacity duration-300',
        !active && 'opacity-50',
        className
      )}
      aria-label="Site banner preview"
    >
      <div className="relative flex min-h-[52px] items-center justify-center gap-3 bg-[#2f5d4a] px-10 py-3 text-white">
        <button
          type="button"
          tabIndex={-1}
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded p-1 text-white/70"
          aria-hidden
        >
          <ChevronLeft className="size-5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-white/70"
          aria-hidden
        >
          <ChevronRight className="size-5" strokeWidth={1.5} />
        </button>

        <div
          className={cn(
            'max-w-[min(100%,36rem)] text-center text-[13px] font-medium tracking-wide transition-all duration-300 sm:text-sm',
            regionDimmed(spotlight, 'text') && 'opacity-35',
            spotlight === 'text' && 'rounded-md ring-2 ring-white/80 ring-offset-2 ring-offset-[#2f5d4a]'
          )}
        >
          {text}
        </div>

        {showButton ? (
          <div
            className={cn(
              'shrink-0 transition-all duration-300',
              regionDimmed(spotlight, 'cta') && 'opacity-35',
              spotlight === 'cta' && 'rounded-full ring-2 ring-white/80 ring-offset-2 ring-offset-[#2f5d4a]'
            )}
          >
            <span className="inline-flex items-center rounded-full bg-[#1a3328] px-4 py-1.5 text-[11px] font-semibold tracking-wider text-white uppercase">
              {label}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
