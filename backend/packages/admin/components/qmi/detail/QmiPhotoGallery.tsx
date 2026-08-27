'use client';

// =============================================================================
// QmiPhotoGallery — the property photo grid + full-gallery dialog. Adapted from
// bundui real-estate/detail (page hero/sub-image grid + photo-gallery-dialog) to take
// the QMI's resolved images (floor-plan fp_image + fp_additional_images + any home-
// level urls). Presentational only — never writes.
// =============================================================================

import { Button } from '@/components/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ImageIcon } from 'lucide-react';
import type { GalleryImage } from '@/lib/qmi-detail';

function PhotoGalleryDialog({ images }: { images: GalleryImage[] }) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm">
            {images.length} photos
          </Button>
        }
      />
      <DialogContent className="border-0 p-0 sm:max-w-4xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Photo Gallery</DialogTitle>
          <DialogDescription>Browse all listing photos.</DialogDescription>
        </DialogHeader>
        <Carousel opts={{ align: 'start' }}>
          <CarouselContent>
            {images.map((image, i) => (
              <CarouselItem key={`${image.url}-${i}`}>
                <div className="relative aspect-video overflow-hidden rounded-md border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={image.alt}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-3" />
          <CarouselNext className="right-3" />
        </Carousel>
      </DialogContent>
    </Dialog>
  );
}

export function QmiPhotoGallery({ images, alt }: { images: GalleryImage[]; alt: string }) {
  if (images.length === 0) {
    return (
      <section className="flex min-h-[220px] items-center justify-center rounded-md border border-dashed bg-muted/30 text-muted-foreground">
        <div className="flex flex-col items-center gap-2 text-sm">
          <ImageIcon className="size-6 opacity-60" />
          No photos yet. Assign a floor plan to pull its renderings.
        </div>
      </section>
    );
  }

  const [main, ...subImages] = images;
  const sub = subImages.slice(0, 4);

  return (
    <section className="grid gap-3 lg:grid-cols-3">
      <div className="relative min-h-[250px] overflow-hidden rounded-md border lg:col-span-2 lg:min-h-[420px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={main!.url}
          alt={main!.alt || alt}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>

      {sub.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
          {sub.map((image, index) => (
            <div
              className="relative min-h-[150px] overflow-hidden rounded-md border lg:min-h-[200px]"
              key={`${image.url}-${index}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.alt || alt}
                className="absolute inset-0 h-full w-full object-cover"
              />
              {index === sub.length - 1 && images.length > 1 ? (
                <div className="absolute right-3 bottom-3">
                  <PhotoGalleryDialog images={images} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-end justify-end">
          <PhotoGalleryDialog images={images} />
        </div>
      )}
    </section>
  );
}
