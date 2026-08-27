'use client';

import { useCallback } from 'react';
import { HeroImageSlot } from '@/components/fields/HeroImageSlot';
import { QmiGalleryHeroSlot } from './QmiGalleryHeroSlot';
import { sectionId } from '@/components/record-edit/RecordEditShell';
import { cn } from '@/lib/utils';

export const QMI_SITE_HEADER_TITLE = 'Live site header';

export function QmiSiteHeader({
  id,
  title,
  imageUrl,
  heroFallbackUrl,
  galleryUrls,
  onGalleryUrlsChange,
  onImageUrlChange,
  className,
}: {
  id: string;
  title: string;
  imageUrl: string;
  /** Floor-plan rendering shown when Main Image is blank (preview only). */
  heroFallbackUrl: string;
  galleryUrls: string[];
  onGalleryUrlsChange: (urls: string[]) => void;
  onImageUrlChange?: (url: string) => void;
  className?: string;
}) {
  const galleryUrlAt = useCallback(
    (index: number) => (index < galleryUrls.length ? galleryUrls[index]! : ''),
    [galleryUrls]
  );

  const setGalleryUrlAt = useCallback(
    (index: number, url: string) => {
      onGalleryUrlsChange(
        (() => {
          const next = [...galleryUrls];
          while (next.length <= index) next.push('');
          next[index] = url;
          return next;
        })()
      );
    },
    [galleryUrls, onGalleryUrlsChange]
  );

  const headerKey = [imageUrl, heroFallbackUrl, galleryUrlAt(1), galleryUrlAt(2)].join('|');

  return (
    <section
      id={sectionId(QMI_SITE_HEADER_TITLE)}
      className={cn('mx-auto mb-6 w-full max-w-screen-2xl px-2 md:px-4', className)}
      aria-label={`${title} — live site header preview`}
    >
      <p className="sr-only">
        Matches the QMI detail page hero: main image (left two-thirds), second and third gallery
        photos (right column). Drag an image onto any panel to replace it.
      </p>

      <div
        key={headerKey}
        className="grid min-h-[280px] w-full grid-cols-1 gap-3 sm:min-h-[360px] md:min-h-[420px] md:grid-cols-3"
      >
        <HeroImageSlot
          entity="qmi"
          id={id}
          field="image_url"
          label="Main Image"
          initialUrl={imageUrl}
          fallbackPreviewUrl={heroFallbackUrl}
          onUrlChange={onImageUrlChange}
          className="min-h-[220px] md:col-span-2 md:min-h-[420px]"
        />

        <div className="grid min-h-0 grid-rows-2 gap-3">
          <QmiGalleryHeroSlot
            entity="qmi"
            id={id}
            index={1}
            label="Gallery Photo 2"
            url={galleryUrlAt(1)}
            onUrlChange={setGalleryUrlAt}
            className="min-h-[140px] md:min-h-0"
          />
          <QmiGalleryHeroSlot
            entity="qmi"
            id={id}
            index={2}
            label="Gallery Photo 3"
            url={galleryUrlAt(2)}
            onUrlChange={setGalleryUrlAt}
            className="min-h-[140px] md:min-h-0"
          />
        </div>
      </div>
    </section>
  );
}
