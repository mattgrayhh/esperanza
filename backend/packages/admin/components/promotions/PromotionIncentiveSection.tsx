'use client';

import { useState, type FocusEvent } from 'react';
import { FieldLabel } from '@/components/fields/FieldLabel';
import { ImageUploader } from '@/components/fields/ImageUploader';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sectionId } from '@/components/record-edit/RecordEditShell';
import {
  PromotionIncentiveCardPreview,
  type IncentiveCardSpotlight,
} from './PromotionIncentiveCardPreview';

export type PromotionIncentiveInitial = {
  showIncentivePage: boolean;
  title: string;
  description: string;
  imageUrl: string;
};

/**
 * Incentives-page surface editor: master "Show on Incentives Page" toggle, live
 * card preview with hover spotlight, and Image / Title / Description section
 * toggles that reveal the matching editors when on.
 */
export function PromotionIncentiveSection({
  entityId,
  initial,
}: {
  entityId: string;
  initial: PromotionIncentiveInitial;
}) {
  const [showIncentivePage, setShowIncentivePage] = useState(initial.showIncentivePage);
  const [showImage, setShowImage] = useState(Boolean(initial.imageUrl.trim()));
  const [showTitle, setShowTitle] = useState(Boolean(initial.title.trim()));
  const [showDescription, setShowDescription] = useState(Boolean(initial.description.trim()));
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);
  const [spotlight, setSpotlight] = useState<IncentiveCardSpotlight>(null);

  function spotlightHandlers(region: Exclude<IncentiveCardSpotlight, null>) {
    return {
      onMouseEnter: () => setSpotlight(region),
      onMouseLeave: () => setSpotlight(null),
      onFocusCapture: () => setSpotlight(region),
      onBlurCapture: (e: FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setSpotlight(null);
        }
      },
    };
  }

  return (
    <Card id={sectionId('Incentives page')}>
      <CardHeader className="border-b">
        <CardTitle className="text-base font-medium">Incentives page</CardTitle>
        <p className="text-xs text-muted-foreground">
          Featured card on <code className="text-[0.7rem]">/incentives</code>. Turn the surface
          on, then enable Image / Title / Description to edit each part. Hover a section to
          spotlight it on the preview.
        </p>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-1.5 text-sm">
          <FieldLabel
            label="Show on Incentives Page"
            help="Featured card on the dedicated /incentives page (image, title, description)."
          />
          <div className="flex h-8 items-center gap-2">
            <input
              type="hidden"
              name="show_incentive_page"
              value={showIncentivePage ? '1' : '0'}
            />
            <Switch
              checked={showIncentivePage}
              onCheckedChange={setShowIncentivePage}
              aria-label="show_incentive_page"
            />
            <span className="text-sm text-muted-foreground">
              {showIncentivePage ? 'true' : 'false'}
            </span>
          </div>
        </div>

        {showIncentivePage ? (
          <>
            <PromotionIncentiveCardPreview
              title={showTitle ? title : ''}
              description={showDescription ? description : ''}
              imageUrl={showImage ? imageUrl : ''}
              spotlight={spotlight}
              active={showIncentivePage}
            />

            <div className="grid gap-4">
              <SectionToggle
                label="Image"
                checked={showImage}
                onCheckedChange={setShowImage}
                {...spotlightHandlers('image')}
              >
                <ImageUploader
                  entity="promotions"
                  id={entityId}
                  field="image_url"
                  label="Image"
                  initialUrl={imageUrl}
                  onUrlChange={setImageUrl}
                  help="Photo on the left of the incentives card."
                />
              </SectionToggle>
              {!showImage ? <input type="hidden" name="image_url" value={imageUrl} /> : null}

              <SectionToggle
                label="Title"
                checked={showTitle}
                onCheckedChange={setShowTitle}
                {...spotlightHandlers('title')}
              >
                <div className="grid gap-1.5 text-sm">
                  <FieldLabel
                    label="Title"
                    help="Heading on the incentives card (right column)."
                  />
                  <Input
                    name="title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
              </SectionToggle>
              {!showTitle ? <input type="hidden" name="title" value={title} /> : null}

              <SectionToggle
                label="Description"
                checked={showDescription}
                onCheckedChange={setShowDescription}
                {...spotlightHandlers('description')}
              >
                <div className="grid gap-1.5 text-sm">
                  <FieldLabel
                    label="Description"
                    help="Body copy under the title on the incentives card."
                  />
                  <Textarea
                    name="copy"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={5}
                  />
                </div>
              </SectionToggle>
              {!showDescription ? <input type="hidden" name="copy" value={description} /> : null}
            </div>
          </>
        ) : (
          <>
            {/* Keep values in FormData so turning the surface off doesn't wipe content. */}
            <input type="hidden" name="title" value={title} />
            <input type="hidden" name="copy" value={description} />
            {imageUrl ? <input type="hidden" name="image_url" value={imageUrl} /> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SectionToggle({
  label,
  checked,
  onCheckedChange,
  children,
  onMouseEnter,
  onMouseLeave,
  onFocusCapture,
  onBlurCapture,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children?: React.ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocusCapture?: () => void;
  onBlurCapture?: (e: FocusEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="rounded-lg border border-border/80 bg-muted/20 p-3"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <div className="flex items-center gap-2">
          <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            aria-label={`Show ${label}`}
          />
          <span className="text-xs text-muted-foreground">{checked ? 'On' : 'Off'}</span>
        </div>
      </div>
      {checked && children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
