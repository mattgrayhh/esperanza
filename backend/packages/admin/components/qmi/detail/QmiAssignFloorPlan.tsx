'use client';

// =============================================================================
// QmiAssignFloorPlan — the prominent "Assign floor plan" lead shown for UNASSIGNED
// drafts (floor_plan_id NULL — just arrived from Snowflake with housenumber+address).
//
// THE 80-90% AUTO-FILL MOMENT: assigning a floor plan sets floor_plan_id, which the
// floor-plan join then resolves into beds/baths/sqft/images/description/base-price.
//
// Saves through the EXISTING write path: saveEntity('qmi', id, formData) with
// formData field name "floor_plan_id" — a QMI override field, so saveEntity routes it
// through buildOverrideWrite/buildOverrideAudit (audit_log +
// first-primary session, all unchanged). On success we router.refresh() so the RSC
// re-reads the row and the auto-filled values render.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveEntity } from '@/lib/actions';
import type { SelectOption } from '@/lib/select-options';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sparkles } from 'lucide-react';

export function QmiAssignFloorPlan({
  id,
  options,
  onResult,
}: {
  id: string;
  options: SelectOption[];
  onResult?: (msg: string) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();

  function onAssign() {
    if (value.trim() === '') {
      onResult?.('Error: pick a floor plan first');
      return;
    }
    startTransition(async () => {
      // SAME write path + SAME field name as the generic engine's floor_plan_id input.
      const fd = new FormData();
      fd.set('floor_plan_id', value);
      const res = await saveEntity('qmi', id, fd);
      if (res.ok) {
        onResult?.('Floor plan assigned');
        router.refresh(); // re-read the row → beds/baths/sqft/images/price auto-fill
      } else {
        onResult?.(`Error: ${res.error}`);
      }
    });
  }

  return (
    <Card className="border-amber-300 bg-amber-50/60 py-5 dark:border-amber-900/60 dark:bg-amber-950/20">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-amber-600 dark:text-amber-400" />
          Assign a floor plan
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This home doesn&apos;t have a floor plan yet. Assign one and it auto-fills the beds,
          baths, square footage, images, description, and base price from the plan — give it a
          few minutes to sync through.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={value} onValueChange={(v) => setValue((v as string) ?? '')}>
            <SelectTrigger className="w-full sm:max-w-md">
              <SelectValue placeholder="Select a floor plan…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={onAssign} disabled={pending || value.trim() === ''}>
            {pending ? 'Assigning…' : 'Assign floor plan'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
