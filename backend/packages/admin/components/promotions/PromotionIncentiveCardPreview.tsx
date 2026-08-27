'use client';

import { cn } from '@/lib/utils';

export type IncentiveCardSpotlight = 'image' | 'title' | 'description' | null;

export type PromotionIncentiveCardPreviewProps = {
  title: string;
  description: string;
  imageUrl: string;
  spotlight: IncentiveCardSpotlight;
  /** When false, the whole card is muted (surface off). */
  active: boolean;
  className?: string;
};

function regionDimmed(
  spotlight: IncentiveCardSpotlight,
  region: Exclude<IncentiveCardSpotlight, null>
): boolean {
  return spotlight != null && spotlight !== region;
}

/**
 * Admin preview of the /incentives featured card: image | title + description.
 * Hovering Image / Title / Description editors sets `spotlight`.
 */
export function PromotionIncentiveCardPreview({
  title,
  description,
  imageUrl,
  spotlight,
  active,
  className,
}: PromotionIncentiveCardPreviewProps) {
  const hero = imageUrl.trim();
  const heading = title.trim() || 'Promotion title';
  const body = description.trim();
  const dimRest = spotlight != null;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-white text-[#2a2723] shadow-sm transition-opacity duration-300',
        !active && 'opacity-50',
        className
      )}
      aria-label="Incentives page card preview"
    >
      <div className="grid grid-cols-1 gap-0 md:grid-cols-[minmax(0,42%)_minmax(0,58%)]">
        <div
          className={cn(
            'relative min-h-[200px] overflow-hidden bg-[#e8e4dc] transition-all duration-300 md:min-h-[280px]',
            regionDimmed(spotlight, 'image') && 'opacity-35 brightness-75',
            spotlight === 'image' && 'ring-2 ring-primary ring-inset'
          )}
        >
          {hero ? (
            <img
              src={hero}
              alt=""
              className={cn(
                'size-full object-cover transition-all duration-300',
                dimRest && spotlight !== 'image' && 'brightness-[0.55] saturate-75'
              )}
            />
          ) : (
            <div className="flex size-full items-center justify-center px-4 text-center text-xs text-[#8a857c]">
              No image yet — turn on Image below to upload
            </div>
          )}
        </div>

        <div className="flex flex-col justify-center gap-3 px-5 py-6 md:px-8 md:py-8">
          <div
            className={cn(
              'transition-all duration-300',
              regionDimmed(spotlight, 'title') && 'opacity-35',
              spotlight === 'title' && 'rounded-md ring-2 ring-primary ring-offset-2'
            )}
          >
            <h3 className="font-heading text-xl font-semibold leading-tight tracking-tight text-[#2a2723] md:text-2xl">
              {heading}
            </h3>
            <div className="mt-3 h-0.5 w-16 bg-[#2f5d4a]" aria-hidden />
          </div>

          <div
            className={cn(
              'transition-all duration-300',
              regionDimmed(spotlight, 'description') && 'opacity-35',
              spotlight === 'description' && 'rounded-md ring-2 ring-primary ring-offset-2'
            )}
          >
            {body ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#4a4a4a]">{body}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description yet — turn on Description below to edit
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
