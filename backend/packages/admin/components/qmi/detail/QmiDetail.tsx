'use client';

// =============================================================================
// QmiDetail — the BESPOKE Quick Move-In detail screen (client shell).
//
// A real-estate property-detail page wired to the EXISTING admin write path. EVERY
// mutation routes through the documented server actions — no new write paths.
// =============================================================================

import { useId, useMemo, useState } from 'react';
import { saveEntity } from '@/lib/actions';
import type { QmiDetailView } from '@/lib/qmi-detail';
import { parseGalleryUrls } from '@/lib/gallery-urls';
import { pickListingHero } from '@esperanza/db/listing-hero';
import {
  deriveElevationType,
  splitElevationLabel,
  type TypedImage,
} from '@/lib/elevation-types';
import { SyncedOverrideField } from '@/components/fields/SyncedOverrideField';
import { GenericField } from '@/components/fields/GenericField';
import { ImageUploader } from '@/components/fields/ImageUploader';
import { ImageGalleryEditor } from '@/components/fields/ImageGalleryEditor';
import { PublishedToggle } from '@/components/fields/PublishedToggle';
import { LOCATION_STATUS } from '@/lib/status';
import { CopyableId } from './CopyableId';
import { QmiAssignFloorPlan } from './QmiAssignFloorPlan';
import { QmiSiteHeader } from './QmiSiteHeader';
import { QmiPriceOverrideStat } from './QmiPriceOverrideStat';
import { QmiMarketingSection } from './QmiMarketingSection';
import { QmiElevationRenderPicker } from './QmiElevationRenderPicker';
import { ExpandableDescription } from './ExpandableDescription';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FieldLabel } from '@/components/fields/FieldLabel';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  EditToast,
  MarkSystemsSection,
  PlacementRail,
  RecordEditBreadcrumb,
  RecordEditLayout,
  StickyActionBar,
  UnsavedLeaveToast,
  sectionId,
} from '@/components/record-edit/RecordEditShell';
import { useEditSaveFeedback } from '@/components/record-edit/useEditSaveFeedback';
import {
  BedDouble,
  Bath,
  Ruler,
} from 'lucide-react';

function fmtNum(v: number | null): string {
  return v == null ? '—' : v.toLocaleString();
}

export function QmiDetail({ view }: { view: QmiDetailView }) {
  const formId = `qmi-edit-${view.id}`;
  const [galleryUrls, setGalleryUrls] = useState(() => parseGalleryUrls(view.photoGalleryJson));
  const [imageUrl, setImageUrl] = useState(view.admin.imageUrl);
  // Elevation override patches from the render picker — remount SyncedOverrideField via
  // `patchGen` so unlock + value apply without fighting manual unlock typing.
  const [elevationTypeOverride, setElevationTypeOverride] = useState(
    view.syncedOverride.elevationType.overrideValue
  );
  const [materialTypeOverride, setMaterialTypeOverride] = useState(
    view.syncedOverride.materialType.overrideValue
  );
  const [elevationPatchGen, setElevationPatchGen] = useState(0);
  // Locked by default (inherit plan tour); unlock only when a home-specific override exists.
  const [virtualTourUrl, setVirtualTourUrl] = useState(view.admin.virtualTourUrl);
  const [virtualTourUnlocked, setVirtualTourUnlocked] = useState(
    view.admin.virtualTourUrl.trim() !== ''
  );
  const virtualTourCheckboxId = useId();
  const slugCheckboxId = useId();
  const planTour = view.admin.virtualTourUrlDefault.trim();
  // Marketing-owned URL piece (not Snowflake). Locked by default so operators don't
  // nudge the public path by accident; unlock → edit → Save writes `slug`.
  const [slug, setSlug] = useState(view.slug);
  const [slugUnlocked, setSlugUnlocked] = useState(false);
  const listingCardHero = useMemo(
    () =>
      imageUrl.trim() ||
      pickListingHero({ galleryUrls, ogImageUrl: view.admin.ogImageUrl }) ||
      view.admin.listingHeroUrl ||
      view.admin.heroFallbackUrl,
    [imageUrl, galleryUrls, view.admin.ogImageUrl, view.admin.listingHeroUrl, view.admin.heroFallbackUrl]
  );
  const {
    pending,
    startTransition,
    reportResult,
    barStatusText,
    barTone,
    toast,
    dismissToast,
    leavePrompt,
    saveBeforeLeave,
    discardLeave,
    stayOnPage,
  } = useEditSaveFeedback(formId);

  const title = view.address.trim() || view.housenumber || view.id;

  function onSelectElevationRender(item: TypedImage | null) {
    if (!item) {
      setImageUrl('');
      return;
    }
    setImageUrl(item.url);
    const label = item.type.trim() || deriveElevationType(item.url) || '';
    const { elevationType, materialType } = splitElevationLabel(label);
    if (!elevationType && !materialType) return;
    if (elevationType) setElevationTypeOverride(elevationType);
    if (materialType) setMaterialTypeOverride(materialType);
    // Farmhouse: clear material override so we don't leave a stale Brick/Stucco pin.
    if (elevationType === 'Farmhouse') setMaterialTypeOverride('');
    setElevationPatchGen((n) => n + 1);
  }

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await saveEntity('qmi', view.id, formData);
      reportResult(
        res.ok
          ? res.siteRebuild?.status === 'scheduled'
            ? 'Saved — site update scheduled; usually about 2 minutes (allow up to 7).'
            : res.siteRebuild
              ? `Saved, but site update was not scheduled: ${res.siteRebuild.detail}`
              : 'Saved'
          : `Error: ${res.error}`
      );
    });
  }

  const stats = useMemo(
    () => [
      { icon: BedDouble, value: fmtNum(view.bedroomCount), label: 'beds' },
      { icon: Bath, value: fmtNum(view.bathroomCount), label: 'baths' },
      { icon: Ruler, value: fmtNum(view.totalSquareFootage), label: 'Total SqFt' },
      { icon: Ruler, value: fmtNum(view.livingSquareFootage), label: 'Living SqFt' },
    ],
    [view.bedroomCount, view.bathroomCount, view.totalSquareFootage, view.livingSquareFootage]
  );

  const mediaRail = (
    <div className="min-w-0 space-y-5">
      <h3 className="text-sm font-medium text-foreground">Media</h3>
      {/* Always render: the floor_plan_image override is a valid per-home column even for
          specs with no effective plan (isUnassigned) — those operators still need somewhere
          to set the home's image. */}
      <ImageUploader
        entity="qmi"
        id={view.id}
        field="floor_plan_image"
        label="Floor Plan Image"
        initialUrl={view.admin.floorPlanImage}
        fallbackPreviewUrl={view.admin.floorPlanImageDefault}
        help={
          view.admin.floorPlanImage
            ? 'Home-specific override — replaces the plan layout on the live site for this home. Clear and save to revert to the plan default.'
            : view.admin.floorPlanImageDefault
              ? `Using the ${view.floorPlanName} plan layout. Upload only if this production home differs from the standard sketch.`
              : 'Upload only when this home’s layout differs from the standard plan sketch.'
        }
        compact
      />
      <div className="grid gap-1.5 text-sm">
        <FieldLabel
          label="Virtual Tour URL"
          help="Defaults to the linked floor plan’s tour. Unlock to set a home-specific URL; clear/re-lock and save to inherit the plan tour again."
        >
          {virtualTourUnlocked && virtualTourUrl.trim() !== '' ? (
            <Badge
              className="h-4 border-warning/30 bg-warning/10 px-1.5 text-[10px] font-semibold tracking-wide text-warning uppercase"
            >
              override
            </Badge>
          ) : null}
        </FieldLabel>
        <input
          type="hidden"
          name="virtual_tour_url"
          value={virtualTourUnlocked ? virtualTourUrl : ''}
        />
        {!virtualTourUnlocked ? (
          <Input
            type="url"
            value={planTour}
            disabled
            aria-label="Virtual Tour URL (from floor plan, locked)"
          />
        ) : (
          <Input
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={virtualTourUrl}
            onChange={(e) => setVirtualTourUrl(e.target.value)}
            autoFocus
          />
        )}
        <div className="flex items-center gap-2">
          <Checkbox
            id={virtualTourCheckboxId}
            checked={virtualTourUnlocked}
            onCheckedChange={(checked) => {
              const on = checked === true;
              setVirtualTourUnlocked(on);
              if (!on) setVirtualTourUrl('');
            }}
          />
          <Label
            htmlFor={virtualTourCheckboxId}
            className="text-xs font-normal text-muted-foreground"
          >
            {virtualTourUnlocked
              ? 'Unlocked — home-specific tour overrides the floor plan'
              : 'Unlock to override floor plan tour'}
          </Label>
        </div>
      </div>
      <ImageGalleryEditor
        entity="qmi"
        id={view.id}
        field="photo_gallery_json"
        label="Photo Gallery"
        initialValue={view.photoGalleryJson}
        galleryUrls={galleryUrls}
        onGalleryUrlsChange={setGalleryUrls}
        suggestionGroups={[
          {
            label: `Interior — from ${view.floorPlanName || 'the plan'}`,
            help: "Plan interior photos. Click one to add it to this home's gallery (override).",
            urls: view.floorPlanInterior.map((g) => g.url),
          },
          {
            label: `Exterior — from ${view.floorPlanName || 'the plan'}`,
            help: "Plan exterior/listing photos. Click one to add it to this home's gallery (override).",
            urls: view.floorPlanExterior.map((g) => g.url),
          },
        ]}
        help="This home's photos in display order (overrides the plan). Slots 2 and 3 also appear in the header. Inherit from the plan's Interior / Exterior sets below, or upload home-specific photos. The elevation Render is set under MarkSystems → Site elevation render; the Schematic is the Floor Plan Image field above."
        compact
      />
    </div>
  );

  const titleWithStatus = (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {view.availableNow ? (
        <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400">
          Available now
        </Badge>
      ) : null}
      {view.isUnassigned ? (
        <Badge variant="destructive">Unassigned draft</Badge>
      ) : null}
    </div>
  );

  const mainContent = (
    <div className="space-y-4">
      <div id={sectionId('Overview')} className="sr-only">
        Overview
      </div>

      {view.isUnassigned ? (
        <div id={sectionId('Assign floor plan')}>
          <QmiAssignFloorPlan id={view.id} options={view.options.floorPlans} onResult={reportResult} />
        </div>
      ) : null}

      <Card className="py-5">
        <CardContent className="space-y-6 px-5">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 *:space-y-1 *:rounded-md *:border *:p-3 *:text-center">
            {stats.map((stat) => (
              <div key={stat.label}>
                <p className="text-2xl font-semibold">{stat.value}</p>
                <p className="inline-flex items-center gap-1 text-muted-foreground">
                  <stat.icon className="size-4" />
                  {stat.label}
                </p>
              </div>
            ))}
          </div>

          <QmiPriceOverrideStat
            price={view.price}
            syncedDisplay={view.syncedOverride.price.syncedDisplay}
            overrideValue={view.syncedOverride.price.overrideValue}
          />

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 *:min-w-0">
            <Info label="Elevation" value={view.elevation || '—'} />
            <GenericField
              field="move_in_date"
              label="Move-In Date"
              widget="date"
              value={view.admin.moveInDate}
            />
            <div className="grid min-w-0 gap-1.5 text-sm">
              <FieldLabel
                label="Slug"
                help="URL path piece for this home (admin-owned). Locked by default — unlock only when you need to change it. Changing a published slug breaks shared links."
              />
              <input type="hidden" name="slug" value={slug} />
              {slugUnlocked ? (
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="font-mono text-xs"
                  spellCheck={false}
                  autoFocus
                  aria-label="Slug (unlocked)"
                />
              ) : (
                <Input
                  value={slug || '—'}
                  disabled
                  className="font-mono text-xs"
                  aria-label="Slug (locked)"
                />
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id={slugCheckboxId}
                  checked={slugUnlocked}
                  onCheckedChange={(checked) => {
                    const on = checked === true;
                    setSlugUnlocked(on);
                    if (!on) setSlug(view.slug);
                  }}
                />
                <Label
                  htmlFor={slugCheckboxId}
                  className="text-xs font-normal text-muted-foreground"
                >
                  {slugUnlocked
                    ? 'Unlocked — edit slug, then Save'
                    : 'Unlock to edit'}
                </Label>
              </div>
            </div>
            <Info label="Floor plan" value={view.isUnassigned ? 'Unassigned' : view.floorPlanName || '—'} />
            <Info label="Community" value={view.communityName || '—'} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div id={sectionId('From MarkSystems')}>
          <MarkSystemsSection title="MarkSystems" defaultOpen={view.elevationRenders.length > 0}>
            <div className="grid gap-4 sm:grid-cols-2">
              <QmiElevationRenderPicker
                options={view.elevationRenders}
                selectedUrl={imageUrl}
                onSelect={onSelectElevationRender}
                floorPlanName={view.floorPlanName}
              />
              {!view.isUnassigned ? (
                <div className="sm:col-span-2">
                  <SyncedOverrideField {...view.relations.floorPlan} label="Floor Plan Assignment" />
                </div>
              ) : null}
              <SyncedOverrideField {...view.syncedOverride.address} />
              <SyncedOverrideField {...view.syncedOverride.bedroomCount} />
              <SyncedOverrideField {...view.syncedOverride.bathroomCount} />
              <SyncedOverrideField {...view.syncedOverride.livingSquareFootage} />
              <SyncedOverrideField {...view.syncedOverride.totalSquareFootage} />
              <SyncedOverrideField {...view.syncedOverride.elevation} />
              <SyncedOverrideField {...view.syncedOverride.lotNumber} />
              <SyncedOverrideField
                key={`elevation_type-${elevationPatchGen}`}
                {...view.syncedOverride.elevationType}
                overrideValue={elevationTypeOverride}
              />
              <SyncedOverrideField
                key={`material_type-${elevationPatchGen}`}
                {...view.syncedOverride.materialType}
                overrideValue={materialTypeOverride}
              />
              {!view.isUnassigned ? (
                <>
                  <SyncedOverrideField {...view.relations.community} />
                  <SyncedOverrideField {...view.relations.city} />
                </>
              ) : null}
            </div>
          </MarkSystemsSection>
        </div>

        <QmiMarketingSection
          initial={{
            incentive: view.admin.incentive,
            availabilityText: view.admin.availabilityText,
            availableNow: view.admin.availableNow,
            selfTourAvailable: view.admin.selfTourAvailable,
            nterNow: view.admin.nterNow,
          }}
          resolvedListingPromoText={view.resolvedListingPromoText}
          preferredPromotionId={view.preferredPromotionId}
          applicablePromos={view.applicablePromos}
          card={{
            address: view.address,
            cityName: view.cityName,
            price: view.price,
            bedroomCount: view.bedroomCount,
            bathroomCount: view.bathroomCount,
            livingSquareFootage: view.livingSquareFootage,
            totalSquareFootage: view.totalSquareFootage,
            communityName: view.communityName,
            floorPlanName: view.floorPlanName,
            lotNumber:
              view.syncedOverride.lotNumber.overrideValue.trim() ||
              view.syncedOverride.lotNumber.syncedDisplay,
            imageUrl: listingCardHero,
          }}
        />

        <Card id={sectionId('Map Coordinates')}>
          <CardHeader className="border-b">
            <CardTitle className="text-base font-medium">Map Coordinates</CardTitle>
            <p className="text-xs text-muted-foreground">
              Drives the “Get Directions” button and the map pin on the spec page. Per-home
              (each spec sits on its own lot) — leave blank for no directions link.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <GenericField
              field="latitude"
              label="Latitude"
              widget="number"
              step="any"
              value={view.admin.latitude == null ? '' : String(view.admin.latitude)}
            />
            <GenericField
              field="longitude"
              label="Longitude"
              widget="number"
              step="any"
              value={view.admin.longitude == null ? '' : String(view.admin.longitude)}
            />
            {view.admin.latitude == null &&
            view.admin.longitude == null &&
            (view.admin.geoLatitude != null || view.admin.geoLongitude != null) ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Raw geo on file: {view.admin.geoLatitude ?? '—'}, {view.admin.geoLongitude ?? '—'} —
                copy into the fields above to use it for directions.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card id={sectionId('Description')}>
          <CardHeader className="border-b">
            <CardTitle className="text-base font-medium">Description</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <GenericField
              field="description"
              label="Floorplan Description"
              widget="richtext"
              value={view.ownDescription}
              entity="qmi"
              id={view.id}
              help="Leave blank to use the floor-plan copy shown below. Set it only to override the plan description for this home — e.g. to format the features as bullet points."
            />
            {view.ownDescription.trim() === '' && view.floorPlanDescription.trim() ? (
              <div className="space-y-1.5 rounded-lg border border-dashed bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Floor-plan copy (used on the site while the override above is blank)
                </p>
                <ExpandableDescription text={view.floorPlanDescription} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Promotions membership list hidden for now — targeting still lives on each
          promotion's scope picker; revisit if operators need a home-side jump list. */}
    </div>
  );

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-screen-2xl px-2 md:px-4">
        <RecordEditBreadcrumb
          collectionLabel="Quick Move-Ins"
          collectionHref="/qmi"
          recordName={title}
        />
        <div className="mt-3">
          <StickyActionBar
            formId={formId}
            pending={pending}
            statusText={barStatusText}
            statusTone={barTone}
            title={titleWithStatus}
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <CopyableId label="Housemaster" value={view.housenumber} />
                <CopyableId label="ECI" value={view.eciKey} />
                <CopyableId label="Job" value={view.markJobNumber} />
              </div>
            }
          />
        </div>
      </div>
      <EditToast message={toast?.message ?? null} tone={toast?.tone ?? 'success'} onDismiss={dismissToast} />
      <UnsavedLeaveToast
        open={leavePrompt != null}
        pending={pending}
        onSave={saveBeforeLeave}
        onDiscard={discardLeave}
        onStay={stayOnPage}
      />

      <form id={formId} action={onSubmit} className="mt-5">
        <QmiSiteHeader
          id={view.id}
          title={title}
          imageUrl={imageUrl}
          heroFallbackUrl={view.admin.heroFallbackUrl}
          galleryUrls={galleryUrls}
          onGalleryUrlsChange={setGalleryUrls}
          onImageUrlChange={setImageUrl}
        />

        <div className="mx-auto w-full max-w-screen-2xl px-2 md:px-4">
          <RecordEditLayout
            main={mainContent}
            rail={
              <PlacementRail
                placement={view.liveSite}
                publishControl={
                  <PublishedToggle
                    entityKey="qmi"
                    id={view.id}
                    gate="status"
                    initialStatus={view.status}
                    statusOptions={LOCATION_STATUS}
                    onResult={reportResult}
                  />
                }
                media={mediaRail}
              />
            }
          />
        </div>
      </form>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('font-medium', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  );
}
