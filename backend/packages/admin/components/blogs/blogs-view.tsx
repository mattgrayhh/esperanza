"use client"

// =============================================================================
// packages/admin — BESPOKE Blogs screen shell (presentation only).
//
// Owns the header (title + count + New) and the LIST | CALENDAR view toggle, then
// renders either the shadcn data-table (BlogsDataTable) or the month calendar
// (BlogsCalendar). Both consume the SAME already-fetched, serializable rows from the
// RSC (app/blogs/page.tsx → lib/blogs-list.ts → getReadDb()); NO client-side data
// fetching happens here — the view toggle is pure local UI state.
//
// A single base-ui Tabs root holds BOTH the toggle (TabsList/TabsTrigger in the
// header) and the two panels (TabsContent), so triggers and panels stay paired.
// =============================================================================

import * as React from "react"
import Link from "next/link"
import { CalendarDays, List, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type BlogRow, newHref } from "./blog-shared"
import { BlogsDataTable } from "./blogs-data-table"
import { BlogsCalendar } from "./blogs-calendar"

type ViewKey = "list" | "calendar"

export function BlogsView({ rows, truncated }: { rows: BlogRow[]; truncated: boolean }) {
  const [view, setView] = React.useState<ViewKey>("list")

  return (
    <Tabs value={view} onValueChange={(v) => setView(v as ViewKey)} className="gap-5">
      {/* ── header: title + count + view toggle + New ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">Blogs</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rows.length} post{rows.length === 1 ? "" : "s"}
            {truncated ? ` · showing first ${rows.length}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TabsList>
            <TabsTrigger value="list">
              <List className="size-3.5" />
              List
            </TabsTrigger>
            <TabsTrigger value="calendar">
              <CalendarDays className="size-3.5" />
              Calendar
            </TabsTrigger>
          </TabsList>
          <Button render={<Link href={newHref} />}>
            <Plus className="size-4" />
            New
          </Button>
        </div>
      </div>

      <TabsContent value="list">
        <BlogsDataTable rows={rows} />
      </TabsContent>
      <TabsContent value="calendar">
        <BlogsCalendar rows={rows} />
      </TabsContent>
    </Tabs>
  )
}
