'use client';

import * as React from 'react';
import { useMemo, useState, useTransition } from 'react';
import { saveCommunityFloorPlans } from '../../lib/actions';
import type { SelectOption } from '../../lib/select-options';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox';

export function CommunityFloorPlansPicker({
  communityId,
  initialSelected,
  options,
  onResult,
  showStandaloneSave = false,
  showFieldLabel = true,
}: {
  communityId: string;
  initialSelected: string[];
  options: SelectOption[];
  onResult?: (msg: string) => void;
  showStandaloneSave?: boolean;
  /** When false, the parent section supplies the heading (e.g. Community Details). */
  showFieldLabel?: boolean;
}) {
  const [sel, setSel] = useState<string[]>(initialSelected);
  const [pending, startTransition] = useTransition();
  const anchor = useComboboxAnchor();

  const labelById = useMemo(() => new Map(options.map((o) => [o.id, o.label])), [options]);
  const items = useMemo(() => options.map((o) => o.id), [options]);

  function onSave() {
    startTransition(async () => {
      const res = await saveCommunityFloorPlans(communityId, sel);
      onResult?.(
        res.ok
          ? res.changed === 0
            ? 'No changes'
            : `Floor plans saved (${res.changed} plan${res.changed === 1 ? '' : 's'} updated)`
          : `Error: ${res.error}`
      );
    });
  }

  return (
    <div className="grid gap-2">
      <input type="hidden" name="__community_floor_plans" value={JSON.stringify(sel)} />

      {showFieldLabel ? (
        <div className="flex items-center gap-1.5">
          <Label className="font-medium text-foreground">Floor plans in this community</Label>
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
            {sel.length}
          </Badge>
        </div>
      ) : null}

      <Combobox
        multiple
        autoHighlight
        items={items}
        value={sel}
        onValueChange={(next) => setSel(next ?? [])}
        itemToStringLabel={(id) => labelById.get(id) ?? id}
      >
        <ComboboxChips ref={anchor} className="w-full max-w-2xl">
          <ComboboxValue>
            {(values) => (
              <React.Fragment>
                {(values as string[]).map((id) => (
                  <ComboboxChip key={id}>{labelById.get(id) ?? id}</ComboboxChip>
                ))}
                <ComboboxChipsInput placeholder="Search floor plans…" />
              </React.Fragment>
            )}
          </ComboboxValue>
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No floor plans found.</ComboboxEmpty>
          <ComboboxList>
            {(id) => (
              <ComboboxItem key={id} value={id}>
                {labelById.get(id) ?? id}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      {showStandaloneSave ? (
        <Button type="button" onClick={onSave} disabled={pending} className="justify-self-start">
          {pending ? 'Saving…' : 'Save floor plans'}
        </Button>
      ) : null}
    </div>
  );
}
