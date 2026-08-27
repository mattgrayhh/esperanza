'use client';

// =============================================================================
// PromoScopeTagPicker — promotions targeting widget (bucket `target`).
//
// A scope picker: radio "Everything (global)" OR multi-select across
// Cities / Communities / Floor Plans / QMIs. target_type ∈ {global, city,
// community, floor_plan, qmi}. A floor-plan target cascades onto every QMI built
// on that plan (resolution: qmi > community > floor_plan > city > global).
//
// On save → savePromotionTargets REPLACES all promotion_targets rows for this promo:
//   global → one row {target_type:'global', target_id:NULL}
//   each selected id → row {target_type, target_id:<recId>}
// (DB CHECK enforces global=NULL / non-global=NOT NULL.) The action audits the replace;
// the public API reads the updated targets directly from D1.
//
// The QMI column is GROUPED BY COMMUNITY (SelectOption.group = the home's community
// name). Surface previews (Site banner / Card surfaces / Incentives page) live in
// EntityEditForm — this picker only owns targeting + __promo_targets.
//
// Re-skinned with shadcn (Card/Checkbox/Input/Button/Badge/Label). The emitted
// PromoScope payload + savePromotionTargets call are UNCHANGED.
// =============================================================================

import { useState, useTransition } from 'react';
import { ChevronDown } from 'lucide-react';
import { savePromotionTargets, type PromoScope } from '../../lib/actions';
import type { SelectOption } from '../../lib/select-options';
import type { PromoSurfaces } from '../EntityEditForm';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface Selected {
  cities: string[];
  communities: string[];
  floorPlans: string[];
  qmis: string[];
}

interface Options {
  cities: SelectOption[];
  communities: SelectOption[];
  floorPlans: SelectOption[];
  qmis: SelectOption[];
}

export function PromoScopeTagPicker({
  promoId,
  initialGlobal,
  initialSelected,
  options,
  surfaces: _surfaces,
  published: _published,
  onResult,
  showStandaloneSave = false,
}: {
  promoId: string;
  initialGlobal: boolean;
  initialSelected: Selected;
  options: Options;
  /** SAVED surface toggles (kept for SideWidgetBlock API; preview UI moved). */
  surfaces?: PromoSurfaces;
  published?: boolean;
  onResult?: (msg: string) => void;
  showStandaloneSave?: boolean;
}) {
  void _surfaces;
  void _published;
  const [mode, setMode] = useState<'global' | 'scoped'>(initialGlobal ? 'global' : 'scoped');
  const [sel, setSel] = useState<Selected>(initialSelected);
  const [pending, startTransition] = useTransition();

  function toggle(kind: keyof Selected, optId: string) {
    setSel((prev) => {
      const has = prev[kind].includes(optId);
      return { ...prev, [kind]: has ? prev[kind].filter((x) => x !== optId) : [...prev[kind], optId] };
    });
  }

  /** Select-all / clear for one section, over the ids the picker currently shows
   *  (i.e. the filtered list — QA punch list 2026-07-30, item 6). */
  function setMany(kind: keyof Selected, ids: string[], on: boolean) {
    setSel((prev) => {
      const cur = new Set(prev[kind]);
      for (const id of ids) (on ? cur.add(id) : cur.delete(id));
      return { ...prev, [kind]: [...cur] };
    });
  }

  const totalScoped =
    sel.cities.length + sel.communities.length + sel.floorPlans.length + sel.qmis.length;

  const scope: PromoScope =
    mode === 'global'
      ? { type: 'global' }
      : {
          type: 'scoped',
          cities: sel.cities,
          communities: sel.communities,
          floorPlans: sel.floorPlans,
          qmis: sel.qmis,
        };

  function onSave() {
    startTransition(async () => {
      const res = await savePromotionTargets(promoId, scope);
      onResult?.(res.ok ? 'Targeting saved' : `Error: ${res.error}`);
    });
  }

  return (
    <div className="grid gap-4">
      {/* Mirror the live scope into the parent <form> so the page's primary Save
          persists targets too — saveEntity reads __promo_targets. The standalone
          "Save targeting" button stays as a secondary path. */}
      <input type="hidden" name="__promo_targets" value={JSON.stringify(scope)} />
      <div className="flex gap-6 text-sm">
        <Label className="font-normal">
          <input
            type="radio"
            className="accent-primary"
            checked={mode === 'global'}
            onChange={() => setMode('global')}
          />
          Everything (global)
        </Label>
        <Label className="font-normal">
          <input
            type="radio"
            className="accent-primary"
            checked={mode === 'scoped'}
            onChange={() => setMode('scoped')}
          />
          Scoped ({totalScoped})
        </Label>
      </div>

      {mode === 'scoped' ? (
        <div className="flex flex-col divide-y divide-border rounded-md border">
          <AccordionPicker title="Cities" opts={options.cities} sel={sel.cities} onToggle={(o) => toggle('cities', o)} onSetMany={(ids, on) => setMany('cities', ids, on)} />
          <AccordionPicker title="Communities" opts={options.communities} sel={sel.communities} onToggle={(o) => toggle('communities', o)} onSetMany={(ids, on) => setMany('communities', ids, on)} />
          <AccordionPicker title="Floor Plans" opts={options.floorPlans} sel={sel.floorPlans} onToggle={(o) => toggle('floorPlans', o)} onSetMany={(ids, on) => setMany('floorPlans', ids, on)} />
          <AccordionPicker title="QMIs" opts={options.qmis} sel={sel.qmis} onToggle={(o) => toggle('qmis', o)} onSetMany={(ids, on) => setMany('qmis', ids, on)} grouped />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This promotion applies to every page.</p>
      )}

      {/* SurfaceSummary ("Where will this show") removed — surface previews now live
          in Site banner / Card surfaces / Incentives page sections. Targeting save
          (__promo_targets) unchanged. */}

      {showStandaloneSave ? (
        <Button type="button" onClick={onSave} disabled={pending} className="justify-self-start">
          {pending ? 'Saving…' : 'Save targeting'}
        </Button>
      ) : null}
    </div>
  );
}

function AccordionPicker({
  title,
  opts,
  sel,
  onToggle,
  onSetMany,
  grouped = false,
}: {
  title: string;
  opts: SelectOption[];
  sel: string[];
  onToggle: (id: string) => void;
  /** Bulk-set the given ids on/off — powers Select all / Clear. */
  onSetMany: (ids: string[], on: boolean) => void;
  grouped?: boolean;
}) {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? opts.filter(
        (o) =>
          o.label.toLowerCase().includes(q.toLowerCase()) ||
          (o.group ?? '').toLowerCase().includes(q.toLowerCase())
      )
    : opts;

  const groups = grouped
    ? [...filtered.reduce((m, o) => {
        const g = o.group ?? '';
        const arr = m.get(g);
        if (arr) arr.push(o);
        else m.set(g, [o]);
        return m;
      }, new Map<string, SelectOption[]>())].sort((a, b) => a[0].localeCompare(b[0]))
    : null;

  const row = (o: SelectOption) => (
    <Label key={o.id} className="gap-2 font-normal">
      <Checkbox checked={sel.includes(o.id)} onCheckedChange={() => onToggle(o.id)} />
      <span className="truncate" title={o.label}>
        {o.label}
      </span>
    </Label>
  );

  return (
    <Collapsible defaultOpen={sel.length > 0}>
      <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors [&[data-open]>svg]:rotate-180">
        <span className="flex items-center gap-2">
          {title}
          {sel.length > 0 ? (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
              {sel.length}
            </Badge>
          ) : (
            <span className="text-xs font-normal text-muted-foreground">{opts.length}</span>
          )}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2.5">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter…" className="h-7 text-xs" />
          {/* Bulk actions apply to the FILTERED list: type a community name, then
              "Select all" to grab just that community's homes. */}
          <div className="flex items-center gap-3 text-[11px]">
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline disabled:opacity-40"
              disabled={filtered.length === 0}
              onClick={() => onSetMany(filtered.map((o) => o.id), true)}
            >
              Select all{q.trim() ? ' (filtered)' : ''} ({filtered.length})
            </button>
            <button
              type="button"
              className="text-muted-foreground underline-offset-2 hover:underline disabled:opacity-40"
              disabled={filtered.every((o) => !sel.includes(o.id))}
              onClick={() => onSetMany(filtered.map((o) => o.id), false)}
            >
              Clear{q.trim() ? ' (filtered)' : ''}
            </button>
          </div>
          <div className="grid max-h-52 gap-1.5 overflow-auto text-xs">
            {groups
              ? groups.map(([g, groupOpts]) => (
                  <div key={g || '(none)'} className="grid gap-1.5">
                    <div className="sticky top-0 flex items-center gap-1.5 bg-background pt-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {g || 'No community'}
                      <Badge variant="secondary" className="h-3.5 px-1 text-[9px] font-normal">
                        {groupOpts.filter((o) => sel.includes(o.id)).length}/{groupOpts.length}
                      </Badge>
                    </div>
                    {groupOpts.map(row)}
                  </div>
                ))
              : filtered.map(row)}
            {filtered.length === 0 ? <span className="text-muted-foreground">no matches</span> : null}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
