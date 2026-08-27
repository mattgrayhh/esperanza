'use client';

import { GenericField } from '../../fields/GenericField';
import { SyncedOverrideField } from '../../fields/SyncedOverrideField';
import type { FieldView } from '../../EntityEditForm';
import { MarkSystemsSection } from '@/components/record-edit/RecordEditShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function isMarkSystemsField(f: FieldView): boolean {
  return f.kind === 'syncedOverride' || (f.kind === 'generic' && f.widget === 'synced');
}

export function CommunityBasicInfo({ fields }: { fields: FieldView[] }) {
  const adminFields = fields.filter((f) => !isMarkSystemsField(f));
  const markFields = fields.filter(isMarkSystemsField);

  return (
    <div className="space-y-4" id="section-basic-info">
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base font-medium">Basic Info</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {adminFields.map((f) => {
            if (f.kind !== 'generic') return null;
            return (
              <div key={f.field}>
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
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {markFields.length > 0 ? (
        <MarkSystemsSection>
          <div className="grid gap-4 sm:grid-cols-2">
            {markFields.map((f) => {
              if (f.kind === 'syncedOverride') {
                return (
                  <div key={f.field}>
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
              if (f.kind === 'generic') {
                return (
                  <div key={f.field}>
                    <GenericField
                      field={f.field}
                      label={f.label}
                      widget={f.widget}
                      value={f.value}
                      help={f.help}
                    />
                  </div>
                );
              }
              return null;
            })}
          </div>
        </MarkSystemsSection>
      ) : null}
    </div>
  );
}
