"use client"

// =============================================================================
// packages/admin — reusable client DataTable for the generic entity LIST view.
//
// PRESENTATION ONLY. This component receives plain, already-fetched server data
// (columns + rows from lib/build-list-view.ts via getReadDb()) and renders it with
// @tanstack/react-table + base-nova primitives. It adds NO client-side data
// fetching — every prop is computed server-side in app/[entity]/page.tsx.
//
// Columns are DERIVED from the per-entity list config (ListColumn[]) so the config
// (lib/field-config.ts) stays the single source of truth for which fields render.
// The engine just maps each ListColumn -> a TanStack ColumnDef:
//   - first column           → link to the editor (/segment/id)
//   - kind 'publish'          → status Badge (published/active/status)
//   - everything else         → plain text cell
// Plus a synthetic "State" column (the publish gate) and a row-action column.
// =============================================================================

import * as React from "react"
import Link from "next/link"
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Plus,
  Search,
  SlidersHorizontal,
  CircleHelp,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { statusTone } from "@/lib/status"
import { isImageField } from "@/lib/image-fields"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CreateDraftButton } from "@/components/CreateDraftButton"

// ── serializable shapes (mirror lib/build-list-view.ts ListView, kept local so
//    this client component imports no server-only modules) ────────────────────
export type ListCellKind = "text" | "number" | "boolean" | "publish" | "currency" | "image"

export interface DataTableColumn {
  field: string
  label: string
  kind?: ListCellKind
}

export interface DataTableRow {
  id: string
  /** field -> formatted display string (already fmt()'d server-side). */
  values: Record<string, string>
  /** publish-gate value: true=live, false=draft, null=no gate for this entity. */
  live: boolean | null
  /** derived tri-state status (Draft / Coming Soon / Live | Scheduled / Published). */
  status: string
}

export interface DataTableProps {
  segment: string
  columns: DataTableColumn[]
  rows: DataTableRow[]
  /** the entity's publish gate column, or null when it has none. */
  gateColumn: string | null
  truncated: boolean
  label: string
  /** Contextual Help & Docs link for this entity (gen:help links map), or null. */
  helpHref?: string | null
  helpTitle?: string | null
  /** When set, offers a "Group by <label>" toggle that renders rows under headings for
   *  this field's value (e.g. communities grouped by Town). */
  groupByField?: string
  groupByLabel?: string
  /** When set, New posts this server action instead of linking to /{segment}/new
   *  (communities: create draft + redirect to editor). */
  createAction?: (formData: FormData) => Promise<void>
}

// =============================================================================
// Status badge — maps a publish/gate state to the brand status tokens defined in
// app/globals.css (--color-status-{published,draft,sold}). Terracotta is reserved
// for "sold"; brand green for live/published; warm-gray muted for draft.
// =============================================================================
type StatusTone = "published" | "draft" | "sold"

const STATUS_CLASSES: Record<StatusTone, string> = {
  published: "bg-status-published text-status-published-foreground",
  draft: "bg-status-draft text-status-draft-foreground",
  sold: "bg-status-sold text-status-sold-foreground",
}

/** Classify a raw publish-cell string into a tone + display label. */
function classifyPublish(raw: string): { tone: StatusTone; text: string } {
  const v = raw.trim()
  const lower = v.toLowerCase()
  if (lower === "sold") return { tone: "sold", text: v }
  // empty/0/no/false/draft => draft (matches the legacy PublishPill predicate).
  const isDraft =
    v === "" || lower === "0" || lower === "no" || lower === "false" || lower === "draft"
  if (isDraft) return { tone: "draft", text: v === "" ? "draft" : v }
  return { tone: "published", text: v }
}

function StatusBadge({ tone, text }: { tone: StatusTone; text: string }) {
  return (
    <Badge className={cn("capitalize", STATUS_CLASSES[tone])}>{text}</Badge>
  )
}

// =============================================================================
// Image cell — operator requirement: an image column in ANY list/table renders a small
// THUMBNAIL, never the raw URL/text. A stale Airtable URL (expired/rejected) and an empty
// value both fall back to a muted placeholder tile (same contract as ImageUploader).
// =============================================================================
function ImageThumb({ url, alt }: { url: string; alt: string }) {
  const ok = url.trim() !== "" && !url.includes("airtableusercontent.com")
  if (!ok) {
    return (
      <div
        className="flex size-10 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground"
        aria-label="No image"
      >
        <ImageIcon className="size-4 opacity-60" />
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="size-10 shrink-0 rounded-md border border-border object-cover"
    />
  )
}

/** The synthetic "Status" column — tri-state badge from the derived status string.
 *  Live/Published = filled green; Coming Soon/Scheduled = outline green (on-site, not
 *  fully live); Draft = muted. */
function StatusChip({ status }: { status: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>
  const tone = statusTone(status)
  const cls =
    tone === "live"
      ? "bg-status-published text-status-published-foreground"
      : tone === "pending"
        ? "border border-status-published/40 bg-transparent text-status-published"
        : "bg-status-draft text-status-draft-foreground"
  return <Badge className={cn("capitalize", cls)}>{status}</Badge>
}

// =============================================================================
// Column factory — derive TanStack ColumnDef[] from the entity list config.
// =============================================================================
const ACTION_COL_ID = "__actions"
const STATE_COL_ID = "__state"

function buildColumns(
  segment: string,
  cols: DataTableColumn[],
  gateColumn: string | null,
): ColumnDef<DataTableRow>[] {
  // Drop any raw publish-gate list column ("1"/"0") — the synthetic "Status" column
  // below renders the single tri-state badge instead (feedback [16][41]).
  const defs: ColumnDef<DataTableRow>[] = cols
    .filter((c) => c.kind !== "publish")
    .map((c, index) => {
    // Image columns render a thumbnail (operator DAM rule), not raw URL text.
    const isImage = c.kind === "image" || isImageField(c.field)
    return {
    id: c.field,
    accessorFn: (row) => row.values[c.field] ?? "",
    header: ({ column }) =>
      isImage ? (
        // No sort on an image thumbnail column — just a static label.
        <span className="px-2">{c.label}</span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {c.label}
          <ArrowUpDown className="size-3 opacity-60" />
        </Button>
      ),
    cell: ({ row }) => {
      const value = row.original.values[c.field] ?? ""
      // Image column → thumbnail. If it happens to be the first (link) column, wrap the
      // thumbnail in the editor link so the row is still navigable.
      if (isImage) {
        const thumb = <ImageThumb url={value} alt={c.label} />
        return index === 0 ? (
          <Link href={`/${segment}/${row.original.id}`} aria-label={`Edit ${row.original.id}`}>
            {thumb}
          </Link>
        ) : (
          thumb
        )
      }
      // First column → link to the editor.
      if (index === 0) {
        return (
          <Link
            href={`/${segment}/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {value || row.original.id}
          </Link>
        )
      }
      // Publish-kind column → status badge.
      if (c.kind === "publish") {
        const { tone, text } = classifyPublish(value)
        return <StatusBadge tone={tone} text={text} />
      }
      return <span className="text-foreground/80">{value || "—"}</span>
    },
    // Numeric + currency columns sort by value (numericSort strips $ and commas).
    sortingFn: c.kind === "number" || c.kind === "currency" ? numericSort : "alphanumeric",
    enableSorting: !isImage,
    enableHiding: index !== 0, // keep the title column always visible
    }
  })

  // Synthetic "Status" column (the single publish indicator) for gated entities.
  if (gateColumn != null) {
    defs.push({
      id: STATE_COL_ID,
      accessorFn: (row) => row.status,
      header: "Status",
      cell: ({ row }) => <StatusChip status={row.original.status} />,
      enableSorting: true,
    })
  }

  // Row-action column → edit link.
  defs.push({
    id: ACTION_COL_ID,
    header: "",
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <div className="text-right">
        <Button
          variant="ghost"
          size="xs"
          render={
            <Link href={`/${segment}/${row.original.id}`}>edit →</Link>
          }
        />
      </div>
    ),
  })

  return defs
}

/** numeric-aware sort over the formatted display string (falls back to text). */
function numericSort(
  a: { getValue: (id: string) => unknown },
  b: { getValue: (id: string) => unknown },
  id: string,
): number {
  const na = parseFloat(String(a.getValue(id)).replace(/[^0-9.-]/g, ""))
  const nb = parseFloat(String(b.getValue(id)).replace(/[^0-9.-]/g, ""))
  const aNan = Number.isNaN(na)
  const bNan = Number.isNaN(nb)
  if (aNan && bNan) return 0
  if (aNan) return -1
  if (bNan) return 1
  return na - nb
}

// =============================================================================
// DataTable
// =============================================================================
// Per-entity default sort (column id = field name). Promotions sort low→high by their
// manual sort_order so the list mirrors the published ordering (feedback item 17).
const DEFAULT_SORT: Record<string, SortingState> = {
  promotions: [{ id: "sort_order", desc: false }],
}

export function DataTable({
  segment,
  columns,
  rows,
  gateColumn,
  truncated,
  label,
  helpHref,
  helpTitle,
  groupByField,
  groupByLabel,
  createAction,
}: DataTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>(DEFAULT_SORT[segment] ?? [])
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [grouped, setGrouped] = React.useState(false)

  const columnDefs = React.useMemo(
    () => buildColumns(segment, columns, gateColumn),
    [segment, columns, gateColumn],
  )

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  })

  const colSpan = columnDefs.length
  const totalRows = rows.length
  const filteredRows = table.getFilteredRowModel().rows.length

  const isGrouped = Boolean(grouped && groupByField)
  // When grouped, render ALL filtered rows (no pagination) sorted by the group field so the
  // section headings are contiguous; otherwise use the paginated/sorted row model.
  const bodyRows = isGrouped
    ? [...table.getFilteredRowModel().rows].sort((a, b) =>
        String(a.original.values[groupByField as string] ?? "").localeCompare(
          String(b.original.values[groupByField as string] ?? ""),
        ),
      )
    : table.getRowModel().rows

  // Map ColumnDef id -> label for the visibility menu.
  const labelFor = (id: string): string => {
    if (id === STATE_COL_ID) return "Status"
    return columns.find((c) => c.field === id)?.label ?? id
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── header: title + New ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="flex items-center gap-1.5">
            <h1 className="font-heading text-xl font-semibold text-foreground">{label}</h1>
            {helpHref ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
                render={<Link href={helpHref} />}
                aria-label={helpTitle ?? "Help"}
                title={helpTitle ?? "Help"}
              >
                <CircleHelp className="size-4" />
              </Button>
            ) : null}
          </span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {filteredRows === totalRows
              ? `${totalRows} record${totalRows === 1 ? "" : "s"}`
              : `${filteredRows} of ${totalRows} records`}
            {truncated ? ` · showing first ${totalRows}` : ""}
          </p>
        </div>
        {createAction ? (
          <form action={createAction}>
            <CreateDraftButton />
          </form>
        ) : (
          <Button render={<Link href={`/${segment}/new`} />}>
            <Plus className="size-4" />
            New
          </Button>
        )}
      </div>

      {/* ── toolbar: search + column visibility ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={`Filter ${label.toLowerCase()}…`}
            className="pl-8"
            aria-label={`Filter ${label}`}
          />
        </div>
        <div className="flex items-center gap-2">
        {groupByField ? (
          <Button
            variant={grouped ? "default" : "outline"}
            size="sm"
            onClick={() => setGrouped((v) => !v)}
            aria-pressed={grouped}
            title={`Group by ${groupByLabel ?? groupByField}`}
          >
            <SlidersHorizontal className="size-3.5" />
            {grouped ? `Grouped by ${groupByLabel ?? groupByField}` : `Group by ${groupByLabel ?? groupByField}`}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <SlidersHorizontal className="size-3.5" />
            Columns
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {/* Base UI requires the label inside a group (MenuGroupContext). */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide() && column.id !== ACTION_COL_ID)
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    className="capitalize"
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {labelFor(column.id)}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {/* ── table ── */}
      {/* overflow-x-auto (not -hidden) so the bordered card is the horizontal scroll
          container: on narrow screens the right-hand columns stay reachable by swipe
          instead of being clipped. min-w-0 prevents the card growing past its flex/grid
          parent (the min-width:auto trap that otherwise lets the table push the layout). */}
      <div className="min-w-0 overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="bg-muted/40 hover:bg-muted/40"
              >
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="text-xs font-medium tracking-wide text-muted-foreground"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {bodyRows.length ? (
              (() => {
                const out: React.ReactNode[] = []
                let lastGroup: string | null = null
                for (const row of bodyRows) {
                  if (isGrouped) {
                    const g =
                      String(row.original.values[groupByField as string] ?? "").trim() || "—"
                    if (g !== lastGroup) {
                      lastGroup = g
                      out.push(
                        <TableRow key={`grp-${g}`} className="bg-muted/50 hover:bg-muted/50">
                          <TableCell
                            colSpan={colSpan}
                            className="px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground"
                          >
                            {g}
                          </TableCell>
                        </TableRow>,
                      )
                    }
                  }
                  out.push(
                    <TableRow key={row.id} className="hover:bg-accent/40">
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="px-3 py-2">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>,
                  )
                }
                return out
              })()
            ) : (
              <TableRow>
                <TableCell
                  colSpan={colSpan}
                  className="h-24 text-center text-muted-foreground"
                >
                  {totalRows === 0 ? "No records." : "No matching records."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── pagination ── */}
      {!isGrouped && table.getPageCount() > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="size-3.5" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
