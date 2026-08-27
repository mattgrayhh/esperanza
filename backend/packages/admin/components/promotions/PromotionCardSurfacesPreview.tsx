'use client';

import {
  promoBannerStyleFromCopy,
  PROMO_BANNER_STYLE_CLASSES,
} from '@esperanza/db/promo-banner-style';
import { cn } from '@/lib/utils';

export type CardSurfaceSpotlight = 'badge' | 'incentive' | 'cta' | null;

export type PromotionCardSurfacesPreviewProps = {
  badgeText: string;
  incentiveText: string;
  ctaLabel: string;
  showBadge: boolean;
  showCta: boolean;
  spotlight: CardSurfaceSpotlight;
  active: boolean;
  className?: string;
};

function regionDimmed(
  spotlight: CardSurfaceSpotlight,
  region: Exclude<CardSurfaceSpotlight, null>
): boolean {
  return spotlight != null && spotlight !== region;
}

/**
 * Admin preview of community/home card promo surfaces:
 * corner badge + green/gold incentive line (Show Card Badge), promo line + Learn More pill (Show Card CTA).
 */
export function PromotionCardSurfacesPreview({
  badgeText,
  incentiveText,
  ctaLabel,
  showBadge,
  showCta,
  spotlight,
  active,
  className,
}: PromotionCardSurfacesPreviewProps) {
  const badge = badgeText.trim();
  const incentive = incentiveText.trim();
  const incentiveStyle = promoBannerStyleFromCopy(incentive, badge);
  const cta = ctaLabel.trim() || 'Learn More';
  const dimRest = spotlight != null;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-white text-[#2a2723] shadow-sm transition-opacity duration-300',
        !active && 'opacity-50',
        className
      )}
      aria-label="Card surfaces preview"
    >
      <div className="grid grid-cols-1 sm:grid-cols-[58%_42%]">
        <div className="relative aspect-[4/3] overflow-hidden bg-[#e8e4dc]">
          <div
            className={cn(
              'flex size-full items-center justify-center text-xs text-[#8a857c] transition-all duration-300',
              dimRest && 'opacity-40'
            )}
          >
            Listing photo
          </div>

          <div className="pointer-events-none absolute inset-0 z-[2]">
            {showBadge && badge ? (
              <div
                className={cn(
                  'absolute top-2.5 right-0 bg-[#2f5d4a] px-3 py-1 text-[10px] tracking-wide text-white uppercase transition-all duration-300',
                  regionDimmed(spotlight, 'badge') && 'opacity-25 brightness-75',
                  spotlight === 'badge' &&
                    'z-10 ring-2 ring-white/80 ring-offset-1 ring-offset-black/20'
                )}
              >
                {badge}
              </div>
            ) : null}

            {showBadge && incentive ? (
              <div
                className={cn(
                  'absolute top-2.5 left-0 max-w-[calc(100%-5.5rem)] px-3.5 py-1.5 text-[10px] leading-tight font-light tracking-wide uppercase transition-all duration-300',
                  PROMO_BANNER_STYLE_CLASSES[incentiveStyle],
                  regionDimmed(spotlight, 'incentive') && 'opacity-25 brightness-75',
                  spotlight === 'incentive' &&
                    'z-10 ring-2 ring-white/80 ring-offset-1 ring-offset-black/20'
                )}
              >
                {incentive}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col justify-between gap-3 bg-[#f3f1ed] px-4 py-4">
          <div className={cn('space-y-1 transition-all duration-300', dimRest && 'opacity-40')}>
            <p className="text-[10px] tracking-wider text-[#c4b59a] uppercase">Community</p>
            <p className="text-sm font-medium text-[#2a2723]">Sample Community</p>
            <p className="text-xs text-[#4a4a4a]">From $450,000</p>
          </div>

          {showCta ? (
            <div
              className={cn(
                'space-y-2 transition-all duration-300',
                regionDimmed(spotlight, 'cta') && 'opacity-35',
                spotlight === 'cta' && 'rounded-md ring-2 ring-primary ring-offset-2'
              )}
            >
              {incentive || badge ? (
                <p className="text-[11px] font-semibold tracking-wide text-brand uppercase">
                  {incentive || badge}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground italic">Promo line (Headline)</p>
              )}
              <span className="inline-flex items-center rounded-full bg-[#1a3328] px-4 py-1.5 text-[11px] font-semibold tracking-wider text-white uppercase">
                {cta}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
