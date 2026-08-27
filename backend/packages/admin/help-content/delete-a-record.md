---
slug: delete-a-record
title: Delete a record (and Draft vs. Delete)
category: Getting Started
categorySort: 10
sort: 40
summary: How to permanently delete a record, and when to use Draft instead.
keywords: delete, remove, trash, draft, hide, cleanup, test record
---

Every record's edit page has a red **Delete** button in the top-right header,
next to the Status control. Use it to permanently remove a record.

Clicking **Delete** opens a confirmation showing the record's name. Confirming
removes it from the database **and** from the live site. This can't be undone.

## Draft vs. Delete — pick the right one

- **Draft** hides the page from the live site, but the item **stays in the CMS**
  (hidden). Use Draft when you might bring it back, or for anything seasonal.
- **Delete** removes the record entirely — from the database and the CMS. Use it
  for test records and true junk you never want again.

## Homes, communities, and floor plans

These come from Snowflake. If you **Delete** one, the next sync will simply
re-create it. For those, **Draft is what you want** to hide it — the Delete
dialog warns you about this. Delete is only useful there for stray junk rows that
won't come back from Snowflake.
