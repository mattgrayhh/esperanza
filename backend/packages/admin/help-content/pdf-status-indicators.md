---
slug: pdf-status-indicators
title: "PDFs: status colors and when they were generated"
category: Publishing
categorySort: 60
sort: 20
summary: What the green / orange / red dots on the PDFs page mean and how to refresh an out-of-date PDF.
keywords: pdf, pdfs, status, color, green, orange, red, generated, stale, regenerate, last updated
---

The **PDFs** page lists every generated PDF (community brochures, floor-plan and
QMI spec sheets, and the city / master lists), grouped City → Community. Each row
shows a colored dot, the file, and **when it was last generated** (e.g. "Generated
2d ago", or "Never generated").

## What the colors mean

The dot is a hybrid signal — it reflects both whether the PDF is current and how
long ago it was built. The worst-case wins:

- 🟢 **Green — up to date.** Built against the current PDF theme, no errors, and
  generated within the last 30 days.
- 🟠 **Orange — out of date.** The PDF still exists and downloads, but it should be
  refreshed because one of these is true: it's marked stale, it was built against an
  older theme version, or it's more than 30 days old (its data may have changed
  since).
- 🔴 **Red — error or never built.** The last attempt to generate it failed, or it
  has never been generated. There may be no downloadable file.
- 🔵 **Blue — rendering.** It's being generated right now; the dot turns green/orange
  shortly after.

## Refreshing a PDF

- Click the **↻ (Regenerate)** button on any row to rebuild that single PDF on the
  next request.
- Use **Rebuild stale** on a city header to refresh every out-of-date PDF in that
  city at once.

A regenerated PDF returns to green once it finishes building. If it goes red after
a regenerate, the render is failing — see [How changes reach the live site](how-changes-reach-the-site).

## Notes

- "Generated X ago" is the last successful render time, not the last data change.
  A green PDF can still be regenerated manually any time you want to be certain it
  reflects the very latest data.
- The **Theme v…** badge shows the active PDF theme version; any PDF built against an
  older version is flagged orange until rebuilt.
