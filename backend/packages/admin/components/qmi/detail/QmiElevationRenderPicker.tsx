'use client';

// =============================================================================
// QmiElevationRenderPicker — MarkSystems gallery of the linked plan's elevation
// renderings. Marketing picks which exterior render is this home's site Main Image
// (`image_url`). When the card title/filename encodes a known elevation, the parent
// also pins elevation_type + material_type overrides.
// =============================================================================

import { CheckIcon, ImageIcon } from 'lucide-react';
import type { TypedImage } from '@/lib/elevation-types';
import { deriveElevationType } from '@/lib/elevation-types';
import { FieldLabel } from '@/components/fields/FieldLabel';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function titleFor(item: TypedImage): string {
  const explicit = item.type.trim();
  if (explicit) return explicit;
  return deriveElevationType(item.url) ?? fileStem(item.url) ?? 'Elevation render';
}

function fileStem(url: string): string | null {
  const base = url.split(/[?#]/)[0]?.split('/').pop() ?? '';
  if (!base) return null;
  return base.replace(/\.(jpg|jpeg|png|webp|gif|svg|avif)$/i, '').replace(/[_-]+/g, ' ') || null;
}

export function QmiElevationRenderPicker({
  options,
  selectedUrl,
  onSelect,
  floorPlanName,
}: {
  options: TypedImage[];
  selectedUrl: string;
  onSelect: (item: TypedImage | null) => void;
  floorPlanName?: string;
}) {
  if (options.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        No elevation renders on {floorPlanName ? `the ${floorPlanName} plan` : 'the linked plan'} yet.
        Add them under Floor Plans → Elevation Gallery.
      </div>
    );
  }

  const selected = selectedUrl.trim();

  return (
    <div className="grid gap-2 text-sm sm:col-span-2">
      <FieldLabel
        label="Site elevation render"
        help="Pick which plan elevation rendering shows as this home’s Main Image on the site. When the filename encodes the style (e.g. Tuscan_Brick), Elevation Type and Material unlock as overrides on Save."
      >
        {selected ? (
          <Badge
            className="h-4 border-warning/30 bg-warning/10 px-1.5 text-[10px] font-semibold tracking-wide text-warning uppercase"
          >
            override
          </Badge>
        ) : null}
      </FieldLabel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {options.map((item) => {
          const title = titleFor(item);
          const isSelected = selected !== '' && selected === item.url;
          return (
            <button
              key={item.url}
              type="button"
              onClick={() => onSelect(isSelected ? null : item)}
              className={cn(
                'group overflow-hidden rounded-md border bg-muted/20 text-left transition-colors',
                isSelected
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'border-border hover:border-primary/40 hover:bg-muted/40'
              )}
              aria-pressed={isSelected}
              title={title}
            >
              <div className="relative aspect-[4/3] bg-muted/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={title} className="size-full object-cover" />
                {isSelected ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-primary/80">
                    <CheckIcon className="size-8 text-white drop-shadow" strokeWidth={2.5} />
                  </span>
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/10 group-hover:opacity-100">
                    <ImageIcon className="size-5 text-white drop-shadow" />
                  </span>
                )}
              </div>
              <div className="border-t px-2 py-1.5">
                <p className="truncate text-xs font-medium">{title}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
