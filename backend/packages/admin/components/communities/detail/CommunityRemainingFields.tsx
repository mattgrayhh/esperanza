'use client';

import { GenericField } from '../../fields/GenericField';
import { ImageUploader } from '../../fields/ImageUploader';
import { ImageGalleryEditor } from '../../fields/ImageGalleryEditor';
import type { FieldView, CommunityFloorPlansView } from '../../EntityEditForm';
import { CommunityFloorPlansPicker } from '../../fields/CommunityFloorPlansPicker';
import { MarkSystemsSection, sectionId } from '@/components/record-edit/RecordEditShell';

/** Copy blocks nested under Community Details — fixed order. */
export const COMMUNITY_COPY_BLOCK_SECTIONS = [
  { field: 'design_copy_rich', title: 'Design' },
  { field: 'exterior_construction_copy_rich', title: 'Exterior construction' },
  { field: 'interior_construction_copy_rich', title: 'Interior construction' },
  { field: 'conservation_landscape_copy_rich', title: 'Conservation & landscape' },
  { field: 'energy_package_copy_rich', title: 'Energy package' },
  { field: 'kitchen_features_copy_rich', title: 'Kitchen features' },
  { field: 'bath_features_copy_rich', title: 'Bath features' },
  { field: 'esperanza_difference_copy_rich', title: 'Esperanza Difference' },
] as const;

export const COMMUNITY_FEATURES_TITLE = 'Community features';

export const COMMUNITY_UTILITIES_TITLE = 'Utilities';

export const COMMUNITY_LOTVUE_MAP_FIELD = 'community_map_embed';
export const COMMUNITY_LOTVUE_MAP_LABEL = 'LotVue Map (Community Map)';

export const COMMUNITY_SITE_HEADER_TITLE = 'Site header';

export const COMMUNITY_FLOOR_PLANS_TITLE = 'Floor Plans Offered';

export const COMMUNITY_SALES_OFFICE_TITLE = 'Sales office info';

const COMMUNITY_SALES_OFFICE_FIELDS = [
  'address',
  'office_hours',
  'office_phone',
  'schedule_visit',
  'directions',
] as const;

const COMMUNITY_UTILITIES_FIELDS = [
  'gas_details_rich',
  'internet_details',
  'water_details',
  'electric_details_rich',
  'security_details',
] as const;

const COMMUNITY_FEATURES_PDF_FIELDS = ['features_download_url', 'resources_download_url'] as const;

const COMMUNITY_DETAILS_EXCLUDED = new Set<string>([
  ...COMMUNITY_FEATURES_PDF_FIELDS,
  ...COMMUNITY_UTILITIES_FIELDS,
  ...COMMUNITY_SALES_OFFICE_FIELDS,
  COMMUNITY_LOTVUE_MAP_FIELD,
]);

const COPY_BLOCK_FIELDS = new Set<string>(COMMUNITY_COPY_BLOCK_SECTIONS.map((s) => s.field));

function splitCommunityDetailsFields(fields: FieldView[]) {
  const byField = new Map(fields.map((f) => [f.field, f]));
  const before: FieldView[] = [];
  const after: FieldView[] = [];
  let passedCopyBlocks = false;

  for (const f of fields) {
    if (COPY_BLOCK_FIELDS.has(f.field) || COMMUNITY_DETAILS_EXCLUDED.has(f.field)) {
      if (COPY_BLOCK_FIELDS.has(f.field)) passedCopyBlocks = true;
      continue;
    }
    if (!passedCopyBlocks) before.push(f);
    else after.push(f);
  }

  const copyBlocks = COMMUNITY_COPY_BLOCK_SECTIONS.map((s) => byField.get(s.field)).filter(
    (f): f is FieldView => f != null,
  );
  const featurePdfs = COMMUNITY_FEATURES_PDF_FIELDS.map((key) => byField.get(key)).filter(
    (f): f is FieldView => f != null,
  );
  const utilityFields = COMMUNITY_UTILITIES_FIELDS.map((key) => byField.get(key)).filter(
    (f): f is FieldView => f != null,
  );
  const lotvueMap = byField.get(COMMUNITY_LOTVUE_MAP_FIELD);
  const salesOfficeFields = COMMUNITY_SALES_OFFICE_FIELDS.map((key) => byField.get(key)).filter(
    (f): f is FieldView => f != null,
  );

  return { before, copyBlocks, featurePdfs, utilityFields, lotvueMap, salesOfficeFields, after, byField };
}

function isMarkSystemsGroup(fields: FieldView[]): boolean {
  return fields.every(
    (f) => f.kind === 'syncedOverride' || (f.kind === 'generic' && f.widget === 'synced'),
  );
}

function renderField(f: FieldView, id: string, opts?: { hideLabel?: boolean }) {
  if (f.kind === 'image') {
    return (
      <div
        key={f.field}
        className={
          f.field === 'description_image_url' ? 'col-span-1 sm:col-span-2' : 'sm:col-span-1'
        }
      >
        <ImageUploader
          entity="communities"
          id={id}
          field={f.field}
          label={f.label}
          initialUrl={f.value}
          help={f.help}
        />
      </div>
    );
  }
  if (f.kind === 'imageGallery') {
    return (
      <div key={f.field} className="col-span-1 sm:col-span-2">
        <ImageGalleryEditor
          entity="communities"
          id={id}
          field={f.field}
          label={f.label}
          initialValue={f.value}
          help={f.help}
        />
      </div>
    );
  }
  if (f.kind === 'generic') {
    return (
      <div
        key={f.field}
        className={'halfWidth' in f && f.halfWidth ? 'sm:col-span-1' : 'col-span-1 sm:col-span-2'}
      >
        <GenericField
          field={f.field}
          label={opts?.hideLabel ? '' : f.label}
          widget={f.widget}
          value={f.value}
          step={f.step}
          options={f.options}
          staticOptions={f.staticOptions}
          optionItems={f.optionItems}
          readOnly={f.readOnly}
          help={f.help}
          entity="communities"
          id={id}
        />
      </div>
    );
  }
  return null;
}

function FieldGrid({ fields, id }: { fields: FieldView[]; id: string }) {
  if (fields.length === 0) return null;
  return <div className="grid gap-4 sm:grid-cols-2">{fields.map((f) => renderField(f, id))}</div>;
}

function NestedCopyBlockSection({
  title,
  fieldKey,
  children,
}: {
  title: string;
  fieldKey: string;
  children: React.ReactNode;
}) {
  return (
    <details
      id={sectionId(title)}
      data-copy-block={fieldKey}
      className="group rounded-md border border-border/60 bg-muted/20"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-2.5 text-sm font-medium list-none [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-muted-foreground text-xs group-open:hidden">▼</span>
        <span className="text-muted-foreground text-xs hidden group-open:inline">▲</span>
      </summary>
      <div className="border-t border-border/60 px-4 py-3">{children}</div>
    </details>
  );
}

function CommunityFeaturesPdfRow({ fields, id }: { fields: FieldView[]; id: string }) {
  if (fields.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {COMMUNITY_FEATURES_PDF_FIELDS.map((fieldKey) => {
        const f = fields.find((item) => item.field === fieldKey);
        if (!f || f.kind !== 'image') return <div key={fieldKey} />;
        return (
          <ImageUploader
            key={fieldKey}
            entity="communities"
            id={id}
            field={f.field}
            label={f.label}
            initialUrl={f.value}
            help={f.help}
          />
        );
      })}
    </div>
  );
}

function CollapsibleSubsection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details
      id={sectionId(title)}
      className="group rounded-lg border border-border/60 bg-card shadow-sm"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-medium list-none [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-muted-foreground text-xs group-open:hidden">▼</span>
        <span className="text-muted-foreground text-xs hidden group-open:inline">▲</span>
      </summary>
      <div className="border-t border-border/60 px-4 py-3">{children}</div>
    </details>
  );
}

function StaticFieldSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={sectionId(title)}
      className="rounded-lg border border-border/60 bg-card p-4 shadow-sm"
    >
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CommunityDetailsBody({
  fields,
  id,
  floorPlans,
}: {
  fields: FieldView[];
  id: string;
  floorPlans?: CommunityFloorPlansView | null;
}) {
  const { before, copyBlocks, featurePdfs, utilityFields, lotvueMap, salesOfficeFields, after, byField } =
    splitCommunityDetailsFields(fields);
  const showCommunityFeatures = featurePdfs.length > 0 || copyBlocks.length > 0;

  return (
    <div className="space-y-4">
      <FieldGrid fields={before} id={id} />
      {floorPlans ? (
        <section id={sectionId(COMMUNITY_FLOOR_PLANS_TITLE)} className="max-w-2xl space-y-2">
          <h3 className="text-sm font-medium text-foreground">{COMMUNITY_FLOOR_PLANS_TITLE}</h3>
          <CommunityFloorPlansPicker
            communityId={id}
            initialSelected={floorPlans.selected}
            options={floorPlans.options}
            showFieldLabel={false}
          />
        </section>
      ) : null}
      {lotvueMap ? (
        <div id={sectionId(COMMUNITY_LOTVUE_MAP_LABEL)} className="max-w-2xl">
          {renderField({ ...lotvueMap, label: COMMUNITY_LOTVUE_MAP_LABEL }, id)}
        </div>
      ) : null}
      {showCommunityFeatures ? (
        <CollapsibleSubsection title={COMMUNITY_FEATURES_TITLE}>
          <div className="space-y-3">
            <CommunityFeaturesPdfRow fields={featurePdfs} id={id} />
            {copyBlocks.length > 0 ? (
              <div className="space-y-2">
                {COMMUNITY_COPY_BLOCK_SECTIONS.map(({ field, title }) => {
                  const f = byField.get(field);
                  if (!f) return null;
                  return (
                    <NestedCopyBlockSection key={field} title={title} fieldKey={field}>
                      {renderField(f, id, { hideLabel: true })}
                    </NestedCopyBlockSection>
                  );
                })}
              </div>
            ) : null}
          </div>
        </CollapsibleSubsection>
      ) : null}
      {utilityFields.length > 0 ? (
        <CollapsibleSubsection title={COMMUNITY_UTILITIES_TITLE}>
          <div className="grid gap-4 sm:grid-cols-2">
            {COMMUNITY_UTILITIES_FIELDS.map((fieldKey) => {
              const f = byField.get(fieldKey);
              if (!f) return null;
              return renderField(f, id);
            })}
          </div>
        </CollapsibleSubsection>
      ) : null}
      {salesOfficeFields.length > 0 ? (
        <StaticFieldSection title={COMMUNITY_SALES_OFFICE_TITLE}>
          <div className="grid gap-4 sm:grid-cols-2">
            {COMMUNITY_SALES_OFFICE_FIELDS.map((fieldKey) => {
              const f = byField.get(fieldKey);
              if (!f) return null;
              return renderField(f, id);
            })}
          </div>
        </StaticFieldSection>
      ) : null}
      <FieldGrid fields={after} id={id} />
    </div>
  );
}

export function CommunityRemainingFields({
  groups,
  id,
  floorPlans,
}: {
  groups: { group: string; fields: FieldView[] }[];
  id: string;
  floorPlans?: CommunityFloorPlansView | null;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="space-y-3">
      {groups.map(({ group, fields }) => {
        const sid = sectionId(group);
        const body =
          group === 'Community Details' ? (
            <CommunityDetailsBody fields={fields} id={id} floorPlans={floorPlans} />
          ) : (
            <FieldGrid fields={fields} id={id} />
          );

        if (isMarkSystemsGroup(fields)) {
          return (
            <div key={group} id={sid}>
              <MarkSystemsSection title={group === 'Pricing & specifications' ? 'From MarkSystems' : group}>
                {body}
              </MarkSystemsSection>
            </div>
          );
        }

        return (
          <details
            key={group}
            id={sid}
            className="group rounded-lg border bg-card text-card-foreground shadow-sm"
            open={group === 'Community Details'}
          >
            <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-3 text-sm font-medium list-none [&::-webkit-details-marker]:hidden">
              {group}
              <span className="text-muted-foreground text-xs group-open:hidden">▼</span>
              <span className="text-muted-foreground text-xs hidden group-open:inline">▲</span>
            </summary>
            <div className="border-t px-5 py-4">{body}</div>
          </details>
        );
      })}
    </div>
  );
}
