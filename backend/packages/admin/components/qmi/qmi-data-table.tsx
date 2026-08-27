"use client"

// =============================================================================
// packages/admin — BESPOKE Quick Move-In list table (presentation only).
//
// Receives already-fetched, serializable QMI rows from the RSC (app/qmi/page.tsx,
// via lib/qmi-list.ts → getReadDb()). It performs NO client-side data fetching —
// every value is computed server-side. This component only re-skins/sort/filter/
// paginate the rows with @tanstack/react-table + the project's base-ui primitives.
//
// Visual pattern adapted from /tmp/bundui .../orders/data-table.tsx (filter tabs,
// search, Columns toggle, sortable headers, pagination, row-selection checkboxes,
// row-action menu) but rebuilt against THIS repo's base-ui components (render={}
// not asChild; Checkbox onCheckedChange; brand --color-status-* tokens) and the
// QMI column spec.
//
// Columns (in spec order):
//   1 Thumbnail   2 Address (+ copyable Lot-number sub-line; House ID fallback)   3 Community
//   4 Floor Plan (Assign affordance when unassigned draft)      5 Base price
//   6 Current price (override indicator)   7 Availability (date / Available-now)
//   8 Status (Published/Draft + Available-now)   9 row ⋯ menu
// eci_key / mark_job_number are deliberately NOT shown.
// =============================================================================

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  type ColumnDef,
  type ColumnFiltersState,
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
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Home,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  SquareArrowOutUpRight,
  CircleHelp,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { qmiRowMatchesQuery } from "@/lib/qmi-search"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// ── serializable row shape (mirror of lib/qmi-list.ts QmiListRow; kept local so
//    this client component imports no server-only module) ──────────────────────
export interface QmiRow {
  id: string
  address: string
  /** MarkSystems street from Snowflake; shown/searchable when it differs from `address`. */
  syncedAddress: string
  housenumber: string
  /** effective lot number ("" when none), e.g. "RC146". */
  lotNumber: string
  communityName: string
  floorPlanName: string
  floorPlanId: string | null
  basePrice: number | null
  currentPrice: number | null
  priceOverridden: boolean
  thumbnail: string | null
  moveInDate: string | null
  availableNow: boolean
  published: boolean
  /** The incentive badge this home's live card shows ("" = none). */
  effectiveBadge: string
}

export interface QmiDataTableProps {
  rows: QmiRow[]
  truncated: boolean
}

// ── the row-click editor target. /qmi/<id> now resolves to the BESPOKE detail
//    screen (app/qmi/[id]/page.tsx), which takes precedence over the dynamic
//    app/[entity]/[id] editor for QMI only. It still saves through the same server
//    actions (saveEntity / togglePublished / uploadImage), so the write path,
//    audit_log behaviour is unchanged. ───────────────────────
const SEGMENT = "qmi"
const editHref = (id: string) => `/${SEGMENT}/${id}`

// =============================================================================
// formatters
// =============================================================================
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

function fmtPrice(n: number | null): string {
  return n == null ? "—" : usd.format(n)
}

/** Format a move-in date string. Accepts ISO-ish; falls back to the raw string.
 *  timeZone is pinned: the server renders in UTC and a client in e.g. Central time
 *  would otherwise format a date-only value one day earlier -> React hydration
 *  mismatch (Sentry ESPERANZA-HOMES-3 on /qmi). */
function fmtMoveIn(raw: string | null): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

// =============================================================================
// small presentational pieces
// =============================================================================

/** Thumbnail with a tasteful placeholder for drafts / missing imagery. */
function Thumb({ src, alt }: { src: string | null; alt: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="size-11 shrink-0 rounded-md border border-border object-cover"
      />
    )
  }
  return (
    <div
      className="flex size-11 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground"
      aria-label="No image"
    >
      <Home className="size-4 opacity-60" />
    </div>
  )
}

/** Address cell — bold primary line + a copyable muted sub-line showing the LOT
 *  number (the code the sales team actually uses, e.g. "RC146"). Falls back to
 *  the Housemaster House ID when no lot is set, and to "—" when neither exists. */
function AddressCell({ row }: { row: QmiRow }) {
  const [copied, setCopied] = React.useState(false)
  // lot number first; House ID as the legacy fallback.
  const subLabel = row.lotNumber ? "Lot" : "House ID"
  const subValue = row.lotNumber || row.housenumber
  const synced = row.syncedAddress?.trim() ?? ""
  const showSyncedLine =
    synced !== "" && synced.toLowerCase() !== (row.address?.trim() ?? "").toLowerCase()
  const copy = React.useCallback(
    (e: React.MouseEvent) => {
      // don't trigger the row-click navigation / selection.
      e.stopPropagation()
      e.preventDefault()
      if (!subValue) return
      navigator.clipboard?.writeText(subValue).then(
        () => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        },
        () => {},
      )
    },
    [subValue],
  )

  return (
    <div className="min-w-0">
      <Link
        href={editHref(row.id)}
        onClick={(e) => e.stopPropagation()}
        className="block truncate font-medium text-foreground hover:text-primary hover:underline"
      >
        {row.address || <span className="text-muted-foreground italic">No address</span>}
      </Link>
      {subValue ? (
        <button
          type="button"
          onClick={copy}
          title={`Copy ${subLabel === "Lot" ? "lot number" : "House ID"}`}
          className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="tabular-nums">
            {subLabel}: {subValue}
          </span>
          {copied ? (
            <Check className="size-3 text-status-published" />
          ) : (
            <Copy className="size-3 opacity-60" />
          )}
        </button>
      ) : (
        <span className="mt-0.5 block text-xs text-muted-foreground">—</span>
      )}
      {showSyncedLine ? (
        <span className="mt-0.5 block truncate text-xs text-muted-foreground" title="Address from MarkSystems (Snowflake)">
          MarkSystems: {synced}
        </span>
      ) : null}
    </div>
  )
}

/** Floor-plan cell — name, or an "Assign" affordance for an unassigned draft. */
function FloorPlanCell({ row }: { row: QmiRow }) {
  if (row.floorPlanId && row.floorPlanName) {
    return <span className="text-foreground/90">{row.floorPlanName}</span>
  }
  if (row.floorPlanId && !row.floorPlanName) {
    // assigned but name unresolved — show the id rather than imply "unassigned".
    return <span className="text-foreground/70">{row.floorPlanId}</span>
  }
  // floorPlanId === null → unassigned draft → subtle Assign affordance.
  return (
    <Button
      variant="outline"
      size="xs"
      className="border-dashed text-muted-foreground"
      render={<Link href={editHref(row.id)} onClick={(e) => e.stopPropagation()} />}
    >
      <Plus className="size-3" />
      Assign
    </Button>
  )
}

/** Current-price cell with a subtle "overridden" indicator. */
function CurrentPriceCell({ row }: { row: QmiRow }) {
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {fmtPrice(row.currentPrice)}
      {row.priceOverridden ? (
        <Badge
          variant="outline"
          className="h-4 border-status-sold/40 px-1 text-[10px] leading-none text-status-sold"
          title="Current price is an admin override"
        >
          override
        </Badge>
      ) : null}
    </span>
  )
}

/** Availability cell — formatted move-in date and/or an Available-now chip. */
function AvailabilityCell({ row }: { row: QmiRow }) {
  const date = fmtMoveIn(row.moveInDate)
  if (row.availableNow) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge className="bg-status-published/15 text-status-published">Available now</Badge>
        {date ? <span className="text-xs text-muted-foreground tabular-nums">{date}</span> : null}
      </span>
    )
  }
  if (date) return <span className="tabular-nums text-foreground/90">{date}</span>
  return <span className="text-muted-foreground">—</span>
}

/** Status cell — colored dot + label (green=Published, gray=Draft). */
function StatusCell({ row }: { row: QmiRow }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          row.published ? "bg-status-published" : "bg-muted-foreground/25",
        )}
        aria-hidden
      />
      <span className={cn("text-sm", row.published ? "text-foreground" : "text-muted-foreground/70")}>
        {row.published ? "Published" : "Draft"}
      </span>
    </span>
  )
}

// =============================================================================
// sortable header button
// =============================================================================
function SortHeader({
  label,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  column,
}: {
  label: string
  // tanstack Column — typed loosely to keep the header factory terse.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  column: any
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 h-7 px-2 text-muted-foreground hover:text-foreground"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {label}
      <ArrowUpDown className="size-3 opacity-60" />
    </Button>
  )
}

// =============================================================================
// column model — labels drive the Columns visibility toggle.
// =============================================================================
const COLUMN_LABELS: Record<string, string> = {
  thumbnail: "Thumbnail",
  address: "Address",
  community: "Community",
  floorPlan: "Floor Plan",
  basePrice: "Base price",
  currentPrice: "Current price",
  availability: "Availability",
  incentive: "Incentive",
  status: "Status",
}

function buildColumns(): ColumnDef<QmiRow>[] {
  return [
    {
      id: "select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        // base-ui Checkbox takes a separate `indeterminate` prop (it is NOT a value
        // of `checked`, unlike Radix). Partial page selection → indeterminate.
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all rows on this page"
        />
      ),
      cell: ({ row }) => (
        <div onClick={(e) => e.stopPropagation()} className="flex">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      ),
    },
    {
      id: "thumbnail",
      enableSorting: false,
      header: () => <span className="sr-only">Thumbnail</span>,
      cell: ({ row }) => (
        <Thumb src={row.original.thumbnail} alt={row.original.address || "Quick move-in"} />
      ),
    },
    {
      id: "address",
      accessorFn: (r) => r.address,
      header: ({ column }) => <SortHeader label="Address" column={column} />,
      cell: ({ row }) => <AddressCell row={row.original} />,
      sortingFn: "alphanumeric",
    },
    {
      id: "community",
      accessorFn: (r) => r.communityName,
      header: "Community",
      cell: ({ row }) =>
        row.original.communityName ? (
          <span className="text-foreground/90">{row.original.communityName}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "floorPlan",
      accessorFn: (r) => r.floorPlanName,
      header: "Floor Plan",
      cell: ({ row }) => <FloorPlanCell row={row.original} />,
    },
    {
      id: "basePrice",
      accessorFn: (r) => r.basePrice ?? -1,
      header: ({ column }) => <SortHeader label="Base price" column={column} />,
      cell: ({ row }) => (
        <span className="tabular-nums text-foreground/90">{fmtPrice(row.original.basePrice)}</span>
      ),
      sortingFn: "basic",
    },
    {
      id: "currentPrice",
      accessorFn: (r) => r.currentPrice ?? -1,
      header: ({ column }) => <SortHeader label="Current price" column={column} />,
      cell: ({ row }) => <CurrentPriceCell row={row.original} />,
      sortingFn: "basic",
    },
    {
      id: "availability",
      // sort key: available-now first, then by date ascending; nulls last.
      accessorFn: (r) => {
        if (r.availableNow) return 0
        if (r.moveInDate) {
          const t = new Date(r.moveInDate).getTime()
          return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t
        }
        return Number.MAX_SAFE_INTEGER
      },
      header: ({ column }) => <SortHeader label="Availability" column={column} />,
      cell: ({ row }) => <AvailabilityCell row={row.original} />,
      sortingFn: "basic",
    },
    {
      id: "incentive",
      accessorFn: (r) => r.effectiveBadge,
      header: ({ column }) => <SortHeader label="Incentive" column={column} />,
      cell: ({ row }) =>
        row.original.effectiveBadge ? (
          <span
            className="block max-w-[16rem] truncate text-xs"
            title={row.original.effectiveBadge}
          >
            {row.original.effectiveBadge}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      sortingFn: "alphanumeric",
    },
    {
      id: "status",
      accessorFn: (r) => (r.published ? "published" : "draft"),
      header: "Status",
      cell: ({ row }) => <StatusCell row={row.original} />,
    },
    {
      id: "actions",
      enableSorting: false,
      enableHiding: false,
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="text-right" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Row actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href={editHref(row.original.id)} />}>
                <SquareArrowOutUpRight className="size-3.5" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href={editHref(row.original.id)} />}>
                <Pencil className="size-3.5" />
                Edit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ]
}

// =============================================================================
// filter tabs
// =============================================================================
type TabKey = "all" | "published" | "draft" | "available"

const TABS: { value: TabKey; label: string }[] = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Draft" },
  { value: "available", label: "Available now" },
]

function matchesTab(row: QmiRow, tab: TabKey): boolean {
  switch (tab) {
    case "published":
      return row.published
    case "draft":
      return !row.published
    case "available":
      return row.availableNow
    case "all":
    default:
      return true
  }
}

// =============================================================================
// QmiDataTable
// =============================================================================
export function QmiDataTable({ rows, truncated }: QmiDataTableProps) {
  const router = useRouter()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})
  const [tab, setTab] = React.useState<TabKey>("all")

  const columns = React.useMemo(buildColumns, [])

  // Tab filter is applied to the data BEFORE the table (cheap).
  const tabRows = React.useMemo(() => rows.filter((r) => matchesTab(r, tab)), [rows, tab])

  const table = useReactTable({
    data: tabRows,
    columns,
    state: { sorting, columnFilters, globalFilter, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // search across address + housemaster + community + floor plan + lot number
    // (pure predicate in lib/qmi-search.ts — unit-tested; lot matches "RC146"
    // and bare-numeric "146" forms, case-insensitively).
    globalFilterFn: (row, _columnId, value) => qmiRowMatchesQuery(row.original, String(value)),
    initialState: { pagination: { pageSize: 25 } },
  })

  const selectedCount = table.getFilteredSelectedRowModel().rows.length
  const filteredCount = table.getFilteredRowModel().rows.length
  const colCount = table.getVisibleLeafColumns().length

  return (
    <div className="flex flex-col gap-4">
      {/* ── header: title + count + New ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="flex items-center gap-1.5">
            <h1 className="font-heading text-xl font-semibold text-foreground">Quick Move-Ins</h1>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              render={<Link href="/help/how-a-new-home-appears" />}
              aria-label="Help: how a new home appears"
              title="Help: how a new home appears"
            >
              <CircleHelp className="size-4" />
            </Button>
          </span>
          {truncated ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Showing first {rows.length}
            </p>
          ) : null}
        </div>
        <Button render={<Link href={`/${SEGMENT}/new`} />}>
          <Plus className="size-4" />
          New
        </Button>
      </div>

      {/* ── filter tabs ── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* ── toolbar: search + Columns ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Search address, MarkSystems address, lot…"
            className="pl-8"
            aria-label="Search quick move-ins"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <SlidersHorizontal className="size-3.5" />
            Columns
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide() && column.id in COLUMN_LABELS)
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {COLUMN_LABELS[column.id] ?? column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── table ── */}
      {/* overflow-x-auto (not -hidden) so the bordered card is the horizontal scroll
          container: on narrow screens the right-hand columns (price/availability/status/
          actions) stay reachable by swipe instead of being clipped. min-w-0 prevents the
          card growing past its flex/grid parent (the min-width:auto trap). */}
      <div className="min-w-0 overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="text-xs font-medium tracking-wide text-muted-foreground"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={() => router.push(editHref(row.original.id))}
                  className="cursor-pointer hover:bg-accent/40"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={colCount} className="h-24 text-center text-muted-foreground">
                  {rows.length === 0 ? "No quick move-ins yet." : "No matching quick move-ins."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── footer: selection summary + pagination ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {selectedCount > 0
            ? `${selectedCount} of ${filteredCount} selected`
            : `${filteredCount} record${filteredCount === 1 ? "" : "s"}`}
        </p>
        {table.getPageCount() > 1 ? (
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
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
        ) : null}
      </div>
    </div>
  )
}
