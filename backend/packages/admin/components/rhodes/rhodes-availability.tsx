"use client";

// =============================================================================
// Rhodes Living availability admin (client). Native rebuild of the standalone
// rhodes-availability Worker's /admin page, inside the Esperanza admin shell so the
// Rhodes team has one login and a consistent UX. Data flows through server actions
// (lib/rhodes-actions) which carry the Bearer admin key server-side — the key never
// reaches this component.
//
// Per community (Villas on Ware / Belterra): stat cards, a list of active manual
// overrides (add / edit / remove), and a collapsible reference of every Snowflake
// unit. "Sync now" forces a Snowflake→KV resync (a 15-min cron also runs it).
// =============================================================================

import { useState, useTransition } from "react";
import {
  BuildingIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RHODES_COMMUNITIES,
  type RhodesCommunity,
  type RhodesData,
  type RhodesOverride,
  type RhodesStatus,
  type SaveRhodesOverrideInput,
} from "@/lib/rhodes-client";
import {
  RHODES_STATUS_BADGE,
  RHODES_STATUS_LABEL,
  RHODES_STATUS_OPTIONS,
  isAvailable,
} from "@/lib/rhodes-status";
import {
  deleteRhodesOverrideAction,
  getRhodesData,
  saveRhodesOverrideAction,
  syncRhodesAction,
} from "@/lib/rhodes-actions";

// Native <select> styled to match the <Input> primitive (base-ui has no Select here).
const selectClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

interface FormState {
  lot: string;
  status: string;
  floorplanName: string;
  address: string;
  beds: string;
  baths: string;
  sqftMin: string;
  minimumRent: string;
  featuredImage: string;
  note: string;
}

const EMPTY_FORM: FormState = {
  lot: "",
  status: "",
  floorplanName: "",
  address: "",
  beds: "",
  baths: "",
  sqftMin: "",
  minimumRent: "",
  featuredImage: "",
  note: "",
};

function formFromOverride(lot: number, ov: RhodesOverride): FormState {
  return {
    lot: String(lot),
    status: ov.status ?? "",
    floorplanName: ov.floorplanName ?? "",
    address: ov.address ?? "",
    beds: ov.beds ?? "",
    baths: ov.baths ?? "",
    sqftMin: ov.sqftMin ?? "",
    minimumRent: ov.minimumRent ?? "",
    featuredImage: ov.featuredImage ?? "",
    note: ov.note ?? "",
  };
}

function StatusBadge({ status }: { status: RhodesStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        RHODES_STATUS_BADGE[status] ?? RHODES_STATUS_BADGE.other
      )}
    >
      {RHODES_STATUS_LABEL[status] ?? "Unavailable"}
    </span>
  );
}

export function RhodesAvailability({
  initial,
  configError,
}: {
  initial: Record<string, RhodesData>;
  configError: string | null;
}) {
  const [tab, setTab] = useState<RhodesCommunity>(RHODES_COMMUNITIES[0].key);
  const [data, setData] = useState<Record<string, RhodesData>>(initial);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; msg: string } | null>(
    configError ? { kind: "error", msg: configError } : null
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editingLot, setEditingLot] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pending, startMutate] = useTransition();
  const [syncing, startSync] = useTransition();

  const current: RhodesData = data[tab] ?? { units: [], overrides: {}, fetchedAt: null };
  const overrideEntries = Object.entries(current.overrides)
    .map(([lot, ov]) => ({ lot: Number(lot), ov }))
    .sort((a, b) => a.lot - b.lot);

  const stats = {
    total: current.units.length,
    available: current.units.filter((u) => isAvailable(u.normalizedStatus)).length,
    overrides: overrideEntries.length,
    lastSync: current.fetchedAt ? new Date(current.fetchedAt).toLocaleString() : "—",
  };

  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditingLot(null);
    setFormOpen(true);
  }

  function openEdit(lot: number, ov: RhodesOverride) {
    setForm(formFromOverride(lot, ov));
    setEditingLot(lot);
    setFormOpen(true);
  }

  function applyResult(
    res: { ok: true; data: RhodesData } | { ok: false; error: string },
    successMsg: string
  ) {
    if (res.ok) {
      setData((d) => ({ ...d, [tab]: res.data }));
      setNotice({ kind: "success", msg: successMsg });
      return true;
    }
    setNotice({ kind: "error", msg: res.error });
    return false;
  }

  function save() {
    const lotNum = Number(form.lot);
    if (!Number.isFinite(lotNum) || lotNum <= 0) {
      setNotice({ kind: "error", msg: "A valid lot number is required." });
      return;
    }
    const input: SaveRhodesOverrideInput = {
      community: tab,
      lot: lotNum,
      status: form.status || undefined,
      floorplanName: form.floorplanName || undefined,
      address: form.address || undefined,
      beds: form.beds || undefined,
      baths: form.baths || undefined,
      sqftMin: form.sqftMin || undefined,
      minimumRent: form.minimumRent || undefined,
      featuredImage: form.featuredImage || undefined,
      note: form.note || undefined,
    };
    startMutate(async () => {
      const res = await saveRhodesOverrideAction(input);
      if (applyResult(res, `Override saved for lot ${lotNum}.`)) {
        setFormOpen(false);
      }
    });
  }

  function remove(lot: number) {
    startMutate(async () => {
      const res = await deleteRhodesOverrideAction(tab, lot);
      applyResult(res, `Override removed for lot ${lot}.`);
    });
  }

  function sync() {
    startSync(async () => {
      const res = await syncRhodesAction();
      if (!res.ok) {
        setNotice({ kind: "error", msg: res.error });
        return;
      }
      // Re-pull the current community so the units + last-sync reflect the resync.
      const refreshed = await getRhodesData(tab);
      if (refreshed.ok) setData((d) => ({ ...d, [tab]: refreshed.data }));
      const counts = Object.entries(res.synced)
        .map(([k, n]) => `${k}: ${n}`)
        .join(", ");
      setNotice({ kind: "success", msg: `Synced from Snowflake${counts ? ` (${counts})` : ""}.` });
    });
  }

  const busy = pending || syncing;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Rhodes Living</h1>
          <p className="text-sm text-muted-foreground">
            Rental availability — overrides &amp; Snowflake sync
          </p>
        </div>
        <Button variant="outline" onClick={sync} disabled={busy}>
          <RefreshCwIcon className={cn(syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      </div>

      {/* Notice */}
      {notice && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            notice.kind === "error"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          )}
        >
          {notice.msg}
        </div>
      )}

      {/* Community tabs (segmented) */}
      <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
        {RHODES_COMMUNITIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              setTab(c.key);
              setFormOpen(false);
            }}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              tab === c.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total units" value={String(stats.total)} />
        <Stat label="Available" value={String(stats.available)} valueClass="text-emerald-600" />
        <Stat label="Overrides" value={String(stats.overrides)} valueClass="text-amber-600" />
        <Stat label="Last sync" value={stats.lastSync} small />
      </div>

      {/* Active overrides */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Active overrides</CardTitle>
          <Button size="sm" onClick={openAdd} disabled={busy}>
            <PlusIcon /> Add override
          </Button>
        </CardHeader>
        <CardContent>
          {overrideEntries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No overrides set — every unit is following Snowflake.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Lot</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Floorplan</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrideEntries.map(({ lot, ov }) => (
                  <TableRow key={lot}>
                    <TableCell className="font-medium">{lot}</TableCell>
                    <TableCell>
                      {ov.status ? (
                        <StatusBadge status={ov.status as RhodesStatus} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{ov.floorplanName || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[
                        ov.beds && `${ov.beds} bd`,
                        ov.baths && `${ov.baths} ba`,
                        ov.sqftMin && `${ov.sqftMin} sf`,
                        ov.minimumRent && `$${ov.minimumRent}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="max-w-40 truncate" title={ov.note ?? ""}>
                      {ov.note || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => openEdit(lot, ov)}
                          disabled={busy}
                          aria-label={`Edit override for lot ${lot}`}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => remove(lot)}
                          disabled={busy}
                          aria-label={`Remove override for lot ${lot}`}
                        >
                          <Trash2Icon className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add / edit form */}
      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editingLot != null ? `Edit override — lot ${editingLot}` : "Add override"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Lot number *">
                <Input
                  type="number"
                  min={1}
                  value={form.lot}
                  disabled={editingLot != null}
                  onChange={(e) => set("lot", e.target.value)}
                />
              </Field>
              <Field label="Status">
                <select
                  className={selectClass}
                  value={form.status}
                  onChange={(e) => set("status", e.target.value)}
                >
                  {RHODES_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Floorplan name">
                <Input value={form.floorplanName} onChange={(e) => set("floorplanName", e.target.value)} />
              </Field>
              <Field label="Address">
                <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
              <Field label="Beds">
                <Input value={form.beds} onChange={(e) => set("beds", e.target.value)} />
              </Field>
              <Field label="Baths">
                <Input value={form.baths} onChange={(e) => set("baths", e.target.value)} />
              </Field>
              <Field label="Sq ft">
                <Input value={form.sqftMin} onChange={(e) => set("sqftMin", e.target.value)} />
              </Field>
              <Field label="Minimum rent">
                <Input value={form.minimumRent} onChange={(e) => set("minimumRent", e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Featured image URL">
                  <Input value={form.featuredImage} onChange={(e) => set("featuredImage", e.target.value)} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Note">
                  <Input
                    value={form.note}
                    placeholder="e.g. Model home, manual correction"
                    onChange={(e) => set("note", e.target.value)}
                  />
                </Field>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={busy}>
                {pending ? "Saving…" : "Save override"}
              </Button>
              <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* All units (reference) */}
      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium hover:bg-muted/50">
          All units from Snowflake ({current.units.length})
        </summary>
        <div className="max-h-[28rem] overflow-y-auto">
          {current.units.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              <TriangleAlertIcon className="mr-1 inline size-4" />
              No units loaded.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Lot</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Floorplan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Bd/Ba</TableHead>
                  <TableHead>Sq ft</TableHead>
                  <TableHead>Rent</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {current.units.map((u) => (
                  <TableRow key={u.lot}>
                    <TableCell className="font-medium">{u.lot}</TableCell>
                    <TableCell>{u.apartmentName || "—"}</TableCell>
                    <TableCell>{u.floorplanName || "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={u.normalizedStatus} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {[u.beds, u.baths].filter(Boolean).join(" / ") || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.sqftMin || "—"}
                      {u.sqftMax && u.sqftMax !== u.sqftMin ? `–${u.sqftMax}` : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.minimumRent ? `$${u.minimumRent}` : "—"}
                    </TableCell>
                    <TableCell>
                      {u.overridden && (
                        <Badge variant="secondary" className="gap-1">
                          <BuildingIcon className="size-3" />
                          ovr
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </details>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
  small,
}: {
  label: string;
  value: string;
  valueClass?: string;
  small?: boolean;
}) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("mt-1 font-bold", small ? "text-sm" : "text-2xl", valueClass)}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
