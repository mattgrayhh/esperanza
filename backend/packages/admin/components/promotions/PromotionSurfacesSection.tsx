'use client';

import { useState, type FocusEvent } from 'react';
import { FieldLabel } from '@/components/fields/FieldLabel';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sectionId } from '@/components/record-edit/RecordEditShell';
import {
  PromotionSiteBannerPreview,
  type SiteBannerSpotlight,
} from './PromotionSiteBannerPreview';
import {
  PromotionCardSurfacesPreview,
  type CardSurfaceSpotlight,
} from './PromotionCardSurfacesPreview';

export type PromotionSurfacesInitial = {
  showSiteBanner: boolean;
  showBannerButton: boolean;
  showCardBadge: boolean;
  showCardCta: boolean;
  badgeText: string;
  bannerText: string;
  ctaLabel: string;
  ctaUrl: string;
};

/**
 * Site banner + card badge/CTA surface editors. Shared copy fields
 * (badge_text, banner_text, cta_*) are emitted once via hidden inputs so FormData
 * never duplicates names across the two previews.
 */
export function PromotionSurfacesSection({ initial }: { initial: PromotionSurfacesInitial }) {
  const [showSiteBanner, setShowSiteBanner] = useState(initial.showSiteBanner);
  const [showBannerButton, setShowBannerButton] = useState(initial.showBannerButton);
  const [showCardBadge, setShowCardBadge] = useState(initial.showCardBadge);
  const [showCardCta, setShowCardCta] = useState(initial.showCardCta);
  const [badgeText, setBadgeText] = useState(initial.badgeText);
  const [bannerText, setBannerText] = useState(initial.bannerText);
  const [ctaLabel, setCtaLabel] = useState(initial.ctaLabel);
  const [ctaUrl, setCtaUrl] = useState(initial.ctaUrl);
  const [bannerSpotlight, setBannerSpotlight] = useState<SiteBannerSpotlight>(null);
  const [cardSpotlight, setCardSpotlight] = useState<CardSurfaceSpotlight>(null);

  function bannerHandlers(region: Exclude<SiteBannerSpotlight, null>) {
    return {
      onMouseEnter: () => setBannerSpotlight(region),
      onMouseLeave: () => setBannerSpotlight(null),
      onFocusCapture: () => setBannerSpotlight(region),
      onBlurCapture: (e: FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setBannerSpotlight(null);
        }
      },
    };
  }

  function cardHandlers(region: Exclude<CardSurfaceSpotlight, null>) {
    return {
      onMouseEnter: () => setCardSpotlight(region),
      onMouseLeave: () => setCardSpotlight(null),
      onFocusCapture: () => setCardSpotlight(region),
      onBlurCapture: (e: FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setCardSpotlight(null);
        }
      },
    };
  }

  const cardActive = showCardBadge || showCardCta;

  return (
    <>
      {/* Single FormData source for shared copy — editors below are nameless. */}
      <input type="hidden" name="badge_text" value={badgeText} />
      <input type="hidden" name="banner_text" value={bannerText} />
      <input type="hidden" name="cta_label" value={ctaLabel} />
      <input type="hidden" name="cta_url" value={ctaUrl} />
      <input type="hidden" name="show_site_banner" value={showSiteBanner ? '1' : '0'} />
      <input type="hidden" name="show_banner_button" value={showBannerButton ? '1' : '0'} />
      <input type="hidden" name="show_card_badge" value={showCardBadge ? '1' : '0'} />
      <input type="hidden" name="show_card_cta" value={showCardCta ? '1' : '0'} />

      <Card id={sectionId('Site banner')}>
        <CardHeader className="border-b">
          <CardTitle className="text-base font-medium">Site banner</CardTitle>
          <p className="text-xs text-muted-foreground">
            Green site-wide header ticker. Hover Banner Overlay Promo or CTA to spotlight.
          </p>
        </CardHeader>
        <CardContent className="grid gap-5">
          <BooleanRow
            label="Show on Site Banner"
            help="Site-wide header ticker (Banner Overlay Promo + optional CTA button)."
            checked={showSiteBanner}
            onCheckedChange={setShowSiteBanner}
            ariaLabel="show_site_banner"
          />

          {showSiteBanner ? (
            <>
              <PromotionSiteBannerPreview
                bannerText={badgeText}
                ctaLabel={ctaLabel}
                showButton={showBannerButton}
                spotlight={bannerSpotlight}
                active={showSiteBanner}
              />

              <div className="grid gap-1.5 text-sm" {...bannerHandlers('text')}>
                <FieldLabel
                  label="Banner Overlay Promo"
                  help="Centered text in the green site banner."
                />
                <Input
                  type="text"
                  value={badgeText}
                  onChange={(e) => setBadgeText(e.target.value)}
                />
              </div>

              <BooleanRow
                label="Show Banner Button"
                help="Dark pill CTA on the right of the site banner."
                checked={showBannerButton}
                onCheckedChange={setShowBannerButton}
                ariaLabel="show_banner_button"
              />

              {showBannerButton ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5 text-sm" {...bannerHandlers('cta')}>
                    <FieldLabel label="CTA Label" help="Button label on the site banner." />
                    <Input
                      type="text"
                      value={ctaLabel}
                      onChange={(e) => setCtaLabel(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5 text-sm" {...bannerHandlers('cta')}>
                    <FieldLabel label="CTA URL" help="Link for the banner button." />
                    <Input
                      type="text"
                      value={ctaUrl}
                      onChange={(e) => setCtaUrl(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card id={sectionId('Card surfaces')}>
        <CardHeader className="border-b">
          <CardTitle className="text-base font-medium">Card surfaces</CardTitle>
          <p className="text-xs text-muted-foreground">
            Corner badge + incentive line on listing cards, and optional Learn More CTA.
            Hover a field to spotlight it on the preview.
          </p>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <BooleanRow
              label="Show Card Badge"
              help="Corner badge (Banner Overlay Promo) + incentive line (Headline) on cards."
              checked={showCardBadge}
              onCheckedChange={setShowCardBadge}
              ariaLabel="show_card_badge"
            />
            <BooleanRow
              label="Show Card CTA Button"
              help="Learn More pill on community / home cards."
              checked={showCardCta}
              onCheckedChange={setShowCardCta}
              ariaLabel="show_card_cta"
            />
          </div>

          {cardActive ? (
            <>
              <PromotionCardSurfacesPreview
                badgeText={badgeText}
                incentiveText={bannerText}
                ctaLabel={ctaLabel}
                showBadge={showCardBadge}
                showCta={showCardCta}
                spotlight={cardSpotlight}
                active={cardActive}
              />

              {showCardBadge ? (
                <div className="grid gap-4">
                  <div className="grid gap-1.5 text-sm" {...cardHandlers('badge')}>
                    <FieldLabel
                      label="Banner Overlay Promo"
                      help="Corner badge on the listing card image."
                    />
                    <Input
                      type="text"
                      value={badgeText}
                      onChange={(e) => setBadgeText(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5 text-sm" {...cardHandlers('incentive')}>
                    <FieldLabel
                      label="Headline"
                      help="Promo line on the card image. 4.99% rate promos render green; flex promos render gold."
                    />
                    <Input
                      type="text"
                      value={bannerText}
                      onChange={(e) => setBannerText(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}

              {showCardCta ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5 text-sm" {...cardHandlers('cta')}>
                    <FieldLabel label="CTA Label" help="Learn More button label on cards." />
                    <Input
                      type="text"
                      value={ctaLabel}
                      onChange={(e) => setCtaLabel(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5 text-sm" {...cardHandlers('cta')}>
                    <FieldLabel label="CTA URL" help="Link for the card CTA." />
                    <Input
                      type="text"
                      value={ctaUrl}
                      onChange={(e) => setCtaUrl(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

function BooleanRow({
  label,
  help,
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      <FieldLabel label={label} help={help} />
      <div className="flex h-8 items-center gap-2">
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={ariaLabel} />
        <span className="text-sm text-muted-foreground">{checked ? 'true' : 'false'}</span>
      </div>
    </div>
  );
}
