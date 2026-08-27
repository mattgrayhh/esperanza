"use client"

// =============================================================================
// packages/admin — BESPOKE Blogs CALENDAR (presentation only).
//
// Adapted from /tmp/bundui/app/dashboard/(auth)/apps/calendar (its month-view layout
// + day-cell idioms) but PURPOSE-BUILT for visualising blog POST DATES:
//   * NO drag-and-drop / scheduling machinery (the bundui calendar is a full DnD
//     event scheduler; blogs are read-only points on a month grid). We keep only the
//     month grid + "+N more" popover overflow.
//   * Rebuilt against THIS repo's base-ui primitives (Popover render={} not Radix
//     asChild) and brand tokens — the bundui source uses Radix idioms that don't
//     exist here.
//
// Each blog is placed on its POST DATE (publish_date, falling back to created_at —
// resolved server-side in lib/blogs-list.ts). Posts WITHOUT any date are surfaced in
// an "Undated" tray below the grid so they're never silently dropped. Clicking a
// post (in a cell or the overflow popover) navigates to the blog editor
// (/blogs/<id>); clicking an empty day opens /blogs/new (create a post).
//
// NO client-side data fetching — rows are passed in from the RSC.
// =============================================================================

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns"
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { type BlogRow, editHref, newHref, parsePostDate } from "./blog-shared"

// How many post chips fit in a cell before collapsing into "+N more".
const MAX_VISIBLE_PER_DAY = 3

interface DatedBlog {
  row: BlogRow
  date: Date
}

/** A small post chip — green dot = published, gray = draft; click → editor. */
function PostChip({
  row,
  onNavigate,
  className,
}: {
  row: BlogRow
  onNavigate: (id: string) => void
  className?: string
}) {
  return (
    <button
      type="button"
      title={row.title || "Untitled post"}
      onClick={(e) => {
        e.stopPropagation()
        onNavigate(row.id)
      }}
      className={cn(
        "flex w-full items-center gap-1.5 overflow-hidden rounded px-1 py-0.5 text-left text-[11px] leading-tight transition-colors",
        "bg-muted/60 hover:bg-accent",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          row.published ? "bg-status-published" : "bg-status-draft",
        )}
      />
      <span className="truncate text-foreground/90">{row.title || "Untitled post"}</span>
    </button>
  )
}

export function BlogsCalendar({ rows }: { rows: BlogRow[] }) {
  const router = useRouter()
  const navigate = React.useCallback((id: string) => router.push(editHref(id)), [router])

  // Resolve each row's post date once; split into dated vs. undated.
  const { dated, undated } = React.useMemo(() => {
    const dated: DatedBlog[] = []
    const undated: BlogRow[] = []
    for (const row of rows) {
      const date = parsePostDate(row.postDate)
      if (date) dated.push({ row, date })
      else undated.push(row)
    }
    return { dated, undated }
  }, [rows])

  // Start the calendar on the month containing the most-recent post (or today).
  const initialMonth = React.useMemo(() => {
    if (dated.length === 0) return startOfMonth(new Date())
    const newest = dated.reduce((a, b) => (a.date > b.date ? a : b)).date
    return startOfMonth(newest)
  }, [dated])

  const [currentMonth, setCurrentMonth] = React.useState<Date>(initialMonth)

  // The 6-week grid spanning the visible month (Sun-start, like bundui).
  const days = React.useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(monthStart)
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 })
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
    return eachDayOfInterval({ start: calStart, end: calEnd })
  }, [currentMonth])

  const weekdays = React.useMemo(
    () =>
      Array.from({ length: 7 }).map((_, i) =>
        format(new Date(2024, 0, 7 + i), "EEE"), // 2024-01-07 is a Sunday
      ),
    [],
  )

  // Group dated posts by calendar day (yyyy-MM-dd key), newest-first within a day.
  const byDay = React.useMemo(() => {
    const map = new Map<string, BlogRow[]>()
    for (const { row, date } of dated) {
      const key = format(date, "yyyy-MM-dd")
      const list = map.get(key)
      if (list) list.push(row)
      else map.set(key, [row])
    }
    return map
  }, [dated])

  const postsOn = React.useCallback(
    (day: Date): BlogRow[] => byDay.get(format(day, "yyyy-MM-dd")) ?? [],
    [byDay],
  )

  const monthCount = dated.filter((d) => isSameMonth(d.date, currentMonth)).length

  return (
    <div className="flex flex-col gap-4">
      {/* ── calendar toolbar: month label + prev/today/next ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">
            {format(currentMonth, "MMMM yyyy")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {monthCount} post{monthCount === 1 ? "" : "s"} this month
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous month"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next month"
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* ── month grid ── */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* weekday header */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {weekdays.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        {/* day cells */}
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const isCurrentMonth = isSameMonth(day, currentMonth)
            const posts = postsOn(day)
            const visible = posts.slice(0, MAX_VISIBLE_PER_DAY)
            const overflow = posts.length - visible.length

            return (
              <div
                key={day.toISOString()}
                className={cn(
                  "group/cell relative min-h-24 border-r border-b border-border p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0",
                  !isCurrentMonth && "bg-muted/25 text-muted-foreground/70",
                )}
              >
                {/* day-number row (+ a quiet "new post here" affordance on hover) */}
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex size-6 items-center justify-center rounded-full text-xs",
                      isToday(day)
                        ? "bg-primary font-medium text-primary-foreground"
                        : "text-foreground/80",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`New post on ${format(day, "MMM d, yyyy")}`}
                    title="New post"
                    className="opacity-0 transition-opacity group-hover/cell:opacity-100 focus-visible:opacity-100"
                    render={<Link href={newHref} />}
                  >
                    <CalendarPlus className="size-3.5" />
                  </Button>
                </div>

                {/* post chips */}
                <div className="flex flex-col gap-1">
                  {visible.map((row) => (
                    <PostChip key={row.id} row={row} onNavigate={navigate} />
                  ))}

                  {overflow > 0 ? (
                    <Popover>
                      <PopoverTrigger
                        render={
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 w-full rounded px-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            +{overflow} more
                          </button>
                        }
                      />
                      <PopoverContent align="start" className="w-56 gap-1.5 p-2">
                        <div className="px-1 text-xs font-medium text-foreground">
                          {format(day, "EEEE, MMM d")}
                        </div>
                        <div className="flex flex-col gap-1">
                          {posts.map((row) => (
                            <PostChip key={row.id} row={row} onNavigate={navigate} />
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── undated tray — posts with no publish/created date never get silently dropped ── */}
      {undated.length > 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            {undated.length} post{undated.length === 1 ? "" : "s"} with no post date — not shown on
            the calendar
          </p>
          <div className="flex flex-wrap gap-1.5">
            {undated.map((row) => (
              <PostChip
                key={row.id}
                row={row}
                onNavigate={navigate}
                className="w-auto max-w-48"
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
