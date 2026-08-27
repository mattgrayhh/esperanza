'use client';

import { useMemo, useState, type FocusEvent } from 'react';
import { FieldLabel } from '@/components/fields/FieldLabel';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sectionId } from '@/components/record-edit/RecordEditShell';
import {
  QmiListingCardPreview,
  type ListingCardSpotlight,
} from './QmiListingCardPreview';

type MarketingValues = {
  incentive: string;
  availabilityText: string;
  availableNow: boolean;
  selfTourAvailable: boolean;
  nterNow: string;
};

export function QmiMarketingSection({
  initial,
  resolvedListingPromoText,
  preferredPromotionId,
  applicablePromos,
  card,
}: {
  initial: MarketingValues;
  /** Effective promo headline from linked promotions (mirrors live API promo_text). */
  resolvedListingPromoText: string;
  /** 0030: current qmi.preferred_promotion_id ('' when unset). */
  preferredPromotionId: string;
  /** Promotions that currently apply to this home, resolution order (default first). */
  applicablePromos: Array<{ id: string; title: string; isDefault: boolean }>;
  card: {
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
  };
}) {
  const [incentive, setIncentive] = useState(initial.incentive);
  const [availabilityText, setAvailabilityText] = useState(initial.availabilityText);
  const [availableNow, setAvailableNow] = useState(initial.availableNow);
  const [selfTourAvailable, setSelfTourAvailable] = useState(initial.selfTourAvailable);
  const [nterNow, setNterNow] = useState(initial.nterNow);
  const [spotlight, setSpotlight] = useState<ListingCardSpotlight>(null);

  const listingPromoText = useMemo(
    () => incentive.trim() || resolvedListingPromoText.trim(),
    [resolvedListingPromoText, incentive]
  );

  function spotlightHandlers(region: Exclude<ListingCardSpotlight, null>) {
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
    <Card id={sectionId('Marketing')}>
      <CardHeader className="border-b">
        <CardTitle className="text-base font-medium">Marketing</CardTitle>
        <p className="text-xs text-muted-foreground">
          Hover or focus a field below to spotlight that banner on the listing card.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <QmiListingCardPreview
          address={card.address}
          cityName={card.cityName}
          price={card.price}
          bedroomCount={card.bedroomCount}
          bathroomCount={card.bathroomCount}
          livingSquareFootage={card.livingSquareFootage}
          totalSquareFootage={card.totalSquareFootage}
          communityName={card.communityName}
          floorPlanName={card.floorPlanName}
          lotNumber={card.lotNumber}
          imageUrl={card.imageUrl}
          incentive={listingPromoText}
          availabilityText={availabilityText}
          availableNow={availableNow}
          selfTourAvailable={selfTourAvailable}
          spotlight={spotlight}
        />

        <div className="grid gap-1.5 text-sm" {...spotlightHandlers('incentive')}>
          <FieldLabel
            label="Incentive Banner Text"
            help="Per-home promo bar on the listing card. Leave blank when a linked promotion supplies the headline (4.99% rate promos show green; flex copy shows gold). Editing this field overrides the preview only until you save."
          />
          <Textarea
            name="incentive"
            value={incentive}
            onChange={(e) => setIncentive(e.target.value)}
            rows={3}
          />
        </div>

        {applicablePromos.length > 0 && (
          <div className="grid gap-1.5 text-sm" {...spotlightHandlers('incentive')}>
            <FieldLabel
              label="Preferred Incentive"
              help={
                applicablePromos.length > 1
                  ? `${applicablePromos.length} promotions currently apply to this home. Pick which one shows on the card, or leave Default to use the most specific target (then promotion order).`
                  : 'Only one promotion currently applies — the picker matters once several do.'
              }
            />
            <select
              name="preferred_promotion_id"
              defaultValue={preferredPromotionId}
              className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
            >
              <option value="">
                Default — {applicablePromos.find((p) => p.isDefault)?.title ?? '(none)'}
              </option>
              {applicablePromos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Promo Text hidden pending clarity on how it maps to the live card vs Incentive.
            Omitting from FormData is safe — saveEntity only patches present keys. */}

        <div className="grid gap-1.5 text-sm" {...spotlightHandlers('availability')}>
          <FieldLabel
            label="Availability Text"
            help="Gray banner on the card (e.g. Available Sep/Oct 2026). Turn on Available Now to force the green Available Now banner."
          />
          <Input
            name="availability_text"
            type="text"
            value={availabilityText}
            onChange={(e) => setAvailabilityText(e.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 text-sm" {...spotlightHandlers('available_now')}>
            <FieldLabel label="Available Now" />
            <div className="flex h-8 items-center gap-2">
              <input type="hidden" name="available_now" value={availableNow ? '1' : '0'} />
              <Switch
                checked={availableNow}
                onCheckedChange={setAvailableNow}
                aria-label="available_now"
              />
              <span className="text-sm text-muted-foreground">
                {availableNow ? 'true' : 'false'}
              </span>
            </div>
          </div>

          <div className="grid gap-1.5 text-sm" {...spotlightHandlers('self_tour')}>
            <FieldLabel
              label='Show "Self Tour Available" Banner?'
              help="Shows the Self-Touring Available banner (with house icon) on the listing card."
            />
            <div className="flex h-8 items-center gap-2">
              <input
                type="hidden"
                name="self_tour_available"
                value={selfTourAvailable ? '1' : '0'}
              />
              <Switch
                checked={selfTourAvailable}
                onCheckedChange={setSelfTourAvailable}
                aria-label="self_tour_available"
              />
              <span className="text-sm text-muted-foreground">
                {selfTourAvailable ? 'true' : 'false'}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-1.5 text-sm" {...spotlightHandlers('self_tour')}>
          <FieldLabel
            label="Self-Tour Link (NterNow)"
            help="The NterNow booking URL the “Self-Touring Available” button opens (e.g. https://www.webflow.nternow.com/EsperanzaHomes/property/…). Turn on the toggle above to show the banner."
          />
          <Input
            name="nter_now"
            type="url"
            inputMode="url"
            placeholder="https://www.webflow.nternow.com/EsperanzaHomes/property/…"
            value={nterNow}
            onChange={(e) => setNterNow(e.target.value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
