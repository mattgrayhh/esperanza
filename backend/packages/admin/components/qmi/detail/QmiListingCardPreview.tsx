'use client';

import { HomeIcon } from 'lucide-react';
import {
  classifyPromoBannerStyle,
  PROMO_BANNER_STYLE_CLASSES,
} from '@esperanza/db/promo-banner-style';
import { cn } from '@/lib/utils';

export type ListingCardSpotlight =
  | 'incentive'
  | 'availability'
  | 'available_now'
  | 'self_tour'
  | null;

export type QmiListingCardPreviewProps = {
  address: string;
  cityName: string;
  price: number | null;
  bedroomCount: number | null;
  bathroomCount: number | null;
  livingSquareFootage: number | null;
  totalSquareFootage: number | null;
  communityName: string;
  floorPlanName: string;
  lotNumber: string;
  imageUrl: string;
  incentive: string;
  availabilityText: string;
  availableNow: boolean;
  selfTourAvailable: boolean;
  spotlight: ListingCardSpotlight;
  className?: string;
};

function usd(v: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function fmt(v: number | null): string {
  return v == null ? '—' : v.toLocaleString();
}

/** Match live QuickMoveIns availability banner copy. */
export function availabilityBannerLabel(
  availabilityText: string,
  availableNow: boolean
): string {
  const raw = availabilityText.trim();
  if (raw) {
    return /^available/i.test(raw) ? raw.toUpperCase() : `AVAILABLE ${raw}`.toUpperCase();
  }
  if (availableNow) return 'AVAILABLE NOW';
  return '';
}

function regionDimmed(
  spotlight: ListingCardSpotlight,
  region: Exclude<ListingCardSpotlight, null>
): boolean {
  return spotlight != null && spotlight !== region;
}

function Spec({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <li className="flex items-center gap-2 text-[11px] text-[#4a4a4a]">
      <span className="size-1.5 shrink-0 rounded-full bg-[#c4b59a]" aria-hidden />
      <span>
        <span className="font-medium text-[#2a2723]">{value}</span> {label}
      </span>
    </li>
  );
}

/**
 * Admin preview of the live QMI listing card. Hovering a Marketing field sets
 * `spotlight` so the matching banner stays bright while the rest of the image fades.
 */
export function QmiListingCardPreview({
  address,
  cityName,
  price,
  bedroomCount,
  bathroomCount,
  livingSquareFootage,
  totalSquareFootage,
  communityName,
  floorPlanName,
  lotNumber,
  imageUrl,
  incentive,
  availabilityText,
  availableNow,
  selfTourAvailable,
  spotlight,
  className,
}: QmiListingCardPreviewProps) {
  const promoBannerText = incentive.trim();
  const promoStyle = classifyPromoBannerStyle(promoBannerText);
  const availLabel = availabilityBannerLabel(availabilityText, availableNow);
  const showAvailNowStyle = availableNow || /\bnow\b/i.test(availLabel);
  const hero = imageUrl.trim();
  const dimRest = spotlight != null;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-white text-[#2a2723] shadow-sm',
        className
      )}
      aria-label="Live listing card preview"
    >
      <div className="grid grid-cols-1 sm:grid-cols-[58%_42%]">
        <div className="flex min-h-0 flex-col">
          <div className="relative aspect-[4/3] overflow-hidden bg-[#e8e4dc]">
            {hero ? (
              <img
                src={hero}
                alt=""
                className={cn(
                  'size-full object-cover transition-all duration-300',
                  dimRest && 'brightness-[0.55] saturate-75'
                )}
              />
            ) : (
              <div
                className={cn(
                  'flex size-full items-center justify-center text-xs text-[#8a857c] transition-all duration-300',
                  dimRest && 'opacity-40'
                )}
              >
                No hero image
              </div>
            )}

            <div className="pointer-events-none absolute inset-0 z-[2]">
              <div className="absolute top-2.5 left-0 flex max-w-[calc(100%-5.5rem)] flex-col items-start gap-1.5">
                {promoBannerText ? (
                  <div
                    className={cn(
                      'px-3.5 py-1.5 text-[10px] leading-tight font-light tracking-wide uppercase transition-all duration-300',
                      PROMO_BANNER_STYLE_CLASSES[promoStyle],
                      regionDimmed(spotlight, 'incentive') && 'opacity-25 brightness-75',
                      spotlight === 'incentive' && 'z-10 ring-2 ring-white/80 ring-offset-1 ring-offset-black/20'
                    )}
                  >
                    {promoBannerText}
                  </div>
                ) : null}

                {availLabel ? (
                  <div
                    className={cn(
                      'px-3.5 py-1.5 text-[10px] leading-tight font-light tracking-wide text-white uppercase transition-all duration-300',
                      showAvailNowStyle ? 'bg-[#2f5d4a]' : 'bg-[#4a4a4a]',
                      regionDimmed(spotlight, 'availability') &&
                        regionDimmed(spotlight, 'available_now') &&
                        'opacity-25 brightness-75',
                      (spotlight === 'availability' || spotlight === 'available_now') &&
                        'z-10 ring-2 ring-white/80 ring-offset-1 ring-offset-black/20'
                    )}
                  >
                    {showAvailNowStyle && !/\bnow\b/i.test(availLabel)
                      ? 'AVAILABLE NOW'
                      : availLabel}
                  </div>
                ) : null}
              </div>

              {lotNumber.trim() ? (
                <div
                  className={cn(
                    'absolute top-2.5 right-0 bg-[#ece8e0] px-3 py-1 text-[10px] tracking-wide text-[#2a2723] uppercase transition-all duration-300',
                    dimRest && 'opacity-30'
                  )}
                >
                  Lot #{lotNumber.trim()}
                </div>
              ) : null}

              {selfTourAvailable ? (
                <div
                  className={cn(
                    'absolute bottom-2.5 left-0 z-[2] flex items-center gap-2 bg-black px-[18px] py-[7px] text-[11px] leading-none font-light tracking-[0.3px] text-white uppercase transition-all duration-300',
                    regionDimmed(spotlight, 'self_tour') && 'opacity-25 brightness-75',
                    spotlight === 'self_tour' &&
                      'z-10 ring-2 ring-white/80 ring-offset-1 ring-offset-black/20'
                  )}
                >
                  <HomeIcon
                    className="size-3.5 shrink-0 text-white"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  Self-Touring Available
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-3 bg-[#f3f1ed] px-3.5 py-3.5">
            <div className="flex flex-col gap-0.5">
              <p className="text-[10px] tracking-wider text-[#c4b59a] uppercase underline underline-offset-2">
                Community
              </p>
              <p className="text-xs leading-snug text-[#2a2723]">
                {communityName.trim() || '—'}
              </p>
            </div>
            <div className="flex flex-col gap-0.5 border-l border-black/10 pl-3">
              <p className="text-[10px] tracking-wider text-[#c4b59a] uppercase underline underline-offset-2">
                Floor Plan
              </p>
              <p className="text-xs leading-snug text-[#2a2723]">
                {floorPlanName.trim() || '—'}
              </p>
            </div>
          </div>
        </div>

        <div
          className={cn(
            'flex flex-col gap-3 px-4 py-4 transition-opacity duration-300',
            dimRest && 'opacity-45'
          )}
        >
          <div>
            <p className="font-serif text-lg leading-tight text-[#2a2723]">
              {address.trim() || 'Address TBD'}
            </p>
            <p className="mt-0.5 text-sm text-[#2f5d4a]">{cityName.trim() || '—'}</p>
          </div>
          <p className="text-2xl font-semibold tracking-tight">{usd(price)}</p>
          <ul className="space-y-1.5">
            <Spec label="Bedrooms" value={fmt(bedroomCount)} />
            <Spec label="Bathrooms" value={fmt(bathroomCount)} />
            <Spec label="Living Sq. Ft." value={fmt(livingSquareFootage)} />
            <Spec label="Total Sq. Ft." value={fmt(totalSquareFootage)} />
          </ul>
        </div>
      </div>
    </div>
  );
}
