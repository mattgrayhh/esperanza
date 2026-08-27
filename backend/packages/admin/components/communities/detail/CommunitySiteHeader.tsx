'use client';

import { HeroImageSlot } from '../../fields/HeroImageSlot';
import type { CommunityDetailView } from '../../../lib/community-detail';
import { sectionId } from '@/components/record-edit/RecordEditShell';
import { cn } from '@/lib/utils';
import { COMMUNITY_SITE_HEADER_TITLE } from './CommunityRemainingFields';

import type { FieldView } from '../../EntityEditForm';

type Media = CommunityDetailView['media'];

function imgUrl(f: FieldView): string {
  return f.kind === 'image' ? f.value : '';
}

export function CommunitySiteHeader({
  id,
  displayName,
  media,
  className,
}: {
  id: string;
  displayName: string;
  media: Media;
  className?: string;
}) {
  const featured = media.featured;
  const secondary = media.secondary;
  const photoGalleryImage = media.photoGalleryImage;
  const headerKey = [
    imgUrl(featured),
    imgUrl(secondary),
    imgUrl(photoGalleryImage),
  ].join('|');

  return (
    <section
      id={sectionId(COMMUNITY_SITE_HEADER_TITLE)}
      className={cn('mx-auto mb-6 w-full max-w-screen-2xl px-2 md:px-4', className)}
      aria-label={`${displayName} — live site header preview`}
    >
      <p className="sr-only">
        Matches the community page hero: featured image (left two-thirds), secondary and photo
        gallery images (right column). Drag an image onto any panel to replace it.
      </p>

      <div
        key={headerKey}
        className="grid min-h-[280px] w-full grid-cols-1 gap-3 sm:min-h-[360px] md:min-h-[420px] md:grid-cols-3"
      >
        <HeroImageSlot
          entity="communities"
          id={id}
          field="featured_image_url"
          label="Featured Image"
          initialUrl={imgUrl(featured)}
          className="min-h-[220px] md:col-span-2 md:min-h-[420px]"
        />

        <div className="grid min-h-0 grid-rows-2 gap-3">
          <HeroImageSlot
            entity="communities"
            id={id}
            field="secondary_image_url"
            label="Secondary Image"
            initialUrl={imgUrl(secondary)}
            className="min-h-[140px] md:min-h-0"
          />

          <HeroImageSlot
            entity="communities"
            id={id}
            field="photo_gallery_image_url"
            label="Photo Gallery Image"
            initialUrl={imgUrl(photoGalleryImage)}
            className="min-h-[140px] md:min-h-0"
          />
        </div>
      </div>
    </section>
  );
}
