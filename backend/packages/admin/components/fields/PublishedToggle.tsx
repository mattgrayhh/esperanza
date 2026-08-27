'use client';

// =============================================================================
// PublishedToggle — the publish-gate control. The admin toggle is the ONLY path that
// sets a record live (published=1 / active=1 / status≠'Draft'); ingest's force-0-on-
// sold is separate and enforced server-side.
//
// Three gate kinds:
//   published (qmi/communities/floor_plans/blogs) → boolean, via togglePublished.
//   active    (promotions)                        → boolean, via toggleActive.
//   status    (testimonials)                      → select,  via setTestimonialStatus
//                                                     ('Draft' hides; else live).
// Each calls its dedicated server action so the publish/unpublish audit row is written
// in exactly one place.
//
// Re-skinned with shadcn (Switch for boolean gates, Select for the status gate). The
// action wiring is UNCHANGED — togglePublished/toggleActive/setTestimonialStatus still
// fire on toggle/select, with the same optimistic local state + onResult bubbling.
// =============================================================================

import { useState, useTransition } from 'react';
import {
  togglePublished,
  toggleActive,
  setStatus as setRecordStatus,
} from '../../lib/actions';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Result = { ok: true } | { ok: false; error: string };

export function PublishedToggle({
  entityKey,
  id,
  gate,
  initialPublished,
  initialStatus,
  statusOptions,
  onResult,
}: {
  entityKey: string;
  id: string;
  /** which gate column drives this control. */
  gate: 'published' | 'active' | 'status';
  /** boolean gates: current value. */
  initialPublished?: boolean;
  /** status gate: current status string. */
  initialStatus?: string;
  /** status gate: select options. */
  statusOptions?: string[];
  /** bubble the action result up to the form for a status message. */
  onResult?: (msg: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [pub, setPub] = useState(Boolean(initialPublished));
  const [status, setStatus] = useState(initialStatus ?? '');

  function report(res: Result, okMsg: string) {
    if (res.ok) onResult?.(okMsg);
    else onResult?.(`Error: ${res.error}`);
  }

  function onToggleBoolean(next: boolean) {
    startTransition(async () => {
      const res = gate === 'active' ? await toggleActive(id, next) : await togglePublished(entityKey, id, next);
      if (res.ok) setPub(next);
      report(res, next ? 'Published' : 'Unpublished');
    });
  }

  function onChangeStatus(next: string) {
    setStatus(next);
    startTransition(async () => {
      const res = await setRecordStatus(entityKey, id, next);
      report(res, next === 'Draft' ? 'Set to Draft' : `Set to ${next}`);
    });
  }

  if (gate === 'status') {
    const opts = statusOptions ?? ['', 'Live', 'Draft'];
    const live = status !== 'Draft';
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className={cn('size-2 rounded-full', live ? 'bg-primary' : 'bg-muted-foreground/40')}
          aria-hidden
        />
        <Select value={status} onValueChange={(v) => onChangeStatus((v as string) ?? '')} disabled={pending}>
          <SelectTrigger size="sm" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o} value={o}>
                {o === '' ? '(unset → live)' : o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    );
  }

  const label = gate === 'active' ? 'Active' : 'Published';
  return (
    <span className="inline-flex items-center gap-2">
      <Switch checked={pub} disabled={pending} onCheckedChange={onToggleBoolean} aria-label={label} />
      <span className="text-sm text-muted-foreground">
        {pub ? label : `Draft — toggle to ${gate === 'active' ? 'activate' : 'publish'}`}
      </span>
    </span>
  );
}
