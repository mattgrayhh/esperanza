'use client';

// =============================================================================
// EntityEditForm — the CONFIG-DRIVEN edit engine (client). One component renders the
// editor for ANY of the 9 entities from a resolved field list.
//
// Layout: a header (back link + title + publish-gate toggle + save status), then a
// two-column body INSIDE one <form action={saveEntity}>:
//   - MAIN column (left): override / synced / admin fields
//       · override fields  → SyncedOverrideField (routes through buildOverrideWrite/Audit)
//       · synced fields    → read-only GenericField('synced')
//       · admin fields     → GenericField (text/textarea/number/boolean/richtext/select)
//   - RIGHT RAIL: the image widgets (ImageUploader). These STILL live inside the same
//       <form>, so they submit into the same saveEntity FormData (field names unchanged).
// The publish-bucket gate field is NOT a form input — it's the header toggle (its own
// action). The custom side-widgets (hoaLinks / jsonBlocks / promoScopeTag) render
// BELOW the form with their own save buttons, since they call dedicated actions.
//
// All view data is precomputed server-side (RSC) and passed in as plain JSON so this
// stays a thin presentational shell.
//
// Re-skinned with shadcn (Card/Button/Badge/Separator). Every field NAME and the
// <form action={saveEntity}> submission are UNCHANGED.
// =============================================================================

import { useState } from 'react';
import { PencilIcon } from 'lucide-react';
import { saveEntity } from '../lib/actions';
import { GenericField } from './fields/GenericField';
import { ImageUploader } from './fields/ImageUploader';
import { ImageGalleryEditor } from './fields/ImageGalleryEditor';
import { ElevationGalleryEditor } from './fields/ElevationGalleryEditor';
import { SyncedOverrideField } from './fields/SyncedOverrideField';
import { PublishedToggle } from './fields/PublishedToggle';
import { DeleteEntityButton } from './DeleteEntityButton';
import type { SelectOption } from '../lib/select-options';
import type { SelectOptionItem } from '../lib/field-config';
import type { LiveSitePlacement } from '@/lib/live-site';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  EditToast,
  MarkSystemsSection,
  PlacementRail,
  RecordEditBreadcrumb,
  RecordEditLayout,
  SectionJumpNav,
  StickyActionBar,
  UnsavedLeaveToast,
  sectionId,
} from '@/components/record-edit/RecordEditShell';
import { useEditSaveFeedback } from '@/components/record-edit/useEditSaveFeedback';
import { MAIN_SAVE_SIDE_WIDGETS, SideWidgetBlock } from '@/components/record-edit/SideWidgetBlock';
import { PromotionIncentiveSection } from '@/components/promotions/PromotionIncentiveSection';
import { PromotionSurfacesSection } from '@/components/promotions/PromotionSurfacesSection';

/** Fields owned by promo surface preview sections — skip in the generic field loop. */
const PROMO_SURFACE_OWNED = new Set([
  'show_incentive_page',
  'title',
  'copy',
  'image_url',
  'show_site_banner',
  'show_banner_button',
  'show_card_badge',
  'show_card_cta',
  'badge_text',
  'banner_text',
  'cta_label',
  'cta_url',
]);

function promoBool(raw: string): boolean {
  return raw === '1' || raw === 'true';
}

// --- the per-field view model the RSC builds (one of these unions per field) ---

export type FieldView =
  | {
      kind: 'generic';
      field: string;
      label: string;
      widget:
        | 'text'
        | 'textarea'
        | 'number'
        | 'currency'
        | 'boolean'
        | 'richtext'
        | 'wysiwyg'
        | 'date'
        | 'select'
        | 'synced';
      value: string;
      step?: 'any' | '1';
      options?: SelectOption[];
      staticOptions?: string[];
      /** builder {value,label} options (custom select fields) → SelectField. */
      optionItems?: SelectOptionItem[];
      readOnly?: boolean;
      help?: string;
      halfWidth?: boolean;
      group?: string;
    }
  | {
      kind: 'image';
      field: string;
      label: string;
      value: string;
      help?: string;
      group?: string;
    }
  | {
      kind: 'imageGallery';
      field: string;
      label: string;
      value: string; // serialized JSON array of URLs
      help?: string;
      group?: string;
    }
  | {
      kind: 'elevationGallery';
      field: string;
      label: string;
      value: string; // serialized JSON array of { url, type }
      help?: string;
      group?: string;
    }
  | {
      kind: 'syncedOverride';
      field: string;
      label: string;
      variant: 'text' | 'number' | 'select';
      syncedDisplay: string;
      overrideValue: string;
      step?: 'any' | '1';
      options?: SelectOption[];
      help?: string;
      halfWidth?: boolean;
      group?: string;
    };

export interface PublishGateView {
  gate: 'published' | 'active' | 'status';
  published?: boolean;
  status?: string;
  statusOptions?: string[];
}

export interface HoaLinksView {
  kind: 'hoaLinks';
  initial: Array<{ title: string; link: string }>;
}
export interface JsonBlocksView {
  kind: 'jsonBlocks';
  copy: Record<string, string>;
  venue: Record<string, string>;
}
export interface PromoSurfaces {
  siteBanner: boolean;
  bannerButton: boolean;
  cardBadge: boolean;
  cardCta: boolean;
  incentivePage: boolean;
}
export interface PromoScopeView {
  kind: 'promoScope';
  global: boolean;
  selected: { cities: string[]; communities: string[]; floorPlans: string[]; qmis: string[] };
  options: {
    cities: SelectOption[];
    communities: SelectOption[];
    floorPlans: SelectOption[];
    qmis: SelectOption[];
  };
  /** SAVED surface toggles + publish gate — feed the "Where will this show" summary. */
  surfaces: PromoSurfaces;
  published: boolean;
}
export interface CommunityFloorPlansView {
  kind: 'communityFloorPlans';
  communityName: string;
  selected: string[];
  options: SelectOption[];
}
export type SideWidget = HoaLinksView | JsonBlocksView | PromoScopeView | CommunityFloorPlansView;

export function EntityEditForm({
  entityKey,
  segment,
  label,
  id,
  displayName,
  subtitle = '',
  fields,
  publishGate,
  sideWidgets,
  liveSite,
  preview = false,
}: {
  entityKey: string;
  segment: string;
  label: string;
  id: string;
  displayName: string;
  /** Small line under the H1. Empty → omitted (we no longer show the raw `· recXXXX` id;
   *  communities show the city, testimonials show nothing — feedback [4][35][36]). */
  subtitle?: string;
  fields: FieldView[];
  publishGate: PublishGateView | null;
  sideWidgets: SideWidget[];
  liveSite?: LiveSitePlacement;
  /** LIVE PREVIEW (Field Builder): render the form read-only with no save/submit. */
  preview?: boolean;
}) {
  const formId = `entity-edit-${entityKey}-${id}`;
  const [activeSection, setActiveSection] = useState<string | undefined>();
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

  function onSubmit(formData: FormData) {
    if (preview) return;
    startTransition(async () => {
      const res = await saveEntity(entityKey, id, formData);
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

  // Split fields: single-image widgets go to the right rail; everything else (including
  // imageGallery) to the main column. Promotions: surface copy + toggles are owned by
  // PromotionIncentiveSection / PromotionSurfacesSection.
  const imageFields = fields.filter(
    (f) => f.kind === 'image' && !(entityKey === 'promotions' && PROMO_SURFACE_OWNED.has(f.field)),
  );
  const mainFields = fields.filter(
    (f): f is Exclude<(typeof fields)[number], { kind: 'image' }> =>
      f.kind !== 'image' &&
      !(entityKey === 'promotions' && PROMO_SURFACE_OWNED.has(f.field)),
  );

  // [21][5][6] Group the main fields into section cards by their `group`
  // (field_definitions.group_label). Ungrouped fields fall under "Details".
  // First-seen order is preserved so the Field Builder's sort drives section order.
  // An explicit group_label (set in the Field Builder) always wins. Otherwise fall back
  // to a sensible default so the form reads as form-layout2 sections instead of one slab:
  // synced/override → "Pricing & specifications"; long copy → "Content"; the rest → "Details".
  // mainFields excludes the image variant (TS narrows it from the `kind !== 'image'`
  // predicate); keep that narrowing so the section render can read generic-field props.
  type MainField = (typeof mainFields)[number];
  const groupOf = (f: MainField): string => {
    if (f.group) return f.group;
    if (f.kind === 'syncedOverride') return 'Pricing & specifications';
    if (f.kind === 'generic' && f.widget === 'synced') return 'Pricing & specifications';
    if (f.kind === 'generic' && (f.widget === 'richtext' || f.widget === 'textarea')) return 'Content';
    if (entityKey === 'promotions') return 'Promotion Details';
    return 'Details';
  };
  const sections: { label: string; fields: MainField[] }[] = [];
  const sectionIndex = new Map<string, number>();
  for (const f of mainFields) {
    const g = groupOf(f);
    let idx = sectionIndex.get(g);
    if (idx === undefined) {
      idx = sections.length;
      sectionIndex.set(g, idx);
      sections.push({ label: g, fields: [] });
    }
    sections[idx]!.fields.push(f);
  }

  // Promotions: Start/End dates first in Promotion Details regardless of DB sort_order.
  if (entityKey === 'promotions') {
    const details = sections.find((s) => s.label === 'Promotion Details');
    if (details) {
      const dateOrder = new Map([
        ['start_date', 0],
        ['end_date', 1],
      ]);
      details.fields.sort((a, b) => {
        const ai = dateOrder.get(a.field) ?? 100;
        const bi = dateOrder.get(b.field) ?? 100;
        return ai - bi;
      });
    }
  }

  const isMarkSystemsSection = (section: { label: string; fields: MainField[] }) =>
    section.label === 'Pricing & specifications' ||
    section.fields.every(
      (f) =>
        f.kind === 'syncedOverride' || (f.kind === 'generic' && f.widget === 'synced'),
    );

  const jumpSections = sections.map((s) => ({ id: sectionId(s.label), label: s.label }));

  const promoFieldStr = (key: string) => {
    const f = fields.find((x) => x.field === key);
    return f && 'value' in f ? String(f.value ?? '') : '';
  };

  const promoIncentiveInitial =
    entityKey === 'promotions'
      ? {
          showIncentivePage: promoBool(promoFieldStr('show_incentive_page')),
          title: promoFieldStr('title'),
          description: promoFieldStr('copy'),
          imageUrl: promoFieldStr('image_url'),
        }
      : null;

  const promoSurfacesInitial =
    entityKey === 'promotions'
      ? {
          showSiteBanner: promoBool(promoFieldStr('show_site_banner')),
          showBannerButton: promoBool(promoFieldStr('show_banner_button')),
          showCardBadge: promoBool(promoFieldStr('show_card_badge')),
          showCardCta: promoBool(promoFieldStr('show_card_cta')),
          badgeText: promoFieldStr('badge_text'),
          bannerText: promoFieldStr('banner_text'),
          ctaLabel: promoFieldStr('cta_label'),
          ctaUrl: promoFieldStr('cta_url'),
        }
      : null;

  const mediaRail =
    imageFields.length > 0 ? (
      <div className="min-w-0 space-y-4">
        <h3 className="text-sm font-medium text-foreground">Media</h3>
        {imageFields.map((f) =>
          f.kind === 'image' ? (
            <ImageUploader
              key={f.field}
              entity={entityKey}
              id={id}
              field={f.field}
              label={f.label}
              initialUrl={f.value}
              help={f.help}
              compact
            />
          ) : null,
        )}
      </div>
    ) : null;

  function renderField(f: MainField, span: string) {
    if (f.kind === 'syncedOverride') {
      return (
        <div key={f.field} className={span}>
          <SyncedOverrideField
            field={f.field}
            label={f.label}
            variant={f.variant}
            syncedDisplay={f.syncedDisplay}
            overrideValue={f.overrideValue}
            step={f.step}
            options={f.options}
            help={f.help}
          />
        </div>
      );
    }
    if (f.kind === 'imageGallery') {
      return (
        <div key={f.field} className="col-span-1 sm:col-span-2">
          <ImageGalleryEditor
            entity={entityKey}
            id={id}
            field={f.field}
            label={f.label}
            initialValue={f.value}
            help={f.help}
          />
        </div>
      );
    }
    if (f.kind === 'elevationGallery') {
      return (
        <div key={f.field} className="col-span-1 sm:col-span-2">
          <ElevationGalleryEditor
            entity={entityKey}
            id={id}
            field={f.field}
            label={f.label}
            initialValue={f.value}
            help={f.help}
          />
        </div>
      );
    }
    return (
      <div key={f.field} className={span}>
        <GenericField
          field={f.field}
          label={f.label}
          widget={f.widget}
          value={f.value}
          step={f.step}
          options={f.options}
          staticOptions={f.staticOptions}
          optionItems={f.optionItems}
          readOnly={f.readOnly}
          help={f.help}
          entity={entityKey}
          id={id}
        />
      </div>
    );
  }

  const mainColumn = (
    <>
      <div className="mb-5 space-y-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="font-heading min-w-0 truncate text-2xl font-semibold tracking-tight text-foreground">
            {displayName}
          </h1>
          {!preview ? (
            <button
              type="button"
              aria-label="Jump to name field"
              onClick={() => {
                const el = document
                  .getElementById(formId)
                  ?.querySelector<HTMLElement>('input[name="name"], textarea[name="name"]');
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el?.focus();
              }}
              className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
            >
              <PencilIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
        {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
        {!preview && entityKey !== 'promotions' ? (
          <SectionJumpNav sections={jumpSections} />
        ) : null}
      </div>

      <div className="min-w-0 space-y-5">
        {!preview && promoSurfacesInitial ? (
          <PromotionSurfacesSection initial={promoSurfacesInitial} />
        ) : null}
        {!preview && promoIncentiveInitial ? (
          <PromotionIncentiveSection entityId={id} initial={promoIncentiveInitial} />
        ) : null}

        {sections
          .filter((section) => section.fields.length > 0)
          .map((section) => {
          const sid = sectionId(section.label);
          const grid = (
            <div className={cn('grid grid-cols-1 gap-4', !preview && 'sm:grid-cols-2')}>
              {section.fields.map((f) => {
                const span = preview
                  ? 'col-span-1'
                  : 'halfWidth' in f && f.halfWidth
                    ? 'sm:col-span-1'
                    : 'col-span-1 sm:col-span-2';
                return renderField(f, span);
              })}
            </div>
          );

          if (!preview && isMarkSystemsSection(section)) {
            return (
              <div
                key={section.label}
                id={sid}
                onFocusCapture={() => setActiveSection(sid)}
                onMouseEnter={() => setActiveSection(sid)}
              >
                <MarkSystemsSection>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {section.fields.map((f) => {
                      const span =
                        'halfWidth' in f && f.halfWidth ? 'sm:col-span-1' : 'col-span-1 sm:col-span-2';
                      return renderField(f, span);
                    })}
                  </div>
                </MarkSystemsSection>
              </div>
            );
          }

          return (
            <Card
              key={section.label}
              id={sid}
              onFocusCapture={() => setActiveSection(sid)}
              onMouseEnter={() => setActiveSection(sid)}
            >
              <CardHeader className="border-b">
                <CardTitle className="text-base font-medium">{section.label}</CardTitle>
              </CardHeader>
              <CardContent>{grid}</CardContent>
            </Card>
          );
        })}

        {preview
          ? null
          : sideWidgets
              .filter((w) => MAIN_SAVE_SIDE_WIDGETS.has(w.kind))
              .map((w, i) => (
                <SideWidgetBlock key={`in-${i}`} id={id} widget={w} onResult={reportResult} />
              ))}
      </div>
    </>
  );

  const publishControl =
    publishGate && !preview ? (
      <PublishedToggle
        entityKey={entityKey}
        id={id}
        gate={publishGate.gate}
        initialPublished={publishGate.published}
        initialStatus={publishGate.status}
        statusOptions={publishGate.statusOptions}
        onResult={reportResult}
      />
    ) : undefined;

  const formBody =
    preview || !liveSite ? (
      mainColumn
    ) : (
      <RecordEditLayout
        main={mainColumn}
        rail={
          <PlacementRail
            placement={liveSite}
            activeSectionId={activeSection}
            media={mediaRail}
            publishControl={publishControl}
          />
        }
      />
    );

  return (
    <div className="mx-auto w-full max-w-7xl">
      {!preview ? (
        <>
          <RecordEditBreadcrumb
            collectionLabel={label}
            collectionHref={`/${segment}`}
            recordName={displayName}
          />
          <div className="mt-3">
            <StickyActionBar
              formId={formId}
              pending={pending}
              statusText={barStatusText}
              statusTone={barTone}
            >
              {id !== 'new' ? (
                <DeleteEntityButton
                  entityKey={entityKey}
                  id={id}
                  segment={segment}
                  displayName={displayName}
                  synced={entityKey === 'qmi' || entityKey === 'communities' || entityKey === 'floor_plans'}
                  onResult={reportResult}
                />
              ) : null}
            </StickyActionBar>
          </div>
          <EditToast message={toast?.message ?? null} tone={toast?.tone ?? 'success'} onDismiss={dismissToast} />
          <UnsavedLeaveToast
            open={leavePrompt != null}
            pending={pending}
            onSave={saveBeforeLeave}
            onDiscard={discardLeave}
            onStay={stayOnPage}
          />
        </>
      ) : (
        <div className="mb-3 flex items-center gap-2">
          <h1 className="font-heading text-lg font-semibold">{displayName}</h1>
          <Badge variant="outline" className="h-5">
            Preview
          </Badge>
        </div>
      )}

      <div className="mt-5">
        <form id={formId} action={onSubmit}>
          {formBody}
        </form>

        {preview
          ? null
          : sideWidgets
              .filter((w) => !MAIN_SAVE_SIDE_WIDGETS.has(w.kind))
              .map((w, i) => (
                <div key={i} className="mt-6">
                  <SideWidgetBlock id={id} widget={w} onResult={reportResult} />
                </div>
              ))}
      </div>
    </div>
  );
}
