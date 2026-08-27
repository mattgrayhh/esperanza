"use client"

// =============================================================================
// packages/admin — BESPOKE Blogs LIST table (presentation only).
//
// Receives already-fetched, serializable blog rows from the RSC (app/blogs/page.tsx,
// via lib/blogs-list.ts → getReadDb()). It performs NO client-side data fetching —
// every value is computed server-side. This component only re-skins/sort/filter/
// paginate the rows with @tanstack/react-table + the project's base-ui primitives.
//
// Visual pattern adapted from the bespoke QMI table (filter tabs, search, Columns
// toggle, sortable headers, pagination, row-click → editor) rebuilt against THIS
// repo's base-ui components (render={} not asChild; brand --color-status-* tokens).
//
// Columns (spec order):
//   1 Thumbnail (featured_image)   2 Title (+ slug sub-line)   3 Category
//   4 Community   5 Post date   6 Status (Published/Draft)   7 row ⋯ menu
// =============================================================================

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  SquareArrowOutUpRight,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { type BlogRow, editHref, fmtPostDate } from "./blog-shared"

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
        className="h-11 w-16 shrink-0 rounded-md border border-border object-cover"
      />
    )
  }
  return (
    <div
      className="flex h-11 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground"
      aria-label="No image"
    >
      <FileText className="size-4 opacity-60" />
    </div>
  )
}

/** Title cell — bold linked title + muted slug sub-line. */
function TitleCell({ row }: { row: BlogRow }) {
  return (
    <div className="min-w-0">
      <Link
        href={editHref(row.id)}
        onClick={(e) => e.stopPropagation()}
        className="block truncate font-medium text-foreground hover:text-primary hover:underline"
      >
        {row.title || <span className="text-muted-foreground italic">Untitled post</span>}
      </Link>
      {row.slug ? (
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">/{row.slug}</span>
      ) : (
        <span className="mt-0.5 block text-xs text-muted-foreground">—</span>
      )}
    </div>
  )
}

/** Status cell — colored dot + label (green=Published, gray=Draft). */
function StatusCell({ row }: { row: BlogRow }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          row.published ? "bg-status-published" : "bg-status-draft",
        )}
        aria-hidden
      />
      <span className={cn("text-sm", row.published ? "text-foreground" : "text-muted-foreground")}>
        {row.published ? "Published" : "Draft"}
      </span>
    </span>
  )
}

/** Post-date cell — formatted date, with a subtle hint when it's a created-at fallback. */
function PostDateCell({ row }: { row: BlogRow }) {
  const label = fmtPostDate(row.postDate)
  if (!label) return <span className="text-muted-foreground">No date</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums text-foreground/90">{label}</span>
      {!row.hasExplicitDate ? (
        <Badge
          variant="outline"
          className="h-4 px-1 text-[10px] leading-none text-muted-foreground"
          title="No publish date set — showing the created date"
        >
          created
        </Badge>
      ) : null}
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
// column model
// =============================================================================
const COLUMN_LABELS: Record<string, string> = {
  thumbnail: "Thumbnail",
  title: "Title",
  category: "Category",
  community: "Community",
  postDate: "Post date",
  status: "Status",
}

function buildColumns(): ColumnDef<BlogRow>[] {
  return [
    {
      id: "thumbnail",
      enableSorting: false,
      header: () => <span className="sr-only">Thumbnail</span>,
      cell: ({ row }) => (
        <Thumb src={row.original.thumbnail} alt={row.original.title || "Blog post"} />
      ),
    },
    {
      id: "title",
      accessorFn: (r) => r.title,
      header: ({ column }) => <SortHeader label="Title" column={column} />,
      cell: ({ row }) => <TitleCell row={row.original} />,
      sortingFn: "alphanumeric",
    },
    {
      id: "category",
      accessorFn: (r) => r.category,
      header: "Category",
      cell: ({ row }) =>
        row.original.category ? (
          <Badge variant="secondary" className="font-normal">
            {row.original.category}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
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
      id: "postDate",
      // sort key: newest first by default; nulls (no date) last.
      accessorFn: (r) => {
        if (!r.postDate) return -Infinity
        const t = new Date(r.postDate).getTime()
        return Number.isNaN(t) ? -Infinity : t
      },
      header: ({ column }) => <SortHeader label="Post date" column={column} />,
      cell: ({ row }) => <PostDateCell row={row.original} />,
      sortingFn: "basic",
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
type TabKey = "all" | "published" | "draft"

const TABS: { value: TabKey; label: string }[] = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Draft" },
]

function matchesTab(row: BlogRow, tab: TabKey): boolean {
  switch (tab) {
    case "published":
      return row.published
    case "draft":
      return !row.published
    case "all":
    default:
      return true
  }
}

// =============================================================================
// BlogsDataTable
// =============================================================================
export function BlogsDataTable({ rows }: { rows: BlogRow[] }) {
  const router = useRouter()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [tab, setTab] = React.useState<TabKey>("all")

  const columns = React.useMemo(buildColumns, [])

  const tabRows = React.useMemo(() => rows.filter((r) => matchesTab(r, tab)), [rows, tab])

  const table = useReactTable({
    data: tabRows,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // search across title + slug + category + community.
    globalFilterFn: (row, _columnId, value) => {
      const q = String(value).toLowerCase().trim()
      if (!q) return true
      const r = row.original
      return [r.title, r.slug, r.category, r.communityName]
        .filter(Boolean)
        .some((s) => s.toLowerCase().includes(q))
    },
    initialState: { pagination: { pageSize: 25 } },
  })

  const filteredCount = table.getFilteredRowModel().rows.length
  const colCount = table.getVisibleLeafColumns().length

  return (
    <div className="flex flex-col gap-4">
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
            placeholder="Search title, slug, category…"
            className="pl-8"
            aria-label="Search blog posts"
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
          container: on narrow screens the right-hand columns (community/date/status/actions)
          stay reachable by swipe instead of being clipped. min-w-0 prevents the card growing
          past its flex/grid parent (the min-width:auto trap). */}
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
                  {rows.length === 0 ? "No blog posts yet." : "No matching posts."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── footer: count + pagination ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {filteredCount} post{filteredCount === 1 ? "" : "s"}
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
