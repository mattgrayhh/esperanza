'use client';

// =============================================================================
// QmiCreateMatch — the /qmi/new page body. A single creation surface (no list pane,
// no interstitial): pick an unmatched Snowflake house from the top selector, confirm
// the suggested floor plan, optionally override synced specs, then "Save & render".
//
// Save reuses the existing write path via matchAndRenderQmi (→ saveEntity → override
// helper + audit + pdf_renders ensure + RENDER_Q enqueue), then flags the
// brochure render 'pending'. It does NOT publish. After a save the matched house drops
// out of the picker (it's no longer unmatched) and lands in "Just matched", where its
// PDF status polls Pending → link. The picker advances to the next house so you can
// clear the queue in one sitting.
// =============================================================================

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  matchAndRenderQmi,
  getQmiRenderStatus,
  createEntity,
} from '@/lib/actions';
import type { UnmatchedHouse } from '@/lib/qmi-match';
import type { SelectOption } from '@/lib/select-options';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  HomeIcon,
  SparklesIcon,
  Loader2Icon,
  CircleCheckIcon,
  TriangleAlertIcon,
  ExternalLinkIcon,
  PlusIcon,
  RocketIcon,
} from 'lucide-react';

// Overridable synced specs surfaced on the form. `key` is the logical override field
// name saveEntity expects (it routes <key> → override_<key>).
const OVERRIDE_FIELDS: {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
  get: (h: UnmatchedHouse) => string | number | null;
}[] = [
  { key: 'address', label: 'Address', type: 'text', get: (h) => h.address },
  { key: 'bedroom_count', label: 'Beds', type: 'number', get: (h) => h.beds },
  { key: 'bathroom_count', label: 'Baths', type: 'number', get: (h) => h.baths },
  { key: 'total_square_footage', label: 'Sq ft', type: 'number', get: (h) => h.sqft },
  { key: 'price', label: 'Price', type: 'number', get: (h) => h.price },
  { key: 'move_in_date', label: 'Move-in', type: 'date', get: (h) => h.moveInDate },
];

interface MatchedEntry {
  id: string;
  label: string;
  status: string | null;
  url: string | null;
  attempts: number;
}

const MAX_POLLS = 20;
const money = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

function houseLabel(h: UnmatchedHouse): string {
  const num = h.housenumber ? `#${h.housenumber}` : h.id;
  return h.community ? `${num} · ${h.community}` : num;
}

export function QmiCreateMatch({
  houses,
  floorPlans,
}: {
  houses: UnmatchedHouse[];
  floorPlans: SelectOption[];
}) {
  const router = useRouter();
  const [remaining, setRemaining] = useState<UnmatchedHouse[]>(houses);
  const [selectedId, setSelectedId] = useState<string>(houses[0]?.id ?? '');
  const [floorPlanId, setFloorPlanId] = useState<string>('');
  const [overrides, setOverrides] = useState<Record<string, { on: boolean; value: string }>>({});
  const [matched, setMatched] = useState<MatchedEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [creating, startCreate] = useTransition();

  const current = remaining.find((h) => h.id === selectedId);
  const selectedFp = floorPlans.find((o) => o.id === floorPlanId);

  // When the selected house changes, seed the floor plan to its suggestion and clear
  // any override toggles from the previous house.
  useEffect(() => {
    const h = remaining.find((x) => x.id === selectedId);
    setFloorPlanId(h?.suggestedFloorPlanId ?? '');
    setOverrides({});
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Poll the brochure render status for matched houses that are still in flight.
  useEffect(() => {
    const inflight = matched.filter(
      (m) => m.status !== 'live' && m.status !== 'error' && m.attempts < MAX_POLLS
    );
    if (inflight.length === 0) return;
    const t = setTimeout(async () => {
      const updates = await Promise.all(
        inflight.map(async (m) => ({ id: m.id, ...(await getQmiRenderStatus(m.id)) }))
      );
      setMatched((prev) =>
        prev.map((m) => {
          const u = updates.find((x) => x.id === m.id);
          if (!u) return m;
          return { ...m, status: u.status ?? m.status, url: u.url ?? m.url, attempts: m.attempts + 1 };
        })
      );
    }, 3000);
    return () => clearTimeout(t);
  }, [matched]);

  function setOverride(key: string, patch: Partial<{ on: boolean; value: string }>) {
    setOverrides((prev) => ({ ...prev, [key]: { on: false, value: '', ...prev[key], ...patch } }));
  }

  function onSave() {
    if (!current || !floorPlanId) {
      setMsg('Pick a floor plan first');
      return;
    }
    const house = current;
    startSave(async () => {
      const ov: Record<string, string> = {};
      for (const f of OVERRIDE_FIELDS) {
        const st = overrides[f.key];
        if (st?.on) ov[f.key] = st.value;
      }
      const res = await matchAndRenderQmi(house.id, { floorPlanId, overrides: ov });
      if (!res.ok) {
        setMsg(`Error: ${res.error}`);
        return;
      }
      setMatched((m) => [
        { id: house.id, label: houseLabel(house), status: 'pending', url: null, attempts: 0 },
        ...m,
      ]);
      setRemaining((rem) => {
        const next = rem.filter((h) => h.id !== house.id);
        setSelectedId(next[0]?.id ?? '');
        return next;
      });
      setMsg(null);
      router.refresh();
    });
  }

  function onCreateBlank() {
    startCreate(async () => {
      const res = await createEntity('qmi');
      if (res.ok) router.push(`/qmi/${res.id}`);
      else setMsg(`Error: ${res.error}`);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          New Quick Move-In
        </h1>
        <p className="text-sm text-muted-foreground">
          Match a Snowflake house to its floor plan and start its brochure. Publishing stays a
          separate step.
        </p>
      </header>

      {current ? (
        <Card className="max-w-2xl">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <HomeIcon className="size-4 text-primary" />
              Match a house
            </CardTitle>
            <CardDescription>
              {remaining.length} unmatched {remaining.length === 1 ? 'house' : 'houses'} from
              Snowflake.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {/* House picker */}
            <div className="flex flex-col gap-1.5">
              <Label>House</Label>
              <Select value={selectedId} onValueChange={(v) => setSelectedId((v as string) ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a house…">
                    {current ? houseLabel(current) : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {remaining.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {houseLabel(h)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Floor plan picker (suggested) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Label>Floor plan</Label>
                {current.suggestedFloorPlanId && floorPlanId === current.suggestedFloorPlanId && (
                  <Badge variant="secondary" className="gap-1">
                    <SparklesIcon className="size-3" />
                    suggested
                  </Badge>
                )}
              </div>
              <Select value={floorPlanId} onValueChange={(v) => setFloorPlanId((v as string) ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a floor plan…">
                    {selectedFp ? selectedFp.label : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {floorPlans.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {current.syncedFloorPlanName && (
                <p className="text-xs text-muted-foreground">
                  Snowflake model name: {current.syncedFloorPlanName}
                </p>
              )}
            </div>

            {/* From Snowflake — read-only summary + per-field override toggles */}
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>{current.beds ?? '—'} bd</span>
                <span>{current.baths ?? '—'} ba</span>
                <span>{current.sqft ? `${current.sqft.toLocaleString()} sqft` : '— sqft'}</span>
                <span>{money(current.price)}</span>
                <span className="ml-auto">{current.address ?? 'no address'}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                From Snowflake. Toggle a field to override it; otherwise it stays synced.
              </p>
              <div className="flex flex-col divide-y">
                {OVERRIDE_FIELDS.map((f) => {
                  const synced = f.get(current);
                  const st = overrides[f.key] ?? { on: false, value: '' };
                  return (
                    <div key={f.key} className="flex items-center gap-3 py-2">
                      <Switch
                        id={`ov-${f.key}`}
                        checked={st.on}
                        onCheckedChange={(on) =>
                          setOverride(f.key, {
                            on,
                            value: st.value || (synced == null ? '' : String(synced)),
                          })
                        }
                      />
                      <Label htmlFor={`ov-${f.key}`} className="w-24 shrink-0 text-sm">
                        {f.label}
                      </Label>
                      {st.on ? (
                        <Input
                          type={f.type}
                          value={st.value}
                          onChange={(e) => setOverride(f.key, { value: e.target.value })}
                          className="h-8"
                        />
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {synced == null ? '—' : f.key === 'price' ? money(Number(synced)) : String(synced)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {msg && (
              <p className={msg.startsWith('Error') ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                {msg}
              </p>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={onSave} disabled={saving || !floorPlanId}>
                <RocketIcon />
                {saving ? 'Saving…' : 'Save & render'}
              </Button>
              <button
                type="button"
                onClick={onCreateBlank}
                disabled={creating}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <PlusIcon className="size-3.5" />
                {creating ? 'Creating…' : 'Create a blank QMI manually'}
              </button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <CardContent className="flex flex-col items-start gap-3 py-8">
            <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-primary">
              <CircleCheckIcon className="size-5" />
            </span>
            <div>
              <p className="font-medium text-foreground">Every house is matched</p>
              <p className="text-sm text-muted-foreground">
                No unmatched Snowflake houses right now. New ones appear here automatically after
                the next sync.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => router.push('/qmi')}>
                Go to Quick Move-Ins
              </Button>
              <button
                type="button"
                onClick={onCreateBlank}
                disabled={creating}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <PlusIcon className="size-3.5" />
                {creating ? 'Creating…' : 'Create a blank QMI manually'}
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Just matched — live PDF render status */}
      {matched.length > 0 && (
        <Card className="max-w-2xl">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Just matched</CardTitle>
            <CardDescription>Brochure PDFs render in the background.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 px-2 py-2">
            {matched.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-md px-2 py-2">
                <span className="flex-1 truncate text-sm font-medium">{m.label}</span>
                <RenderStatus entry={m} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RenderStatus({ entry }: { entry: MatchedEntry }) {
  if (entry.status === 'live' && entry.url) {
    return (
      <a
        href={entry.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        View PDF
        <ExternalLinkIcon className="size-3.5" />
      </a>
    );
  }
  if (entry.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-destructive">
        <TriangleAlertIcon className="size-3.5" />
        Render failed
      </span>
    );
  }
  const stalled = entry.attempts >= MAX_POLLS;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      {!stalled && <Loader2Icon className="size-3.5 animate-spin" />}
      {stalled ? 'Pending — will finish when the renderer runs' : 'Pending'}
    </span>
  );
}
