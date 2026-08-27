'use client';

import { ImageGalleryEditor } from '../../fields/ImageGalleryEditor';
import { ImageUploader } from '../../fields/ImageUploader';
import { GenericField } from '../../fields/GenericField';
import type { CommunityDetailView } from '../../../lib/community-detail';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FieldView } from '../../EntityEditForm';

type Media = CommunityDetailView['media'];

function imgUrl(f: FieldView): string {
  return f.kind === 'image' ? f.value : '';
}

export function CommunityMediaBar({ id, media }: { id: string; media: Media }) {
  const logo = media.logo;

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle className="text-base font-medium">Media</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-4">
        <ImageUploader
          entity="communities"
          id={id}
          field={logo.field}
          label={logo.label}
          initialUrl={imgUrl(logo)}
          help={'help' in logo ? (logo.help as string | undefined) : undefined}
          compact
        />

        {media.featuredVideo.kind === 'generic' ? (
          <GenericField
            field={media.featuredVideo.field}
            label={media.featuredVideo.label}
            widget={media.featuredVideo.widget}
            value={media.featuredVideo.value}
            help={media.featuredVideo.help}
            entity="communities"
            id={id}
          />
        ) : null}

        <ImageGalleryEditor
          entity="communities"
          id={id}
          field="photo_gallery_json"
          label="Photo Gallery"
          initialValue={media.galleryJson}
          help={'help' in media.gallery ? (media.gallery.help as string | undefined) : undefined}
          compact
        />
      </CardContent>
    </Card>
  );
}
