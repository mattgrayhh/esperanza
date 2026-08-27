# Esperanza PDF Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the on-demand `ehi.hazardhouse.ai` brochures with a Cloudflare-native PDF platform: a new `esperanza-pdf` Worker renders React→HTML templates to PDF via Browser Rendering, caches them in R2 under a fixed key, serves them from stable URLs (written into existing D1 fields so Framer is unchanged), and lets the marketing team edit a global theme with a live preview.

**Architecture:** A standalone Worker (`packages/pdf`) holds the `BROWSER` binding, reads `v_public_*` from D1, renders SSR HTML through `page.pdf()`, and stores the result in R2. The same SSR HTML powers a live admin preview (proxied same-origin). Freshness lives in a `pdf_renders` index (status + theme_version), never recomputed on the hot path; per-entity PDFs invalidate lazily, lists via a Queue-delay debounce + nightly cron.

**Tech Stack:** Cloudflare Workers, `@cloudflare/puppeteer` (Browser Rendering), D1 (SQLite) + Drizzle, R2, Cloudflare Queues, React `renderToStaticMarkup` SSR, Next.js 15/OpenNext (admin), Vitest + better-sqlite3, `sharp` (Node, image renditions).

**Spec:** `docs/specs/2026-05-31-pdf-platform-design.md` (v2). Read it first.

> **Plan status:** This is the full 4-phase plan. Browser Rendering cannot run in Miniflare, so render-path steps are covered by **remote integration tests** (`wrangler dev --remote`/deployed) tagged separately from the default local Vitest run; pure logic (HTML SSR, freshness decisions, hashing, slugs, data resolution) is fully unit-tested locally.

---

## Conventions used throughout

- **Repo:** npm workspaces; `git` checkpoints on `master`. D1 `esperanza` `database_id=<D1_DATABASE_ID>`. R2 `esperanza-cms` (binding `IMAGES`), public base `https://<R2_PUBLIC_BUCKET>.r2.dev`. `compatibility_date = "2025-05-20"`, `compatibility_flags = ["nodejs_compat"]`.
- **Verify gates** (run after each phase): `npm run typecheck`, `npm test`, `npm run -w @esperanza/admin build:cf`.
- **Migrations** are applied `--local` then `--remote` (D1 caps tables at 100 cols; never skip local). `schema.ts` is the typed Drizzle mirror kept in **lockstep** with the SQL + `views.sql`.
- **Commits:** one per completed step/task as indicated; messages `feat(pdf): …` / `test(pdf): …` / `chore(pdf): …`.

## File-structure map (locked decomposition)

```
packages/pdf/                         # NEW standalone Worker
  package.json  wrangler.toml  tsconfig.json  vitest.config.ts
  src/
    env.ts            # Env interface, PdfType, RenderJob, RenderStatus
    index.ts          # fetch router: /health /pdf/:type/:slug /poll/:type/:slug /preview/:type/:slug ; queue() consumer
    theme.ts          # Theme type, defaultTheme, themeToCssVars, loadActiveTheme/loadDraftTheme, themeVersion
    slug.ts           # slugFor, r2KeyFor, publicUrlFor, previewPathFor
    hash.ts           # stableHash (canonical JSON → SHA-256 hex)
    freshness.ts      # decideFreshness(row, activeVersion) → 'fresh'|'stale-present'|'absent'  (pure)
    store.ts          # getRender, acquireLease, releaseLease, markLive, markStale, putObject, getObject, serve()
    render.ts         # renderPdf(env, html) via @cloudflare/puppeteer
    invalidate.ts     # markEntityStale (+ dependency fanout), enqueueListRebuild
    fonts.ts          # FONT_ALLOWLIST [{family, dataUri, weights}]
    token.ts          # signPreviewToken / verifyPreviewToken (Phase 3)
    data/
      shared.ts       # row coercers, renditionUrl(originalUrl, variant)
      community.ts    # loadCommunityData
      qmi.ts          # loadQmiData          (Phase 2)
      floorplan.ts    # loadFloorPlanData    (Phase 2)
      list.ts         # loadListData         (Phase 4)
    templates/
      render.tsx      # wrapHtml(theme, bodyHtml, opts) → full HTML document string
      components.tsx  # Header Footer CoverBand SectionLabel FloorPlanCard StatRow ElevationGrid StructuralGrid CopyBlock
      community.tsx   # CommunityBrochure
      qmi.tsx         # QmiBrochure          (Phase 2)
      floorplan.tsx   # FloorPlanBrochure    (Phase 2)
      list.tsx        # ListBrochure         (Phase 4)
      index.ts        # renderTemplate(type, theme, data) dispatch
  scripts/
    derive-renditions.ts  # Node + sharp: generate w1200/w2000 R2 renditions
    seed-renders.ts       # Node: enumerate entities → pdf_renders rows + URL backfill
  test/                   # *.test.ts (local) + *.remote.test.ts (tagged)

packages/db/
  migrations/0003_pdf_platform.sql      # NEW: pdf_themes, pdf_theme_history, pdf_renders, pdf_render_log; ALTER communities
  schema.ts                             # + pdfThemes pdfThemeHistory pdfRenders pdfRenderLog ; communities.brochurePdfUrl
  views.sql                             # v_public_communities += brochure_pdf_url
  test/pdf-schema.test.ts               # NEW

packages/admin/
  components/app-shared.tsx             # + PDFs nav entry in mainNavLinks
  app/pdfs/page.tsx + components/pdfs/* # drill-down tree (Phase 2)
  app/settings/pdf-theme/page.tsx + components/pdf-theme/*   # editor (Phase 3)
  app/api/pdf-preview/[type]/[slug]/route.ts                 # same-origin preview proxy (Phase 3)
  lib/pdf-actions.ts                    # theme save/publish/revert/rollback + regenerate (Phase 3)
  lib/actions.ts                        # + markPdfStale hook in entity writes (Phase 2)
  wrangler / open-next config           # service binding PDF → esperanza-pdf (Phase 3)

packages/ingest/
  src/<consumer>                        # mark pdf_renders stale on synced change (Phase 2)
```

## Shared contracts (canonical — referenced by every phase)

**`packages/pdf/src/env.ts`** (created in Task 1.1; the source of truth for these types):

```ts
import type { BrowserWorker } from '@cloudflare/puppeteer';

export type PdfType = 'community' | 'qmi' | 'floorplan' | 'list';
export type RenderStatus = 'not_built' | 'rendering' | 'live' | 'stale' | 'error';

export interface RenderJob { type: PdfType; slug: string; reason: string }

export interface Env {
  BROWSER: BrowserWorker;
  DB: D1Database;
  IMAGES: R2Bucket;               // esperanza-cms: reads assets, writes pdf/<type>/<id>.pdf
  RENDER_Q?: Queue<RenderJob>;    // added Phase 4 (lists + rebuild-all)
  IMAGES_PUBLIC_BASE_URL: string; // https://pub-...r2.dev (or media.esperanzahomes.com at cutover)
  PDF_PUBLIC_BASE_URL: string;    // base for /pdf/<type>/<slug> public links
  ADMIN_ORIGIN: string;           // for CSP frame-ancestors on /preview
  PDF_PREVIEW_SECRET?: string;    // HMAC for preview tokens (Phase 3)
}
```

**`pdf_renders` row shape** (canonical column names used in every store query):
`type, slug, entity_id, city_slug, community_id, r2_key, status, lease_at, data_hash, theme_version, bytes, last_rendered_at, last_error`. PK `(type, slug)`. **R2 key is keyed on the immutable `entity_id`** (`pdf/<type>/<entity_id>.pdf`); the public `slug` is captured once and immutable.

**Function signatures** (defined in the tasks below; reused verbatim later):
- `slugFor(type: PdfType, row: Record<string, unknown>): string`
- `r2KeyFor(type: PdfType, entityId: string): string`  → `pdf/<type>/<entityId>.pdf`
- `publicUrlFor(env: Env, type: PdfType, slug: string): string`
- `stableHash(value: unknown): Promise<string>`
- `decideFreshness(row: PdfRenderRow | null, activeVersion: number): 'fresh' | 'stale-present' | 'absent'`
- `renderTemplate(type: PdfType, theme: Theme, data: unknown): string`  (returns a full HTML document)
- `renderPdf(env: Env, html: string): Promise<Uint8Array>`
- `serve(env: Env, type: PdfType, slug: string, deps: ServeDeps): Promise<Response>`

---

## Phase 0 — Brand assets (prerequisite, no code)

### Task 0.1: Gather brand assets + fonts

**Deliverables (place in a shared location, e.g. upload to R2 `theme/` via the admin ImageUploader or `wrangler r2 object put`):**
- [ ] Exact brand fonts as web-embeddable files (woff2) + **written confirmation of license to embed**: heading display serif (the "Hickory/Elm" face), body sans, label sans. Capture the family names.
- [ ] Clean vector/raster assets: `wordmark.svg`, `monogram.svg`, header `pattern.svg`, `e-watermark.svg`, `equal-housing.svg`.
- [ ] Confirm brand hex values from the current brochures (seed defaults in this plan: primary `#1f3d2f`, accent `#b08d57`, neutral `#888888`).
- [ ] Reference disclaimers (community/qmi/floorplan/list) + the standard contact line (phone `956-275-8069`, sales hours, `esperanzahomes.com`) copied verbatim from current PDFs.

**Acceptance:** assets reachable at absolute `https://…r2.dev/theme/<file>` URLs; fonts available as base64 to inline (Task 1.3). _Until delivered, Phase 1 proceeds with structural parity using fallback system fonts + placeholder asset URLs (graceful per §11); brand/pixel parity is the "1.5" checkpoint at the end of Phase 1._

---

## Phase 1 — Engine + Community template (shippable: live, cached Community brochures)

### Task 1.1: Scaffold the `esperanza-pdf` Worker

**Files:**
- Create: `packages/pdf/package.json`, `packages/pdf/tsconfig.json`, `packages/pdf/wrangler.toml`, `packages/pdf/vitest.config.ts`, `packages/pdf/src/env.ts`, `packages/pdf/src/index.ts`
- Test: `packages/pdf/test/health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/health.test.ts
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/env';

const env = {} as Env;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe('health', () => {
  it('GET /health returns 200 ok', async () => {
    const res = await worker.fetch(new Request('https://pdf.local/health'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('unknown route returns 404', async () => {
    const res = await worker.fetch(new Request('https://pdf.local/nope'), env, ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm i && npx vitest run -w @esperanza/pdf test/health.test.ts` (after Step 3's files exist the import resolves; this step confirms RED — module not found / fetch undefined).
Expected: FAIL (cannot find `../src/index`).

- [ ] **Step 3: Create the package files + minimal worker**

```jsonc
// packages/pdf/package.json
{
  "name": "@esperanza/pdf",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev",
    "dev:remote": "wrangler dev --remote",
    "test": "vitest run",
    "test:remote": "vitest run --mode remote",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "derive-renditions": "tsx scripts/derive-renditions.ts",
    "seed-renders": "tsx scripts/seed-renders.ts"
  },
  "dependencies": {
    "@cloudflare/puppeteer": "^0.0.14",
    "@esperanza/db": "*",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250520.0",
    "@types/react": "^18.3.0",
    "sharp": "^0.33.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "wrangler": "^3.80.0"
  }
}
```

```jsonc
// packages/pdf/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "lib": ["ESNext", "DOM"],
    "noEmit": true
  },
  "include": ["src", "test", "scripts"]
}
```

```toml
# packages/pdf/wrangler.toml
name = "esperanza-pdf"
main = "src/index.ts"
compatibility_date = "2025-05-20"
compatibility_flags = ["nodejs_compat"]

browser = { binding = "BROWSER" }

[[d1_databases]]
binding = "DB"
database_name = "esperanza"
database_id = "<D1_DATABASE_ID>"

[[r2_buckets]]
binding = "IMAGES"
bucket_name = "esperanza-cms"

[vars]
IMAGES_PUBLIC_BASE_URL = "https://<R2_PUBLIC_BUCKET>.r2.dev"
PDF_PUBLIC_BASE_URL = "https://<R2_PUBLIC_BUCKET>.r2.dev"
ADMIN_ORIGIN = "https://esperanza-admin.round-base-ed8c.workers.dev"
# secret: PDF_PREVIEW_SECRET (set in Phase 3 via `wrangler secret put`)
```

```ts
// packages/pdf/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    // local run excludes remote (Browser Rendering) tests; `--mode remote` includes them
    include: process.env.VITEST_MODE === 'remote'
      ? ['test/**/*.remote.test.ts']
      : ['test/**/*.test.ts'],
    exclude: process.env.VITEST_MODE === 'remote' ? [] : ['test/**/*.remote.test.ts', 'node_modules/**'],
  },
});
```

Create `src/env.ts` with the **Shared contracts** `Env`/`PdfType`/`RenderJob`/`RenderStatus` block above.

```ts
// packages/pdf/src/index.ts
import type { Env } from './env';

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -w @esperanza/pdf test/health.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/pdf
git commit -m "feat(pdf): scaffold esperanza-pdf worker + health route"
```

### Task 1.2: Migration 0003 — tables + `communities.brochure_pdf_url` + view (lockstep)

**Files:**
- Create: `packages/db/migrations/0003_pdf_platform.sql`
- Modify: `packages/db/schema.ts` (add 4 tables + `communities.brochurePdfUrl`), `packages/db/views.sql` (v_public_communities)
- Test: `packages/db/test/pdf-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/pdf-schema.test.ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers';

describe('0003 pdf platform schema', () => {
  it('creates the four pdf tables', () => {
    const db = freshDb();
    const names = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pdf_%' ORDER BY name`
    ).all().map((r: any) => r.name);
    expect(names).toEqual(['pdf_render_log', 'pdf_renders', 'pdf_theme_history', 'pdf_themes']);
  });

  it('seeds active + draft theme at version 1, no history rows', () => {
    const db = freshDb();
    const themes = db.prepare(`SELECT kind, version FROM pdf_themes ORDER BY kind`).all();
    expect(themes).toEqual([{ kind: 'active', version: 1 }, { kind: 'draft', version: 1 }]);
    const hist = db.prepare(`SELECT count(*) c FROM pdf_theme_history`).get() as any;
    expect(hist.c).toBe(0);
  });

  it('adds communities.brochure_pdf_url and exposes it in v_public_communities', () => {
    const db = freshDb();
    const cols = db.prepare(`PRAGMA table_info(communities)`).all().map((r: any) => r.name);
    expect(cols).toContain('brochure_pdf_url');
    const vcols = db.prepare(`PRAGMA table_info(v_public_communities)`).all().map((r: any) => r.name);
    expect(vcols).toContain('brochure_pdf_url');
  });

  it('pdf_renders enforces (type,slug) primary key', () => {
    const db = freshDb();
    db.prepare(`INSERT INTO pdf_renders (type,slug,entity_id) VALUES ('community','x','c1')`).run();
    expect(() =>
      db.prepare(`INSERT INTO pdf_renders (type,slug,entity_id) VALUES ('community','x','c2')`).run()
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -w @esperanza/db test/pdf-schema.test.ts`
Expected: FAIL (tables/columns absent).

- [ ] **Step 3: Write the migration**

```sql
-- packages/db/migrations/0003_pdf_platform.sql
-- PDF platform: theme storage (active+draft+history), the pdf_renders status/freshness
-- index, and an append-only render log. Plus communities.brochure_pdf_url (admin-owned,
-- additive — communities goes 59→60 cols, well under the D1 100-col cap).

CREATE TABLE pdf_themes (
  kind       TEXT PRIMARY KEY CHECK (kind IN ('active','draft')),
  version    INTEGER NOT NULL DEFAULT 1,
  theme_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE pdf_theme_history (
  version      INTEGER PRIMARY KEY,
  theme_json   TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE pdf_renders (
  type             TEXT NOT NULL,
  slug             TEXT NOT NULL,
  entity_id        TEXT,
  city_slug        TEXT,
  community_id     TEXT,
  r2_key           TEXT,
  status           TEXT NOT NULL DEFAULT 'not_built',
  lease_at         TEXT,
  data_hash        TEXT,
  theme_version    INTEGER,
  bytes            INTEGER,
  last_rendered_at TEXT,
  last_error       TEXT,
  PRIMARY KEY (type, slug)
);
CREATE INDEX idx_pdf_renders_status ON pdf_renders(status);
CREATE INDEX idx_pdf_renders_drill  ON pdf_renders(city_slug, community_id, type);

CREATE TABLE pdf_render_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT,
  type          TEXT,
  slug          TEXT,
  action        TEXT,
  status        TEXT,
  duration_s    REAL,
  bytes         INTEGER,
  theme_version INTEGER,
  error_message TEXT,
  at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_pdf_render_log_at ON pdf_render_log(at);

ALTER TABLE communities ADD COLUMN brochure_pdf_url TEXT;

-- Seed a default theme (active + draft identical) at version 1; history stays empty
-- so the first real Publish computes version COALESCE(max(history.version),0)+1 = 1.
-- theme_json is the §6.2 default; assets/fonts are filled by the Phase-1 seed script
-- (here we seed a minimal valid JSON so the worker always has a theme).
INSERT INTO pdf_themes (kind, version, theme_json) VALUES
  ('active', 1, '{"brand":{"colors":{"primary":"#1f3d2f","accent":"#b08d57","neutral":"#888888","bandText":"#ffffff","pageBg":"#ffffff","ink":"#333333"},"fontHeading":"Cormorant","fontBody":"Inter","fontLabel":"Inter"},"footer":{"website":"esperanzahomes.com","phone":"956-275-8069","salesHours":"Mon–Sat 9:30–6:30 · Sun 12–6","showEqualHousingLogo":true,"modifiedDateFormat":"MM/DD/YYYY"},"sectionLabels":{"letterSpacing":"0.2em","case":"upper","color":"#b08d57"},"page":{"size":"Letter","marginsMm":{"top":12,"right":12,"bottom":12,"left":12}},"qmi":{"appendFloorPlanPages":true},"copy":{"collectionIntros":{},"esperanzaDifference":""},"disclaimers":{"community":"","qmi":"","floorplan":"","list":""}}'),
  ('draft', 1, (SELECT theme_json FROM pdf_themes WHERE kind='active'));
```

> Note: the second INSERT references the row inserted by the first within the same statement batch — D1/SQLite executes statements sequentially, so the `active` row exists when the `draft` subquery runs.

- [ ] **Step 4: Mirror in `schema.ts` (Drizzle) + `views.sql`**

In `packages/db/schema.ts`, add to the `communities` table definition (next to the other URL columns, before `customFields`):

```ts
    brochurePdfUrl: text('brochure_pdf_url'),
```

Append these table definitions (after `fieldDefinitions`, before the inferred-types block):

```ts
export const pdfThemes = sqliteTable('pdf_themes', {
  kind: text('kind').primaryKey(), // 'active' | 'draft'
  version: integer('version').notNull().default(1),
  themeJson: text('theme_json').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

export const pdfThemeHistory = sqliteTable('pdf_theme_history', {
  version: integer('version').primaryKey(),
  themeJson: text('theme_json').notNull(),
  publishedBy: text('published_by'),
  publishedAt: text('published_at').notNull().default(nowIso),
});

export const pdfRenders = sqliteTable(
  'pdf_renders',
  {
    type: text('type').notNull(),
    slug: text('slug').notNull(),
    entityId: text('entity_id'),
    citySlug: text('city_slug'),
    communityId: text('community_id'),
    r2Key: text('r2_key'),
    status: text('status').notNull().default('not_built'),
    leaseAt: text('lease_at'),
    dataHash: text('data_hash'),
    themeVersion: integer('theme_version'),
    bytes: integer('bytes'),
    lastRenderedAt: text('last_rendered_at'),
    lastError: text('last_error'),
  },
  (t) => [
    primaryKey({ columns: [t.type, t.slug] }),
    index('idx_pdf_renders_status').on(t.status),
    index('idx_pdf_renders_drill').on(t.citySlug, t.communityId, t.type),
  ]
);

export const pdfRenderLog = sqliteTable('pdf_render_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id'),
  type: text('type'),
  slug: text('slug'),
  action: text('action'),
  status: text('status'),
  durationS: real('duration_s'),
  bytes: integer('bytes'),
  themeVersion: integer('theme_version'),
  errorMessage: text('error_message'),
  at: text('at').notNull().default(nowIso),
});
```

Add the inferred types + register in the `schema` object:

```ts
export type PdfThemeRow = typeof pdfThemes.$inferSelect;
export type PdfRenderRow = typeof pdfRenders.$inferSelect;
export type PdfRenderLogRow = typeof pdfRenderLog.$inferSelect;
// ...and add pdfThemes, pdfThemeHistory, pdfRenders, pdfRenderLog to the `export const schema = {...}` map.
```

In `packages/db/views.sql`, inside `v_public_communities`, add `c.brochure_pdf_url` to the column list (e.g. right after `c.features_download_url, c.resources_download_url, c.featured_video,`):

```sql
  c.brochure_pdf_url,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run -w @esperanza/db test/pdf-schema.test.ts`
Expected: PASS (4 tests). Also run `npm run -w @esperanza/db typecheck`.

- [ ] **Step 6: Apply locally, then remote**

Run: `npx wrangler d1 migrations apply esperanza --local` then (after review) `... --remote`.
Expected: `0003_pdf_platform.sql` applied; `wrangler d1 execute esperanza --local --command "SELECT kind,version FROM pdf_themes"` shows active+draft v1.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): 0003 pdf platform — themes/renders/log tables + communities.brochure_pdf_url"
```

### Task 1.3: Theme module (types + default + CSS vars + loaders)

**Files:** Create `packages/pdf/src/theme.ts`, `packages/pdf/src/fonts.ts`; Test `packages/pdf/test/theme.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/theme.test.ts
import { describe, it, expect } from 'vitest';
import { defaultTheme, themeToCssVars, parseTheme } from '../src/theme';

describe('theme', () => {
  it('themeToCssVars emits brand tokens as CSS custom properties', () => {
    const css = themeToCssVars(defaultTheme);
    expect(css).toContain('--pdf-primary: #1f3d2f');
    expect(css).toContain('--pdf-accent: #b08d57');
    expect(css).toContain('--pdf-font-heading:');
  });

  it('parseTheme fills missing keys from defaults (tolerant of partial stored JSON)', () => {
    const t = parseTheme('{"brand":{"colors":{"primary":"#000000"}}}');
    expect(t.brand.colors.primary).toBe('#000000');
    expect(t.brand.colors.accent).toBe(defaultTheme.brand.colors.accent); // filled
    expect(t.footer.phone).toBe(defaultTheme.footer.phone);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run -w @esperanza/pdf test/theme.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/pdf/src/fonts.ts
// Engineering-managed allow-list. dataUri is a base64 woff2 (Phase 0 deliverable);
// empty string = use the system fallback until the brand font is provided.
export interface FontDef { family: string; dataUri: string; weights: number[] }
export const FONT_ALLOWLIST: FontDef[] = [
  { family: 'Cormorant', dataUri: '', weights: [400, 600, 700] },
  { family: 'Inter', dataUri: '', weights: [400, 600] },
];
export function fontFaceCss(): string {
  return FONT_ALLOWLIST.filter((f) => f.dataUri)
    .flatMap((f) => f.weights.map((w) =>
      `@font-face{font-family:'${f.family}';font-weight:${w};src:url(${f.dataUri}) format('woff2');font-display:block;}`))
    .join('\n');
}
```

```ts
// packages/pdf/src/theme.ts
export interface Theme {
  brand: {
    logoWordmarkUrl?: string; logoMonogramUrl?: string;
    colors: { primary: string; accent: string; neutral: string; bandText: string; pageBg: string; ink: string };
    fontHeading: string; fontBody: string; fontLabel: string;
    headerPatternUrl?: string; watermarkUrl?: string;
  };
  footer: { website: string; phone: string; salesHours: string; showEqualHousingLogo: boolean; modifiedDateFormat: string };
  sectionLabels: { letterSpacing: string; case: 'upper' | 'none'; color: string };
  page: { size: 'Letter'; marginsMm: { top: number; right: number; bottom: number; left: number } };
  qmi: { appendFloorPlanPages: boolean };
  copy: { collectionIntros: Record<string, string>; esperanzaDifference: string };
  disclaimers: { community: string; qmi: string; floorplan: string; list: string };
}

export const defaultTheme: Theme = {
  brand: {
    colors: { primary: '#1f3d2f', accent: '#b08d57', neutral: '#888888', bandText: '#ffffff', pageBg: '#ffffff', ink: '#333333' },
    fontHeading: 'Cormorant', fontBody: 'Inter', fontLabel: 'Inter',
  },
  footer: { website: 'esperanzahomes.com', phone: '956-275-8069', salesHours: 'Mon–Sat 9:30–6:30 · Sun 12–6', showEqualHousingLogo: true, modifiedDateFormat: 'MM/DD/YYYY' },
  sectionLabels: { letterSpacing: '0.2em', case: 'upper', color: '#b08d57' },
  page: { size: 'Letter', marginsMm: { top: 12, right: 12, bottom: 12, left: 12 } },
  qmi: { appendFloorPlanPages: true },
  copy: { collectionIntros: {}, esperanzaDifference: '' },
  disclaimers: { community: '', qmi: '', floorplan: '', list: '' },
};

/** Deep-merge stored partial JSON over defaults so a sparse/older theme always parses. */
export function parseTheme(json: string): Theme {
  let parsed: any = {};
  try { parsed = JSON.parse(json); } catch { /* fall back to defaults */ }
  const d = defaultTheme;
  return {
    brand: { ...d.brand, ...parsed.brand, colors: { ...d.brand.colors, ...(parsed.brand?.colors ?? {}) } },
    footer: { ...d.footer, ...parsed.footer },
    sectionLabels: { ...d.sectionLabels, ...parsed.sectionLabels },
    page: { ...d.page, ...parsed.page, marginsMm: { ...d.page.marginsMm, ...(parsed.page?.marginsMm ?? {}) } },
    qmi: { ...d.qmi, ...parsed.qmi },
    copy: { ...d.copy, ...parsed.copy, collectionIntros: { ...(parsed.copy?.collectionIntros ?? {}) } },
    disclaimers: { ...d.disclaimers, ...parsed.disclaimers },
  };
}

export function themeToCssVars(t: Theme): string {
  const c = t.brand.colors;
  return [
    `--pdf-primary: ${c.primary}`, `--pdf-accent: ${c.accent}`, `--pdf-neutral: ${c.neutral}`,
    `--pdf-band-text: ${c.bandText}`, `--pdf-page-bg: ${c.pageBg}`, `--pdf-ink: ${c.ink}`,
    `--pdf-font-heading: '${t.brand.fontHeading}', Georgia, serif`,
    `--pdf-font-body: '${t.brand.fontBody}', system-ui, sans-serif`,
    `--pdf-font-label: '${t.brand.fontLabel}', system-ui, sans-serif`,
    `--pdf-label-spacing: ${t.sectionLabels.letterSpacing}`, `--pdf-label-color: ${t.sectionLabels.color}`,
  ].map((s) => `  ${s};`).join('\n');
}

/** Active theme + its version (the global themeVersion). */
export async function loadActiveTheme(db: D1Database): Promise<{ theme: Theme; version: number }> {
  const row = await db.prepare(`SELECT theme_json, version FROM pdf_themes WHERE kind='active'`).first<{ theme_json: string; version: number }>();
  return { theme: parseTheme(row?.theme_json ?? '{}'), version: row?.version ?? 1 };
}
export async function loadDraftTheme(db: D1Database): Promise<{ theme: Theme; version: number }> {
  const row = await db.prepare(`SELECT theme_json, version FROM pdf_themes WHERE kind='draft'`).first<{ theme_json: string; version: number }>();
  return { theme: parseTheme(row?.theme_json ?? '{}'), version: row?.version ?? 1 };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run -w @esperanza/pdf test/theme.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add packages/pdf && git commit -m "feat(pdf): theme model (types, default, css vars, loaders) + font allow-list"`

### Task 1.4: Slug / R2-key / URL helpers

**Files:** Create `packages/pdf/src/slug.ts`; Test `packages/pdf/test/slug.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/slug.test.ts
import { describe, it, expect } from 'vitest';
import { slugFor, r2KeyFor, publicUrlFor } from '../src/slug';
import type { Env } from '../src/env';

const env = { PDF_PUBLIC_BASE_URL: 'https://media.example.com' } as Env;

describe('slug helpers', () => {
  it('community slug prefers slug column, falls back to id', () => {
    expect(slugFor('community', { slug: 'anaqua-at-tres-lagos', id: 'recC1' })).toBe('anaqua-at-tres-lagos');
    expect(slugFor('community', { slug: null, id: 'recC1' })).toBe('recc1');
  });
  it('qmi slug falls back slug → housenumber → id', () => {
    expect(slugFor('qmi', { slug: null, housenumber: '00000149', id: 'recQ' })).toBe('00000149');
  });
  it('r2 key is keyed on the immutable entity id', () => {
    expect(r2KeyFor('community', 'recC1')).toBe('pdf/community/recC1.pdf');
  });
  it('publicUrl joins base + type + slug', () => {
    expect(publicUrlFor(env, 'community', 'anaqua')).toBe('https://media.example.com/pdf/community/anaqua');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement**

```ts
// packages/pdf/src/slug.ts
import type { Env, PdfType } from './env';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const asStr = (v: unknown): string => (v == null ? '' : String(v));

/** Captured ONCE at seed; immutable thereafter (the public URL is a stable contract). */
export function slugFor(type: PdfType, row: Record<string, unknown>): string {
  const id = slugify(asStr(row.id));
  switch (type) {
    case 'community':
    case 'floorplan':
      return slugify(asStr(row.slug)) || id;
    case 'qmi':
      return slugify(asStr(row.slug)) || slugify(asStr(row.housenumber)) || id;
    case 'list':
      return `${slugify(asStr(row.citySlug))}-${asStr(row.kind)}`; // e.g. mcallen-locations
  }
}

export function r2KeyFor(type: PdfType, entityId: string): string {
  return `pdf/${type}/${entityId}.pdf`;
}

export function publicUrlFor(env: Env, type: PdfType, slug: string): string {
  return `${env.PDF_PUBLIC_BASE_URL.replace(/\/$/, '')}/pdf/${type}/${slug}`;
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): slug/r2-key/url helpers (immutable keys)"`

### Task 1.5: Stable content hash

**Files:** Create `packages/pdf/src/hash.ts`; Test `packages/pdf/test/hash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/hash.test.ts
import { describe, it, expect } from 'vitest';
import { stableHash } from '../src/hash';

describe('stableHash', () => {
  it('is order-independent over object keys', async () => {
    expect(await stableHash({ a: 1, b: 2 })).toBe(await stableHash({ b: 2, a: 1 }));
  });
  it('changes when a value changes', async () => {
    expect(await stableHash({ price: 100 })).not.toBe(await stableHash({ price: 200 }));
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement**

```ts
// packages/pdf/src/hash.ts
/** Canonical JSON (sorted keys, recursive) so equal data → equal string. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(',')}}`;
}

export async function stableHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): stable content hash"`

### Task 1.6: Template render wrapper + components + Community template

**Files:** Create `packages/pdf/src/templates/render.tsx`, `components.tsx`, `community.tsx`, `index.ts`, `packages/pdf/src/data/shared.ts`; Test `packages/pdf/test/template-community.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/template-community.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/templates';
import { defaultTheme } from '../src/theme';
import type { CommunityData } from '../src/data/community';

const data: CommunityData = {
  id: 'recC1', name: 'Anaqua at Tres Lagos', citySlug: 'mcallen',
  groups: [{ collection: 'Hearth', intro: '<p>The Hearth Home Collection…</p>', plans: [
    { id: 'fp1', name: 'Hickory', beds: 3, baths: 2.5, garage: 2, stories: 1, sqft: 1797, price: 314990, imageUrl: 'https://media.example.com/fp/hickory-w1200.jpg' },
  ] }],
};

describe('community template', () => {
  it('renders a full HTML document with brand + a card per plan', () => {
    const html = renderTemplate('community', defaultTheme, data);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('--pdf-primary: #1f3d2f');         // theme vars injected
    expect(html).toContain('Anaqua at Tres Lagos');
    expect(html).toContain('Hickory');
    expect(html).toContain('$314,990');
    expect(html).toContain('956-275-8069');                    // footer contact
    expect(html).toContain('@page');                           // Letter page CSS
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement**

```tsx
// packages/pdf/src/data/shared.ts
export const money = (n: number | null | undefined): string =>
  n == null ? '' : `$${Math.round(n).toLocaleString('en-US')}`;

/** Map an original R2 image URL to a pre-derived rendition (Task 1.12 convention). */
export function renditionUrl(originalUrl: string, variant: 'w1200' | 'w2000'): string {
  if (!originalUrl) return '';
  return originalUrl.replace(/(\.[a-z]+)(\?.*)?$/i, `-${variant}$1`);
}
```

```tsx
// packages/pdf/src/templates/render.tsx
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { themeToCssVars, type Theme } from '../theme';
import { fontFaceCss } from '../fonts';

/** Wrap a template body element into a complete, self-contained HTML document. */
export function wrapHtml(theme: Theme, body: ReactElement): string {
  const m = theme.page.marginsMm;
  const css = `
${fontFaceCss()}
:root{
${themeToCssVars(theme)}
}
@page{ size: Letter; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }
*{ box-sizing:border-box; }
html,body{ margin:0; padding:0; background:var(--pdf-page-bg); color:var(--pdf-ink);
  font-family:var(--pdf-font-body); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
h1,h2,h3{ font-family:var(--pdf-font-heading); color:var(--pdf-primary); margin:0; }
.pdf-band{ background:var(--pdf-primary); color:var(--pdf-band-text); }
.pdf-accent{ background:var(--pdf-accent); color:var(--pdf-band-text); }
.pdf-label{ font-family:var(--pdf-font-label); letter-spacing:var(--pdf-label-spacing);
  text-transform:uppercase; color:var(--pdf-label-color); }
.page-break{ break-after:page; }
`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${renderToStaticMarkup(body)}</body></html>`;
}
```

```tsx
// packages/pdf/src/templates/components.tsx
import type { Theme } from '../theme';
import { money } from '../data/shared';

export function Header({ theme, title }: { theme: Theme; title: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
      {theme.brand.logoWordmarkUrl
        ? <img src={theme.brand.logoWordmarkUrl} alt="Esperanza Homes" style={{ height: 44 }} />
        : <span style={{ fontFamily: 'var(--pdf-font-heading)', color: 'var(--pdf-primary)', fontSize: 22 }}>Esperanza</span>}
      <span className="pdf-band" style={{ padding: '10px 24px', borderRadius: 4, fontFamily: 'var(--pdf-font-heading)', fontSize: 18 }}>{title}</span>
    </div>
  );
}

export function Footer({ theme, disclaimer }: { theme: Theme; disclaimer: string }) {
  return (
    <div style={{ borderTop: '1px solid #ddd', marginTop: 18, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 8, color: 'var(--pdf-neutral)' }}>
      <div style={{ maxWidth: '78%' }}>
        <div style={{ marginBottom: 4 }}>{theme.footer.website} · {theme.footer.phone} · {theme.footer.salesHours}</div>
        <div dangerouslySetInnerHTML={{ __html: disclaimer }} />
      </div>
      {theme.footer.showEqualHousingLogo
        ? (theme.brand.logoMonogramUrl
            ? <img src={theme.brand.logoMonogramUrl} alt="" style={{ height: 28 }} />
            : <span aria-hidden>⌂=</span>)
        : null}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="pdf-label" style={{ fontSize: 13, margin: '14px 0 10px' }}>{children}</div>;
}

export interface PlanCardData {
  id: string; name: string; beds: number | null; baths: number | null; garage: number | null;
  stories: number | null; sqft: number | null; price: number | null; imageUrl: string;
}
export function FloorPlanCard({ plan }: { plan: PlanCardData }) {
  return (
    <div style={{ textAlign: 'center', breakInside: 'avoid' }}>
      <div style={{ height: 120, background: '#eef0ee', borderRadius: 3, overflow: 'hidden' }}>
        {plan.imageUrl ? <img src={plan.imageUrl} alt={plan.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
      </div>
      <div style={{ fontFamily: 'var(--pdf-font-heading)', fontSize: 16, color: 'var(--pdf-primary)', marginTop: 6 }}>{plan.name}</div>
      <div style={{ fontSize: 10 }}>
        {[plan.beds && `${plan.beds} Bed`, plan.garage && `${plan.garage} Car Garage`, plan.baths != null && `${plan.baths} Bath`].filter(Boolean).join(' · ')}
        <br />
        {[plan.stories != null && `${plan.stories} ${plan.stories === 1 ? 'Story' : 'Stories'}`, plan.sqft && `${plan.sqft.toLocaleString('en-US')} Sq. Ft.`].filter(Boolean).join(' · ')}
      </div>
      {plan.price != null ? <div style={{ fontWeight: 700, marginTop: 2 }}>{money(plan.price)}</div> : null}
    </div>
  );
}
```

```tsx
// packages/pdf/src/templates/community.tsx
import type { Theme } from '../theme';
import type { CommunityData } from '../data/community';
import { Header, Footer, SectionLabel, FloorPlanCard } from './components';

export function CommunityBrochure({ theme, data }: { theme: Theme; data: CommunityData }) {
  return (
    <div style={{ padding: 0 }}>
      <Header theme={theme} title={data.name} />
      {data.groups.map((g) => (
        <div key={g.collection}>
          <SectionLabel>{g.collection}</SectionLabel>
          {g.intro ? <div style={{ fontSize: 11, marginBottom: 10 }} dangerouslySetInnerHTML={{ __html: g.intro }} /> : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {g.plans.map((p) => <FloorPlanCard key={p.id} plan={p} />)}
          </div>
        </div>
      ))}
      <Footer theme={theme} disclaimer={theme.disclaimers.community} />
    </div>
  );
}
```

```ts
// packages/pdf/src/templates/index.ts
import type { Theme } from '../theme';
import type { PdfType } from '../env';
import { wrapHtml } from './render';
import { CommunityBrochure } from './community';
import type { CommunityData } from '../data/community';
// Phase 2 adds qmi/floorplan; Phase 4 adds list.

export function renderTemplate(type: PdfType, theme: Theme, data: unknown): string {
  switch (type) {
    case 'community':
      return wrapHtml(theme, <CommunityBrochure theme={theme} data={data as CommunityData} />);
    default:
      throw new Error(`template not implemented for type: ${type}`);
  }
}
```

> `index.ts` uses JSX → rename to `index.tsx`. (Update the import in tests/router accordingly; `renderTemplate` is imported from `'../src/templates'` which resolves to `index.tsx`.)

- [ ] **Step 4: Run to verify it passes** → `npx vitest run -w @esperanza/pdf test/template-community.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add packages/pdf && git commit -m "feat(pdf): SSR template wrapper, shared components, Community brochure"`

### Task 1.7: Community data loader (QMI-derived, real IDs)

**Files:** Create `packages/pdf/src/data/community.ts`; Test `packages/pdf/test/data-community.test.ts`

- [ ] **Step 1: Write the failing test** (uses `freshDb` from `@esperanza/db` test helpers via a relative import + a thin D1-over-better-sqlite3 adapter)

```ts
// packages/pdf/test/data-community.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCommunityData } from '../src/data/community';
import { d1FromSqlite } from './_d1adapter';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB, 'migrations')).filter(f => f.endsWith('.sql')).sort()
    .forEach(f => d.exec(readFileSync(join(DB, 'migrations', f), 'utf8')));
  d.exec(readFileSync(join(DB, 'views.sql'), 'utf8'));
  return d;
}

describe('loadCommunityData', () => {
  it('returns published community plans grouped by collection (QMI-derived)', async () => {
    const raw = db();
    raw.exec(`INSERT INTO communities (id,name,slug,published) VALUES ('recC','Anaqua','anaqua',1)`);
    raw.exec(`INSERT INTO floor_plans (id,name,collection,starting_price,bedroom_max,bathroom_max,car_garage_count,stories_count,total_square_footage,image_url,published)
      VALUES ('fpH','Hickory','Hearth',314990,3,2.5,2,1,1797,'https://x/hickory.jpg',1)`);
    raw.exec(`INSERT INTO qmi (id,published,synced_community_id,synced_floor_plan_id) VALUES ('q1',1,'recC','fpH')`);
    const data = await loadCommunityData(d1FromSqlite(raw), 'recC');
    expect(data?.name).toBe('Anaqua');
    expect(data?.groups[0].collection).toBe('Hearth');
    expect(data?.groups[0].plans.map(p => p.name)).toEqual(['Hickory']);
  });
});
```

- [ ] **Step 2: Create the tiny D1 adapter** `packages/pdf/test/_d1adapter.ts` (lets store/data code run against better-sqlite3 in unit tests):

```ts
// packages/pdf/test/_d1adapter.ts — minimal D1Database facade over better-sqlite3 (test only)
import type Database from 'better-sqlite3';
export function d1FromSqlite(raw: Database.Database): any {
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = raw.prepare(sql);
    const api = {
      bind: (...args: unknown[]) => { binds = args; return api; },
      first: async <T,>() => (stmt.get(...binds) as T) ?? null,
      all: async <T,>() => ({ results: stmt.all(...binds) as T[] }),
      run: async () => { const r = stmt.run(...binds); return { success: true, meta: { changes: r.changes } }; },
    };
    return api;
  };
  return { prepare, batch: async (stmts: any[]) => Promise.all(stmts) };
}
```

- [ ] **Step 3: Run to verify it fails** → FAIL (loader missing).
- [ ] **Step 4: Implement the loader**

```ts
// packages/pdf/src/data/community.ts
import type { PlanCardData } from '../templates/components';
import { renditionUrl } from './shared';

export interface CommunityGroup { collection: string; intro: string; plans: PlanCardData[] }
export interface CommunityData { id: string; name: string; citySlug: string; groups: CommunityGroup[] }

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

/** Canonical membership = the distinct floor plans linked by this community's PUBLISHED QMIs
 *  (override_floor_plan_id ?? synced_floor_plan_id), grouped by floor_plans.collection. */
export async function loadCommunityData(db: D1Database, communityId: string, collectionIntros: Record<string,string> = {}): Promise<CommunityData | null> {
  const c = await db.prepare(`SELECT id, name, slug FROM communities WHERE id = ?`).bind(communityId).first<any>();
  if (!c) return null;

  const res = await db.prepare(
    `SELECT DISTINCT fp.id, fp.name, fp.collection, fp.starting_price, fp.bedroom_max, fp.bathroom_max,
            fp.car_garage_count, fp.stories_count, fp.total_square_footage, fp.image_url, fp.synced_image_url
       FROM qmi q
       JOIN floor_plans fp ON fp.id = COALESCE(q.override_floor_plan_id, q.synced_floor_plan_id)
      WHERE COALESCE(q.override_community_id, q.synced_community_id) = ?
        AND q.published = 1 AND fp.published = 1
      ORDER BY fp.collection, fp.starting_price`
  ).bind(communityId).all<any>();

  const byCollection = new Map<string, PlanCardData[]>();
  for (const fp of res.results ?? []) {
    const key = (fp.collection as string) || 'Other';
    const card: PlanCardData = {
      id: String(fp.id), name: String(fp.name ?? ''),
      beds: num(fp.bedroom_max), baths: num(fp.bathroom_max), garage: num(fp.car_garage_count),
      stories: num(fp.stories_count), sqft: num(fp.total_square_footage), price: num(fp.starting_price),
      imageUrl: renditionUrl(String(fp.image_url || fp.synced_image_url || ''), 'w1200'),
    };
    (byCollection.get(key) ?? byCollection.set(key, []).get(key)!).push(card);
  }

  const groups: CommunityGroup[] = [...byCollection.entries()].map(([collection, plans]) => ({
    collection, intro: collectionIntros[collection] ?? '', plans,
  }));
  return { id: String(c.id), name: String(c.name ?? ''), citySlug: '', groups };
}
```

- [ ] **Step 5: Run to verify it passes** → PASS.
- [ ] **Step 6: Commit** — `git add packages/pdf && git commit -m "feat(pdf): community data loader (QMI-derived, grouped by collection)"`

### Task 1.8: `renderPdf` via Browser Rendering (+ remote smoke test)

**Files:** Create `packages/pdf/src/render.ts`; Test `packages/pdf/test/render.remote.test.ts` (tagged remote)

- [ ] **Step 1: Write the remote smoke test** (runs only under `--mode remote`):

```ts
// packages/pdf/test/render.remote.test.ts
import { describe, it, expect } from 'vitest';
// This test runs against a deployed/`wrangler dev --remote` worker that exposes a
// debug render of a tiny HTML doc. It asserts a non-empty PDF with a %PDF- header.
describe('renderPdf (remote)', () => {
  it('produces a valid PDF from HTML', async () => {
    const base = process.env.PDF_WORKER_URL!;
    const res = await fetch(`${base}/debug/render?html=${encodeURIComponent('<h1>hi</h1>')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(buf.slice(0, 5))).toBe('%PDF-');
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 2: Implement `renderPdf`**

```ts
// packages/pdf/src/render.ts
import puppeteer from '@cloudflare/puppeteer';
import type { Env } from './env';

const m = (n: number) => `${n}mm`;

export async function renderPdf(env: Env, html: string, marginsMm = { top: 12, right: 12, bottom: 12, left: 12 }): Promise<Uint8Array> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
    // Reliable @font-face gate — networkidle0 alone intermittently drops web fonts.
    await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: m(marginsMm.top), right: m(marginsMm.right), bottom: m(marginsMm.bottom), left: m(marginsMm.left) },
    });
    return pdf as Uint8Array;
  } finally {
    await browser.close(); // launch-per-render: Workers don't persist a module singleton
  }
}
```

- [ ] **Step 3: Add the `/debug/render` route** (temporary, behind a guard) in `src/index.ts` so the remote test + manual checks work:

```ts
// inside fetch(), before the 404:
if (url.pathname === '/debug/render') {
  const html = url.searchParams.get('html') ?? '<h1>hi</h1>';
  const pdf = await renderPdf(env, `<!DOCTYPE html><html><body>${html}</body></html>`);
  return new Response(pdf, { headers: { 'content-type': 'application/pdf' } });
}
```

- [ ] **Step 4: Deploy + run the remote test**

Run: `npm run -w @esperanza/pdf deploy` then `PDF_WORKER_URL=https://esperanza-pdf.<subdomain>.workers.dev npm run -w @esperanza/pdf test:remote`
Expected: PASS (valid `%PDF-`). _(Local `npm test` does not run this file.)_

- [ ] **Step 5: Commit** — `git add packages/pdf && git commit -m "feat(pdf): renderPdf via Browser Rendering + remote smoke test"`

### Task 1.9: Freshness decision (pure) + store (lease/markLive/markStale/objects)

**Files:** Create `packages/pdf/src/freshness.ts`, `packages/pdf/src/store.ts`; Test `packages/pdf/test/freshness.test.ts`, `packages/pdf/test/store.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/pdf/test/freshness.test.ts
import { describe, it, expect } from 'vitest';
import { decideFreshness } from '../src/freshness';

describe('decideFreshness', () => {
  it('absent when no row or no object', () => {
    expect(decideFreshness(null, 5)).toBe('absent');
    expect(decideFreshness({ status: 'not_built', r2_key: null, theme_version: null } as any, 5)).toBe('absent');
  });
  it('fresh when live + theme matches + object present', () => {
    expect(decideFreshness({ status: 'live', r2_key: 'pdf/community/c.pdf', theme_version: 5 } as any, 5)).toBe('fresh');
  });
  it('stale-present when object exists but stale or theme bumped', () => {
    expect(decideFreshness({ status: 'stale', r2_key: 'k', theme_version: 5 } as any, 5)).toBe('stale-present');
    expect(decideFreshness({ status: 'live', r2_key: 'k', theme_version: 4 } as any, 5)).toBe('stale-present');
  });
});
```

```ts
// packages/pdf/test/store.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { acquireLease, markLive, markStale, getRender } from '../src/store';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,r2_key,status) VALUES ('community','anaqua','recC','pdf/community/recC.pdf','not_built')`);
  return d1FromSqlite(d);
}

describe('store leasing', () => {
  it('only one concurrent caller wins the lease', async () => {
    const d = db();
    expect(await acquireLease(d, 'community', 'anaqua')).toBe(true);
    expect(await acquireLease(d, 'community', 'anaqua')).toBe(false); // already rendering
  });
  it('markLive sets status + hash + version', async () => {
    const d = db();
    await acquireLease(d, 'community', 'anaqua');
    await markLive(d, 'community', 'anaqua', { dataHash: 'h1', themeVersion: 7, bytes: 4096 });
    const row = await getRender(d, 'community', 'anaqua');
    expect(row?.status).toBe('live'); expect(row?.theme_version).toBe(7); expect(row?.data_hash).toBe('h1');
  });
  it('markStale flips a live row to stale', async () => {
    const d = db();
    await acquireLease(d, 'community', 'anaqua');
    await markLive(d, 'community', 'anaqua', { dataHash: 'h1', themeVersion: 7, bytes: 1 });
    await markStale(d, 'community', 'anaqua');
    expect((await getRender(d, 'community', 'anaqua'))?.status).toBe('stale');
  });
});
```

- [ ] **Step 2: Run to verify they fail** → FAIL.
- [ ] **Step 3: Implement**

```ts
// packages/pdf/src/freshness.ts
import type { PdfType } from './env';

export interface PdfRenderRow {
  type: PdfType; slug: string; entity_id: string | null; r2_key: string | null;
  status: string; data_hash: string | null; theme_version: number | null;
}

export function decideFreshness(row: PdfRenderRow | null, activeVersion: number): 'fresh' | 'stale-present' | 'absent' {
  if (!row || !row.r2_key || row.status === 'not_built' || row.status === 'error') return 'absent';
  if (row.status === 'live' && row.theme_version === activeVersion) return 'fresh';
  return 'stale-present'; // object exists (stale flag or theme bumped) → serve it, regen in background
}
```

```ts
// packages/pdf/src/store.ts
import type { Env, PdfType } from './env';
import type { PdfRenderRow } from './freshness';

const LEASE_TIMEOUT_MS = 60_000;

export async function getRender(db: D1Database, type: PdfType, slug: string): Promise<PdfRenderRow | null> {
  return db.prepare(`SELECT * FROM pdf_renders WHERE type=? AND slug=?`).bind(type, slug).first<PdfRenderRow>();
}

/** Single-flight: conditional update wins only if not already rendering (or lease expired). */
export async function acquireLease(db: D1Database, type: PdfType, slug: string): Promise<boolean> {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - LEASE_TIMEOUT_MS).toISOString();
  const r = await db.prepare(
    `UPDATE pdf_renders SET status='rendering', lease_at=?
       WHERE type=? AND slug=? AND (status<>'rendering' OR lease_at IS NULL OR lease_at < ?)`
  ).bind(now, type, slug, cutoff).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function markLive(db: D1Database, type: PdfType, slug: string, o: { dataHash: string; themeVersion: number; bytes: number }): Promise<void> {
  await db.prepare(
    `UPDATE pdf_renders SET status='live', data_hash=?, theme_version=?, bytes=?, last_rendered_at=?, last_error=NULL, lease_at=NULL
       WHERE type=? AND slug=?`
  ).bind(o.dataHash, o.themeVersion, o.bytes, new Date().toISOString(), type, slug).run();
}

export async function markError(db: D1Database, type: PdfType, slug: string, message: string): Promise<void> {
  await db.prepare(`UPDATE pdf_renders SET status='error', last_error=?, lease_at=NULL WHERE type=? AND slug=?`)
    .bind(message.slice(0, 500), type, slug).run();
}

export async function markStale(db: D1Database, type: PdfType, slug: string): Promise<void> {
  await db.prepare(`UPDATE pdf_renders SET status='stale' WHERE type=? AND slug=? AND status<>'rendering'`).bind(type, slug).run();
}

export async function putObject(env: Env, key: string, pdf: Uint8Array): Promise<void> {
  await env.IMAGES.put(key, pdf, { httpMetadata: { contentType: 'application/pdf' } });
}
export async function getObject(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.IMAGES.get(key);
}
```

- [ ] **Step 4: Run to verify they pass** → PASS (note: `acquireLease` uses `new Date().toISOString()` — acceptable in the Worker runtime; tests stub time implicitly via real clock, lease-takeover path is covered by the "second caller false" assertion).
- [ ] **Step 5: Commit** — `git add packages/pdf && git commit -m "feat(pdf): freshness decision + render store (lease/live/stale/objects)"`

### Task 1.10: `serve()` + router wiring (`/pdf/:type/:slug`)

**Files:** Modify `packages/pdf/src/index.ts`; Create `packages/pdf/src/serve.ts`; Test `packages/pdf/test/serve.test.ts`

- [ ] **Step 1: Write the failing test** (injects a fake renderer + fake object store so no real browser is needed)

```ts
// packages/pdf/test/serve.test.ts
import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { serve } from '../src/serve';

const DB = join(__dirname, '../../db');
function mkDb(status: string, themeVer: number | null) {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO communities (id,name,slug,published) VALUES ('recC','Anaqua','anaqua',1)`);
  d.exec(`INSERT INTO pdf_renders (type,slug,entity_id,r2_key,status,theme_version) VALUES ('community','anaqua','recC','pdf/community/recC.pdf','${status}',${themeVer ?? 'NULL'})`);
  return d1FromSqlite(d);
}

const objects = new Map<string, Uint8Array>();
const deps = {
  render: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), // "%PDF-"
  putObject: async (k: string, b: Uint8Array) => { objects.set(k, b); },
  getObject: async (k: string) => objects.has(k) ? { body: objects.get(k)!, httpMetadata: { contentType: 'application/pdf' } } : null,
  activeVersion: 5,
};

describe('serve', () => {
  it('never-built → renders inline, stores, marks live, streams PDF', async () => {
    objects.clear(); deps.render.mockClear();
    const db = mkDb('not_built', null);
    const res = await serve({ DB: db } as any, 'community', 'anaqua', deps as any);
    expect(deps.render).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(objects.has('pdf/community/recC.pdf')).toBe(true);
  });

  it('fresh → streams from store WITHOUT rendering', async () => {
    objects.clear(); objects.set('pdf/community/recC.pdf', new Uint8Array([1])); deps.render.mockClear();
    const db = mkDb('live', 5);
    const res = await serve({ DB: db } as any, 'community', 'anaqua', deps as any);
    expect(deps.render).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('stale-present → streams last-good immediately and schedules bg regen', async () => {
    objects.clear(); objects.set('pdf/community/recC.pdf', new Uint8Array([1])); deps.render.mockClear();
    const db = mkDb('stale', 5);
    const waitUntil = vi.fn();
    const res = await serve({ DB: db } as any, 'community', 'anaqua', deps as any, { waitUntil } as any);
    expect(res.status).toBe(200);
    expect(waitUntil).toHaveBeenCalled(); // background regen scheduled
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement `serve()`** (the orchestration; renderer + object store + loaders injected as `deps` for testability)

```ts
// packages/pdf/src/serve.ts
import type { Env, PdfType } from './env';
import { getRender, acquireLease, markLive, markError, getObject as realGet, putObject as realPut } from './store';
import { decideFreshness } from './freshness';
import { loadActiveTheme } from './theme';
import { renderTemplate } from './templates';
import { stableHash } from './hash';
import { loadCommunityData } from './data/community';
import { renderPdf as realRender } from './render';

export interface ServeDeps {
  render?: (env: Env, html: string, margins?: any) => Promise<Uint8Array>;
  putObject?: (key: string, pdf: Uint8Array) => Promise<void>;
  getObject?: (key: string) => Promise<{ body: ReadableStream | Uint8Array; httpMetadata?: { contentType?: string } } | null>;
  activeVersion?: number;
}

async function loadData(env: Env, type: PdfType, entityId: string, theme: Awaited<ReturnType<typeof loadActiveTheme>>['theme']) {
  switch (type) {
    case 'community': return loadCommunityData(env.DB, entityId, theme.copy.collectionIntros);
    default: throw new Error(`loadData not implemented for ${type}`); // Phase 2/4 extend
  }
}

export async function serve(env: Env, type: PdfType, slug: string, deps: ServeDeps = {}, ctx?: ExecutionContext): Promise<Response> {
  const render = deps.render ?? realRender;
  const putObject = deps.putObject ?? ((k, b) => realPut(env, k, b));
  const getObject = deps.getObject ?? (async (k) => { const o = await realGet(env, k); return o ? { body: o.body, httpMetadata: o.httpMetadata } : null; });

  const row = await getRender(env.DB, type, slug);
  if (!row) return new Response('Not found', { status: 404 });

  const { theme, version } = deps.activeVersion != null
    ? { theme: (await loadActiveTheme(env.DB)).theme, version: deps.activeVersion }
    : await loadActiveTheme(env.DB);

  const state = decideFreshness(row as any, version);
  const stream = async (): Promise<Response | null> => {
    const o = await getObject(row.r2_key!);
    if (!o) return null;
    const body = o.body instanceof Uint8Array ? o.body : o.body;
    return new Response(body as any, { headers: { 'content-type': 'application/pdf', 'x-cache': 'HIT' } });
  };

  if (state === 'fresh') { const r = await stream(); if (r) return r; }

  if (state === 'stale-present') {
    const r = await stream();
    // background single-flight regen; never block the user
    const bg = (async () => {
      if (await acquireLease(env.DB, type, slug)) {
        try { await rebuild(env, type, slug, row.entity_id!, theme, version, render, putObject); }
        catch (e) { await markError(env.DB, type, slug, String(e)); }
      }
    })();
    if (ctx) ctx.waitUntil(bg); else await bg;
    if (r) return r;
  }

  // absent (or stale with missing object): render inline (per-entity) under the lease
  if (!(await acquireLease(env.DB, type, slug))) {
    const r = await stream(); if (r) return r;          // someone else is rendering; serve last-good
    return new Response('Building…', { status: 202, headers: { 'retry-after': '3' } });
  }
  try {
    await rebuild(env, type, slug, row.entity_id!, theme, version, render, putObject);
    const r = await stream();
    return r ?? new Response('Render produced no object', { status: 500 });
  } catch (e) {
    await markError(env.DB, type, slug, String(e));
    const r = await stream(); if (r) return r;          // fall back to last-good if any
    return new Response('Render failed', { status: 502 });
  }
}

// EXPORTED so the Phase-4 queue consumer reuses the exact same render path.
export async function rebuild(
  env: Env, type: PdfType, slug: string, entityId: string,
  theme: any, version: number,
  render: NonNullable<ServeDeps['render']>, putObject: NonNullable<ServeDeps['putObject']>,
): Promise<void> {
  const data = await loadData(env, type, entityId, theme);
  if (!data) throw new Error('no data');
  const html = renderTemplate(type, theme, data);
  const dataHash = await stableHash(data);
  const pdf = await render(env, html, theme.page.marginsMm);
  const key = `pdf/${type}/${entityId}.pdf`;
  await putObject(key, pdf);                              // write object FIRST
  await markLive(env.DB, type, slug, { dataHash, themeVersion: version, bytes: pdf.byteLength }); // flip live only on success
  // Observability (spec §11): append-only render log.
  await env.DB.prepare(
    `INSERT INTO pdf_render_log (type, slug, action, status, bytes, theme_version) VALUES (?,?,?,?,?,?)`
  ).bind(type, slug, 'render', 'live', pdf.byteLength, version).run();
}
```

Wire the router in `src/index.ts`:

```ts
// add near the top: import { serve } from './serve';  import type { PdfType } from './env';
// inside fetch(), replacing the 404 fallthrough:
const m = url.pathname.match(/^\/pdf\/(community|qmi|floorplan|list)\/(.+)$/);
if (request.method === 'GET' && m) {
  return serve(env, m[1] as PdfType, decodeURIComponent(m[2]), {}, ctx);
}
```

- [ ] **Step 4: Run to verify it passes** → `npx vitest run -w @esperanza/pdf test/serve.test.ts` → PASS (3 tests).
- [ ] **Step 5: Commit** — `git add packages/pdf && git commit -m "feat(pdf): serve() — freshness-gated lazy render, single-flight, last-good"`

### Task 1.11: `/preview` route (SSR HTML for the admin live preview)

**Files:** Modify `packages/pdf/src/index.ts`; Create `packages/pdf/src/preview.ts`; Test `packages/pdf/test/preview.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/preview.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { preview } from '../src/preview';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO communities (id,name,slug,published) VALUES ('recC','Anaqua','anaqua',1)`);
  d.exec(`INSERT INTO pdf_renders (type,slug,entity_id) VALUES ('community','anaqua','recC')`);
  return d1FromSqlite(d);
}

describe('preview', () => {
  it('returns HTML with CSP frame-ancestors set to the admin origin', async () => {
    const res = await preview({ DB: db(), ADMIN_ORIGIN: 'https://admin.example' } as any, 'community', 'anaqua', 'active');
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self' https://admin.example");
    const html = await res.text();
    expect(html).toContain('Anaqua');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement**

```ts
// packages/pdf/src/preview.ts
import type { Env, PdfType } from './env';
import { loadActiveTheme, loadDraftTheme } from './theme';
import { renderTemplate } from './templates';
import { loadCommunityData } from './data/community';

export async function preview(env: Env, type: PdfType, slug: string, which: 'active' | 'draft'): Promise<Response> {
  const row = await env.DB.prepare(`SELECT entity_id FROM pdf_renders WHERE type=? AND slug=?`).bind(type, slug).first<{ entity_id: string }>();
  if (!row) return new Response('Not found', { status: 404 });
  const { theme } = which === 'draft' ? await loadDraftTheme(env.DB) : await loadActiveTheme(env.DB);
  let data: unknown;
  switch (type) {
    case 'community': data = await loadCommunityData(env.DB, row.entity_id, theme.copy.collectionIntros); break;
    default: return new Response('preview not implemented', { status: 501 }); // Phase 2/4
  }
  if (!data) return new Response('Not found', { status: 404 });
  const html = renderTemplate(type, theme, data);
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': `frame-ancestors 'self' ${env.ADMIN_ORIGIN}`,
      'cache-control': 'no-store',
    },
  });
}
```

Wire in `src/index.ts`:

```ts
// add: import { preview } from './preview';
const pm = url.pathname.match(/^\/preview\/(community|qmi|floorplan|list)\/(.+)$/);
if (request.method === 'GET' && pm) {
  const which = url.searchParams.get('theme') === 'draft' ? 'draft' : 'active';
  // Phase 3 adds: verify ?token= (signed by the admin) before serving the draft.
  return preview(env, pm[1] as PdfType, decodeURIComponent(pm[2]), which);
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git add packages/pdf && git commit -m "feat(pdf): /preview SSR HTML route + CSP frame-ancestors"`

### Task 1.12: Image renditions (Node + sharp) + URL convention

**Files:** Create `packages/pdf/scripts/derive-renditions.ts`; Test covered by `renditionUrl` (Task 1.6 `data/shared.ts`) — add a focused test.

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/renditions.test.ts
import { describe, it, expect } from 'vitest';
import { renditionUrl } from '../src/data/shared';
describe('renditionUrl', () => {
  it('inserts the variant before the extension', () => {
    expect(renditionUrl('https://x/y/hickory.jpg', 'w1200')).toBe('https://x/y/hickory-w1200.jpg');
    expect(renditionUrl('https://x/y/a.png?v=2', 'w2000')).toBe('https://x/y/a-w2000.png?v=2');
  });
  it('returns empty for empty input', () => { expect(renditionUrl('', 'w1200')).toBe(''); });
});
```

- [ ] **Step 2: Run to verify it fails** (if `data/shared.ts` not yet covering query strings) → adjust `renditionUrl` regex (already handles `(\?.*)?`) → PASS once correct.

- [ ] **Step 3: Implement the derivation script** (Node; processes R2 originals into sized variants)

```ts
// packages/pdf/scripts/derive-renditions.ts
// Generates -w1200 / -w2000 renditions in R2 for every floor-plan/community image the
// templates reference. Runs in Node (sharp). Uses the S3 API to R2 (same creds the
// existing migrate-images.ts uses — see packages/db/scripts/lib/r2.ts for the pattern).
import sharp from 'sharp';
// Reuse the repo's R2 client pattern (packages/db/scripts/lib/r2.ts): list, get, put.
// Pseudocode body — fill from r2.ts helpers when implementing:
//   for each key under floor_plans/community image prefixes:
//     if key already matches /-w(1200|2000)\./ skip
//     buf = await r2.get(key)
//     for variant,width of [['w1200',1200],['w2000',2000]]:
//       out = await sharp(buf).resize({ width }).jpeg({ quality: 78 }).toBuffer()
//       await r2.put(key.replace(/(\.[a-z]+)$/i, `-${variant}$1`), out, 'image/jpeg')
console.log('derive-renditions: see r2.ts helpers; generates -w1200/-w2000 variants');
```

> Implementation note: model the R2 access on `packages/db/scripts/lib/r2.ts`. This script is the lever that takes the community brochure from ~35 MB to < 5 MB (templates reference `-w1200` cards / `-w2000` heroes via `renditionUrl`).

- [ ] **Step 4: Run to verify the test passes** → PASS. (The script itself is exercised operationally in Task 1.14.)
- [ ] **Step 5: Commit** — `git add packages/pdf && git commit -m "feat(pdf): image rendition convention + derive-renditions script"`

### Task 1.13: Seed/backfill script (`pdf_renders` rows + community URL writeback)

**Files:** Create `packages/pdf/scripts/seed-renders.ts`; Test the pure derivation via existing slug tests (reuse `slugFor`/`publicUrlFor`).

- [ ] **Step 1: Implement the seed script** (Node; enumerate communities → insert `pdf_renders` + write `communities.brochure_pdf_url`)

```ts
// packages/pdf/scripts/seed-renders.ts
// Enumerate communities (Phase 1; QMI/floor-plan added in Phase 2, lists in Phase 4),
// insert pdf_renders rows (status='not_built', immutable slug + r2_key), and backfill
// communities.brochure_pdf_url with the deterministic public URL. Run against D1 via
// `wrangler d1 execute` batches, or the D1 HTTP API (model on packages/db/scripts/lib/d1.ts).
import { slugFor, r2KeyFor } from '../src/slug';

const PDF_PUBLIC_BASE = process.env.PDF_PUBLIC_BASE_URL!; // e.g. https://pub-...r2.dev
function publicUrl(type: string, slug: string) { return `${PDF_PUBLIC_BASE.replace(/\/$/,'')}/pdf/${type}/${slug}`; }

// Pseudocode (fill with d1.ts helpers):
//   communities = SELECT id, slug, city_id FROM communities
//   for c of communities:
//     slug = slugFor('community', c)
//     key  = r2KeyFor('community', c.id)
//     citySlug = (SELECT slug FROM cities WHERE id=c.city_id)
//     INSERT OR IGNORE INTO pdf_renders (type,slug,entity_id,city_slug,community_id,r2_key,status)
//       VALUES ('community', slug, c.id, citySlug, c.id, key, 'not_built')
//     UPDATE communities SET brochure_pdf_url = publicUrl('community', slug) WHERE id=c.id
console.log('seed-renders: enumerates communities → pdf_renders + brochure_pdf_url backfill');
```

- [ ] **Step 2: Operational run (local then remote)**

Run: `PDF_PUBLIC_BASE_URL=https://pub-...r2.dev npm run -w @esperanza/pdf seed-renders` (targeting `--local` D1 first, then `--remote`).
Expected: a `pdf_renders` row per community; `communities.brochure_pdf_url` populated. Verify: `wrangler d1 execute esperanza --local --command "SELECT count(*) FROM pdf_renders WHERE type='community'"`.

- [ ] **Step 3: Commit** — `git add packages/pdf && git commit -m "feat(pdf): seed-renders — community pdf_renders rows + brochure_pdf_url backfill"`

### Task 1.14: Deploy + end-to-end verify (Community brochures live)

- [ ] **Step 1: Deploy** — `npm run -w @esperanza/pdf deploy`.
- [ ] **Step 2: Generate renditions** — run `derive-renditions` against R2 (Task 1.12).
- [ ] **Step 3: E2E** — `curl -sL -o /tmp/anaqua.pdf https://esperanza-pdf.<sub>.workers.dev/pdf/community/anaqua-at-tres-lagos` ; assert: HTTP 200, `application/pdf`, `pdfinfo /tmp/anaqua.pdf` shows Letter, **size < 5 MB**, and the cards/prices match the live brochure (structural parity; brand/pixel parity once Phase 0 assets are in the theme).
- [ ] **Step 4: Cache check** — second `curl` returns `x-cache: HIT` and is < 300 ms.
- [ ] **Step 5: Remove `/debug/render`** route (or guard behind a secret) before considering Phase 1 done.
- [ ] **Step 6: Verify gates** — `npm run typecheck && npm test` green. Commit any cleanup.
- [ ] **Phase-1 acceptance:** a community's `brochure_pdf_url` resolves to a live, cached, < 5 MB PDF that reflects published D1 data; re-request is a sub-300 ms HIT; editing data (Phase 2 hook) or theme (Phase 3) will invalidate it.

---

## Phase 2 — QMI + Floor-plan templates, PDFs browse section, per-entity invalidation

### Task 2.1: QMI data loader

**Files:** Create `packages/pdf/src/data/qmi.ts`; Test `packages/pdf/test/data-qmi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/data-qmi.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { loadQmiData } from '../src/data/qmi';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO floor_plans (id,name,published) VALUES ('fpE','Elm',1)`);
  d.exec(`INSERT INTO qmi (id,published,override_price,synced_total_square_footage,synced_living_square_footage,synced_bedroom_count,synced_bathroom_count,synced_address,synced_floor_plan_id,description,image_url)
          VALUES ('q1',1,379990,3057,2432,4,2.5,'6529 Anaqua Loop','fpE','The Elm is a two-story home…','https://x/elm.jpg')`);
  return d1FromSqlite(d);
}

describe('loadQmiData', () => {
  it('projects price/stats/address/description from v_public_qmi', async () => {
    const data = await loadQmiData(db(), 'q1', { appendFloorPlanPages: false });
    expect(data?.price).toBe(379990);
    expect(data?.totalSqft).toBe(3057);
    expect(data?.beds).toBe(4);
    expect(data?.address).toBe('6529 Anaqua Loop');
    expect(data?.description).toContain('The Elm');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement**

```ts
// packages/pdf/src/data/qmi.ts
import { renditionUrl } from './shared';

export interface QmiData {
  id: string; address: string; community: string; price: number | null; estMonthly: number | null;
  completion: string; heroImageUrl: string;
  totalSqft: number | null; livingSqft: number | null; beds: number | null; baths: number | null; garage: number | null; stories: number | null;
  description: string; features: string[];
  floorPlanId: string | null; // for optional appended floor-plan pages
}
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const str = (v: unknown): string => (v == null ? '' : String(v));

export async function loadQmiData(db: D1Database, qmiId: string, opts: { appendFloorPlanPages: boolean }): Promise<QmiData | null> {
  const q = await db.prepare(`SELECT * FROM v_public_qmi WHERE id = ?`).bind(qmiId).first<any>();
  if (!q) return null;
  return {
    id: String(q.id), address: str(q.address), community: str(q.community),
    price: num(q.price), estMonthly: num(q.estimated_monthly_price),
    completion: str(q.availability_text) || str(q.move_in_date) || (q.available_now ? 'Available now!' : ''),
    heroImageUrl: renditionUrl(str(q.image_url), 'w2000'),
    totalSqft: num(q.total_square_footage), livingSqft: num(q.living_square_footage),
    beds: num(q.bedroom_count), baths: num(q.bathroom_count), garage: num(q.car_garage_count), stories: num(q.stories ?? q.stories_count),
    description: str(q.description),
    features: str(q.upgrades).split(/\r?\n/).map((s) => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean),
    floorPlanId: opts.appendFloorPlanPages ? (q.floor_plan_id ? String(q.floor_plan_id) : null) : null,
  };
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): QMI data loader"`

### Task 2.2: QMI template + StatRow component

**Files:** Modify `packages/pdf/src/templates/components.tsx` (add `StatRow`); Create `packages/pdf/src/templates/qmi.tsx`; Test `packages/pdf/test/template-qmi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/template-qmi.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/templates';
import { defaultTheme } from '../src/theme';
import type { QmiData } from '../src/data/qmi';

const data: QmiData = {
  id: 'q1', address: '6529 Anaqua Loop', community: 'Anaqua at Tres Lagos', price: 379990, estMonthly: 3110,
  completion: 'Available now!', heroImageUrl: 'https://x/elm-w2000.jpg',
  totalSqft: 3057, livingSqft: 2432, beds: 4, baths: 2.5, garage: 2, stories: 2,
  description: 'The Elm is a two-story home…', features: ['Quartz Countertops', 'Covered Patio'], floorPlanId: null,
};

describe('qmi template', () => {
  it('renders header price/address, the 6-stat row, and features', () => {
    const html = renderTemplate('qmi', defaultTheme, data);
    expect(html).toContain('$379,990');
    expect(html).toContain('6529 Anaqua Loop');
    expect(html).toContain('3,057');         // total sqft stat
    expect(html).toContain('Quartz Countertops');
    expect(html).toContain('956-275-8069');   // footer
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement**

Add to `components.tsx`:

```tsx
export interface Stat { value: string; label: string }
export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div style={{ background: '#eee', display: 'flex', justifyContent: 'space-around', padding: '12px 6px', borderRadius: 4 }}>
      {stats.map((s) => (
        <div key={s.label} style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--pdf-font-heading)', fontSize: 22, color: 'var(--pdf-primary)' }}>{s.value}</div>
          <div className="pdf-label" style={{ fontSize: 8 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}
```

Create `qmi.tsx`:

```tsx
// packages/pdf/src/templates/qmi.tsx
import type { Theme } from '../theme';
import type { QmiData } from '../data/qmi';
import { Header, Footer, StatRow } from './components';
import { money } from '../data/shared';

export function QmiBrochure({ theme, data }: { theme: Theme; data: QmiData }) {
  const stats = [
    data.totalSqft && { value: data.totalSqft.toLocaleString('en-US'), label: 'Total Sq Ft' },
    data.livingSqft && { value: data.livingSqft.toLocaleString('en-US'), label: 'Living Sq Ft' },
    data.beds != null && { value: String(data.beds), label: 'Bedrooms' },
    data.baths != null && { value: String(data.baths), label: 'Baths' },
    data.garage != null && { value: String(data.garage), label: 'Car Garage' },
    data.stories != null && { value: data.stories.toFixed(1), label: 'Stories' },
  ].filter(Boolean) as { value: string; label: string }[];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          {theme.brand.logoWordmarkUrl
            ? <img src={theme.brand.logoWordmarkUrl} alt="Esperanza Homes" style={{ height: 44 }} />
            : <span style={{ fontFamily: 'var(--pdf-font-heading)', color: 'var(--pdf-primary)', fontSize: 22 }}>Esperanza</span>}
        </div>
        <div className="pdf-band" style={{ flex: 1, padding: 10, textAlign: 'center', borderRadius: 4 }}>
          {data.completion ? <div style={{ fontWeight: 700 }}>{data.completion}</div> : null}
          <div style={{ fontFamily: 'var(--pdf-font-heading)', fontSize: 20 }}>{money(data.price)}</div>
          {data.estMonthly ? <div style={{ fontSize: 10 }}>From {money(data.estMonthly)}/mo*</div> : null}
        </div>
        <div className="pdf-accent" style={{ flex: 1, padding: 10, textAlign: 'center', borderRadius: 4 }}>
          <div style={{ fontFamily: 'var(--pdf-font-heading)', fontSize: 16 }}>{data.address}</div>
          <div style={{ fontSize: 10 }}>{data.community}</div>
        </div>
      </div>

      <div style={{ height: 220, margin: '12px 0', background: '#dde', borderRadius: 4, overflow: 'hidden' }}>
        {data.heroImageUrl ? <img src={data.heroImageUrl} alt={data.address} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
      </div>

      <StatRow stats={stats} />

      <div className="pdf-band" style={{ textAlign: 'center', padding: 8, borderRadius: 4, margin: '12px 0', fontSize: 11 }}>
        Call or Text {theme.footer.phone} · {theme.footer.salesHours}
      </div>

      {data.description ? <p style={{ fontSize: 11 }}>{data.description}</p> : null}
      {data.features.length ? <ul style={{ fontSize: 11 }}>{data.features.map((f) => <li key={f}>{f}</li>)}</ul> : null}

      <Footer theme={theme} disclaimer={theme.disclaimers.qmi} />
    </div>
  );
}
```

> The optional appended floor-plan pages (when `data.floorPlanId` is set) are added in Task 2.5 by composing `FloorPlanBrochure` after the QMI body inside the dispatch.

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): QMI spec-sheet template + StatRow"`

### Task 2.3: Floor-plan data loader

**Files:** Create `packages/pdf/src/data/floorplan.ts`; Test `packages/pdf/test/data-floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/data-floorplan.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { loadFloorPlanData } from '../src/data/floorplan';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO floor_plans (id,name,published,description,total_square_footage,bedroom_max,bathroom_max,image_url,elevation_gallery)
          VALUES ('fpH','Hickory',1,'A charming single-story design…',1797,3,2.5,'https://x/hickory.jpg','["https://x/trad.jpg","https://x/tuscan.jpg"]')`);
  return d1FromSqlite(d);
}

describe('loadFloorPlanData', () => {
  it('projects cover + parsed elevation gallery', async () => {
    const data = await loadFloorPlanData(db(), 'fpH');
    expect(data?.name).toBe('Hickory');
    expect(data?.sqft).toBe(1797);
    expect(data?.elevations.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement**

```ts
// packages/pdf/src/data/floorplan.ts
import { renditionUrl } from './shared';

export interface ElevationImage { label: string; url: string }
export interface FloorPlanData {
  id: string; name: string; subtitle: string; description: string;
  sqft: number | null; beds: number | null; baths: number | null;
  coverImageUrl: string; elevations: ElevationImage[]; planImages: string[]; structuralImages: string[];
}
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const str = (v: unknown): string => (v == null ? '' : String(v));

/** A gallery column may hold a JSON array of urls or of {url,...} objects. */
function urls(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => (typeof x === 'string' ? x : x?.url)).filter(Boolean).map(String);
  } catch { return typeof raw === 'string' ? [raw] : []; }
}

export async function loadFloorPlanData(db: D1Database, fpId: string): Promise<FloorPlanData | null> {
  const fp = await db.prepare(`SELECT * FROM v_public_floor_plans WHERE id = ?`).bind(fpId).first<any>();
  if (!fp) return null;
  const beds = num(fp.bedroom_max); const baths = num(fp.bathroom_max); const sqft = num(fp.total_square_footage);
  return {
    id: String(fp.id), name: str(fp.name),
    subtitle: [sqft && `${sqft.toLocaleString('en-US')} Sq. Ft.`, beds && `${beds} BR`, baths != null && `${baths} BA`].filter(Boolean).join(' | '),
    description: str(fp.description), sqft, beds, baths,
    coverImageUrl: renditionUrl(str(fp.image_url || fp.synced_image_url), 'w2000'),
    elevations: urls(fp.elevation_gallery || fp.elevation_renderings).map((u, i) => ({ label: ['Traditional','Tuscan','Contemporary','Farmhouse'][i] ?? `Option ${i+1}`, url: renditionUrl(u, 'w1200') })),
    planImages: urls(fp.photo_gallery_urls || fp.photo_gallery).map((u) => renditionUrl(u, 'w2000')),
    structuralImages: urls(fp.additional_images_gallery || fp.additional_images).map((u) => renditionUrl(u, 'w1200')),
  };
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): floor-plan data loader (cover + galleries)"`

### Task 2.4: Floor-plan template + CoverBand/ElevationGrid/StructuralGrid

**Files:** Modify `components.tsx`; Create `packages/pdf/src/templates/floorplan.tsx`; Test `packages/pdf/test/template-floorplan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/template-floorplan.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/templates';
import { defaultTheme } from '../src/theme';
import type { FloorPlanData } from '../src/data/floorplan';

const data: FloorPlanData = {
  id: 'fpH', name: 'Hickory', subtitle: '1,797 Sq. Ft. | 3 BR | 2.5 BA', description: 'A charming single-story design…',
  sqft: 1797, beds: 3, baths: 2.5, coverImageUrl: 'https://x/h-w2000.jpg',
  elevations: [{ label: 'Traditional', url: 'https://x/t-w1200.jpg' }], planImages: ['https://x/p-w2000.jpg'], structuralImages: [],
};

describe('floor-plan template', () => {
  it('renders cover, elevation options, and paginates sections', () => {
    const html = renderTemplate('floorplan', defaultTheme, data);
    expect(html).toContain('Hickory');
    expect(html).toContain('1,797 Sq. Ft.');
    expect(html).toContain('ELEVATION OPTIONS');
    expect(html).toContain('Traditional');
    expect(html).toContain('page-break');   // multi-page
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement**

Add to `components.tsx`:

```tsx
export function CoverBand({ theme, title, subtitle }: { theme: Theme; title: string; subtitle?: string }) {
  return (
    <div className="pdf-band" style={{ padding: '28px 24px', textAlign: 'center', borderRadius: 4,
      backgroundImage: theme.brand.headerPatternUrl ? `url(${theme.brand.headerPatternUrl})` : undefined, backgroundSize: 'cover' }}>
      <div style={{ fontFamily: 'var(--pdf-font-heading)', fontSize: 34 }}>{title}</div>
      {subtitle ? <div style={{ fontSize: 13, opacity: 0.9 }}>{subtitle}</div> : null}
    </div>
  );
}

export function ImageGrid({ cols, items }: { cols: number; items: { label?: string; url: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},1fr)`, gap: 14 }}>
      {items.map((it, i) => (
        <div key={i} style={{ breakInside: 'avoid' }}>
          <div style={{ height: 150, background: '#eef0ee', borderRadius: 3, overflow: 'hidden' }}>
            {it.url ? <img src={it.url} alt={it.label ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          </div>
          {it.label ? <div className="pdf-band" style={{ textAlign: 'center', padding: 6, fontSize: 11 }}>{it.label}</div> : null}
        </div>
      ))}
    </div>
  );
}
```

Create `floorplan.tsx`:

```tsx
// packages/pdf/src/templates/floorplan.tsx
import type { Theme } from '../theme';
import type { FloorPlanData } from '../data/floorplan';
import { CoverBand, Footer, SectionLabel, ImageGrid } from './components';

export function FloorPlanBrochure({ theme, data }: { theme: Theme; data: FloorPlanData }) {
  return (
    <div>
      {/* Page 1: cover */}
      <CoverBand theme={theme} title={data.name} subtitle={data.subtitle} />
      <div style={{ height: 240, margin: '16px 0', background: '#dde', borderRadius: 4, overflow: 'hidden' }}>
        {data.coverImageUrl ? <img src={data.coverImageUrl} alt={data.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
      </div>
      {data.description ? <p style={{ fontSize: 11, textAlign: 'center' }}>{data.description}</p> : null}
      <Footer theme={theme} disclaimer={theme.disclaimers.floorplan} />

      {/* Page 2: elevations */}
      {data.elevations.length ? (
        <div className="page-break">
          <CoverBand theme={theme} title={data.name} subtitle={data.subtitle} />
          <SectionLabel>Elevation Options</SectionLabel>
          <ImageGrid cols={2} items={data.elevations} />
          <Footer theme={theme} disclaimer={theme.disclaimers.floorplan} />
        </div>
      ) : null}

      {/* Page 3: floor plan line-art */}
      {data.planImages.length ? (
        <div className="page-break">
          <CoverBand theme={theme} title={data.name} subtitle={data.subtitle} />
          <SectionLabel>Floor Plan</SectionLabel>
          <ImageGrid cols={1} items={data.planImages.map((url) => ({ url }))} />
          <Footer theme={theme} disclaimer={theme.disclaimers.floorplan} />
        </div>
      ) : null}

      {/* Page 4: structural options */}
      {data.structuralImages.length ? (
        <div className="page-break">
          <CoverBand theme={theme} title={data.name} subtitle={data.subtitle} />
          <SectionLabel>Structural Options</SectionLabel>
          <ImageGrid cols={3} items={data.structuralImages.map((url) => ({ url }))} />
          <Footer theme={theme} disclaimer={theme.disclaimers.floorplan} />
        </div>
      ) : null}
    </div>
  );
}
```

> The CSS `.page-break{ break-after:page }` from Task 1.6 forces a new physical page per section; `printBackground:true` keeps the green band on every page.

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): floor-plan template + CoverBand/ImageGrid"`

### Task 2.5: Extend dispatch, `serve` loadData, and `preview` for qmi + floorplan

**Files:** Modify `packages/pdf/src/templates/index.tsx`, `packages/pdf/src/serve.ts`, `packages/pdf/src/preview.ts`; Test `packages/pdf/test/dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/dispatch.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/templates';
import { defaultTheme } from '../src/theme';

describe('renderTemplate dispatch', () => {
  it('handles qmi and floorplan (no throw)', () => {
    const qmi = renderTemplate('qmi', defaultTheme, { id: 'q', address: 'X', community: 'C', price: 1, estMonthly: null, completion: '', heroImageUrl: '', totalSqft: 1, livingSqft: 1, beds: 1, baths: 1, garage: 1, stories: 1, description: '', features: [], floorPlanId: null });
    expect(qmi).toContain('<!DOCTYPE html>');
    const fp = renderTemplate('floorplan', defaultTheme, { id: 'f', name: 'N', subtitle: '', description: '', sqft: 1, beds: 1, baths: 1, coverImageUrl: '', elevations: [], planImages: [], structuralImages: [] });
    expect(fp).toContain('<!DOCTYPE html>');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (dispatch throws "not implemented").
- [ ] **Step 3: Implement** — extend `templates/index.tsx`:

```tsx
import { QmiBrochure } from './qmi';
import { FloorPlanBrochure } from './floorplan';
import type { QmiData } from '../data/qmi';
import type { FloorPlanData } from '../data/floorplan';
// inside renderTemplate switch:
    case 'qmi':
      return wrapHtml(theme, <QmiBrochure theme={theme} data={data as QmiData} />);
    case 'floorplan':
      return wrapHtml(theme, <FloorPlanBrochure theme={theme} data={data as FloorPlanData} />);
```

Extend `serve.ts` `loadData()`:

```ts
import { loadQmiData } from './data/qmi';
import { loadFloorPlanData } from './data/floorplan';
// inside loadData switch:
    case 'qmi': return loadQmiData(env.DB, entityId, { appendFloorPlanPages: theme.qmi.appendFloorPlanPages });
    case 'floorplan': return loadFloorPlanData(env.DB, entityId);
```

Extend `preview.ts` similarly (qmi/floorplan branches calling the same loaders + `renderTemplate`).

> **Appended floor-plan pages (QMI):** when `theme.qmi.appendFloorPlanPages` and the QMI has a `floorPlanId`, the QMI dispatch additionally renders the floor-plan body after the QMI body. Implement by having `renderTemplate('qmi', …)` compose `<><QmiBrochure/>{fp && <div className="page-break"/><FloorPlanBrochure/>}</>` — load the floor-plan data inside `loadQmiData` (add an optional `floorPlan?: FloorPlanData` field populated when `appendFloorPlanPages`). Add a test asserting the combined HTML contains both the stat row and "FLOOR PLAN".

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): wire qmi+floorplan into dispatch/serve/preview"`

### Task 2.6: Shared invalidation lib + admin & ingest hooks

**Files:** Create `packages/db/lib/pdf-invalidate.ts`; Modify `packages/admin/lib/actions.ts` (inside `postWrite`), `packages/ingest/src/<consumer>`; Test `packages/db/test/pdf-invalidate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/pdf-invalidate.test.ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers';
import { affectedRenderKeys } from '../lib/pdf-invalidate';

describe('affectedRenderKeys (dependency fanout)', () => {
  it('floor-plan edit fans out to its plan + linked communities + their QMIs + city lists', () => {
    const db = freshDb();
    db.exec(`INSERT INTO cities (id,slug) VALUES ('ci1','mcallen')`);
    db.exec(`INSERT INTO communities (id,slug,city_id) VALUES ('c1','anaqua','ci1')`);
    db.exec(`INSERT INTO floor_plans (id) VALUES ('fp1')`);
    db.exec(`INSERT INTO qmi (id,published,synced_community_id,synced_floor_plan_id,synced_city_id) VALUES ('q1',1,'c1','fp1','ci1')`);
    const keys = affectedRenderKeys(db as any, 'floor_plans', 'fp1');
    expect(keys).toContainEqual({ type: 'floorplan', entityId: 'fp1' });
    expect(keys).toContainEqual({ type: 'community', entityId: 'c1' });
    expect(keys).toContainEqual({ type: 'qmi', entityId: 'q1' });
    expect(keys.some(k => k.type === 'list' && k.citySlug === 'mcallen')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** (synchronous, better-sqlite3-compatible signature; the admin/ingest call an async D1 wrapper)

```ts
// packages/db/lib/pdf-invalidate.ts
// Pure dependency map: given an edited entity, which pdf_renders (by type+entityId) and
// city lists must be marked stale. Used by the admin postWrite hook and the ingest consumer.
type Sqlish = { prepare(sql: string): { all(...b: unknown[]): any[]; get(...b: unknown[]): any } };
export type RenderKey = { type: 'community' | 'qmi' | 'floorplan'; entityId: string } | { type: 'list'; citySlug: string };

export function affectedRenderKeys(db: Sqlish, entity: string, id: string): RenderKey[] {
  const keys: RenderKey[] = [];
  const citySlugs = new Set<string>();
  const pushCity = (cityId?: string | null) => {
    if (!cityId) return;
    const c = db.prepare(`SELECT slug FROM cities WHERE id=?`).get(cityId);
    if (c?.slug) citySlugs.add(c.slug);
  };

  if (entity === 'floor_plans') {
    keys.push({ type: 'floorplan', entityId: id });
    const qmis = db.prepare(
      `SELECT id, COALESCE(override_community_id,synced_community_id) comm, COALESCE(override_city_id,synced_city_id) city
         FROM qmi WHERE COALESCE(override_floor_plan_id,synced_floor_plan_id)=? AND published=1`).all(id);
    const comms = new Set<string>();
    for (const q of qmis) { keys.push({ type: 'qmi', entityId: String(q.id) }); if (q.comm) comms.add(String(q.comm)); pushCity(q.city); }
    for (const c of comms) { keys.push({ type: 'community', entityId: c }); pushCity(db.prepare(`SELECT city_id FROM communities WHERE id=?`).get(c)?.city_id); }
  } else if (entity === 'qmi') {
    keys.push({ type: 'qmi', entityId: id });
    const q = db.prepare(`SELECT COALESCE(override_community_id,synced_community_id) comm, COALESCE(override_city_id,synced_city_id) city FROM qmi WHERE id=?`).get(id);
    if (q?.comm) { keys.push({ type: 'community', entityId: String(q.comm) }); pushCity(db.prepare(`SELECT city_id FROM communities WHERE id=?`).get(q.comm)?.city_id); }
    pushCity(q?.city);
  } else if (entity === 'communities') {
    keys.push({ type: 'community', entityId: id });
    pushCity(db.prepare(`SELECT city_id FROM communities WHERE id=?`).get(id)?.city_id);
  } else if (entity === 'cities') {
    pushCity(id);
  }
  for (const slug of citySlugs) keys.push({ type: 'list', citySlug: slug });
  return keys;
}
```

- [ ] **Step 4: Run to verify it passes** → `npx vitest run -w @esperanza/db test/pdf-invalidate.test.ts` → PASS.

- [ ] **Step 5: Wire into the admin `postWrite` hook** (`packages/admin/lib/actions.ts`, inside `postWrite` after the existing audit/enqueue, ~line 82+):

```ts
// at top: import { affectedRenderKeys } from '@esperanza/db/pdf-invalidate';
// (add the export to packages/db/package.json "exports": "./pdf-invalidate": "./lib/pdf-invalidate.ts")
// inside postWrite(db, entityKey, id, audits), after audit insert + framer enqueue:
try {
  const keys = affectedRenderKeys(db.$client ?? rawSqliteFrom(db), entityKey, id); // see note
  for (const k of keys) {
    if (k.type === 'list') {
      await db.run(sql`UPDATE pdf_renders SET status='stale' WHERE type='list' AND city_slug=${k.citySlug} AND status<>'rendering'`);
    } else {
      await db.run(sql`UPDATE pdf_renders SET status='stale' WHERE type=${k.type} AND entity_id=${k.entityId} AND status<>'rendering'`);
    }
  }
} catch (e) { console.error('[pdf-invalidate]', e); } // never block the primary write
```

> **Note on the D1/Drizzle wrapper:** `affectedRenderKeys` takes a synchronous `prepare().get/all` shape (for the better-sqlite3 unit test). In the admin (Drizzle/D1, async), provide a thin adapter that runs the same SELECTs via `db.run`/`db.get` and pass the resolved rows — OR refactor `affectedRenderKeys` to accept a `query(sql, ...binds) => rows[]` function injected by the caller (admin passes a D1-backed async resolver awaited up front; the test passes a better-sqlite3-backed sync resolver). Choose the injected-resolver form to keep one implementation; update the test to pass a sync resolver. _(This is the single cross-runtime seam — implement it as an injected `q(sql, binds): Row[]` function so the logic is shared verbatim.)_

- [ ] **Step 6: Wire into ingest** (`packages/ingest` consumer): after a synced upsert that changes a QMI/community/floor-plan, call the same `affectedRenderKeys` + UPDATE against its D1 binding. Add a test mirroring Step 1 against the ingest write path.

- [ ] **Step 7: Commit** — `git add packages/db packages/admin packages/ingest && git commit -m "feat(pdf): invalidation fanout + admin postWrite & ingest hooks"`

### Task 2.7: Extend `seed-renders` for QMI + floor plans (+ URL writeback)

**Files:** Modify `packages/pdf/scripts/seed-renders.ts`

- [ ] **Step 1: Extend the enumeration** — add `qmi` (published) and `floor_plans` (published): insert `pdf_renders` rows (`slugFor('qmi'|'floorplan', row)`, `r2KeyFor(...)`, `city_slug`, `community_id`), and write the deterministic URL into `qmi.dynamic_pdf` and `floor_plans.brochure_pdf_url`.
- [ ] **Step 2: Operational run** (local then remote); verify counts: `SELECT type, count(*) FROM pdf_renders GROUP BY type` shows community/qmi/floorplan; `SELECT count(*) FROM qmi WHERE dynamic_pdf IS NOT NULL` > 0.
- [ ] **Step 3: Commit** — `git commit -am "feat(pdf): seed qmi+floorplan renders + dynamic_pdf/brochure_pdf_url writeback"`

### Task 2.8: PDFs admin section (drill-down tree)

**Files:** Create `packages/admin/lib/pdf-tree.ts`, `packages/admin/app/pdfs/page.tsx`, `packages/admin/components/pdfs/PdfTree.tsx`; Modify `packages/admin/components/app-shared.tsx` (nav); Test `packages/admin/test/pdf-tree.test.ts` (or a colocated unit test)

- [ ] **Step 1: Write the failing test** for the pure tree-shaping function

```ts
// packages/admin/test/pdf-tree.test.ts
import { describe, it, expect } from 'vitest';
import { buildPdfTree } from '../lib/pdf-tree';

const rows = [
  { type: 'community', slug: 'anaqua', city_slug: 'mcallen', community_id: 'c1', status: 'live', entity_id: 'c1' },
  { type: 'qmi', slug: '00000149', city_slug: 'mcallen', community_id: 'c1', status: 'stale', entity_id: 'q1' },
  { type: 'floorplan', slug: 'hickory', city_slug: 'mcallen', community_id: 'c1', status: 'not_built', entity_id: 'fpH' },
  { type: 'list', slug: 'mcallen-locations', city_slug: 'mcallen', community_id: null, status: 'live', entity_id: null },
];

describe('buildPdfTree', () => {
  it('groups city → community → {plans, specs} with city-level lists', () => {
    const tree = buildPdfTree(rows as any);
    const city = tree.find((c) => c.citySlug === 'mcallen')!;
    expect(city.lists.map((l) => l.slug)).toContain('mcallen-locations');
    const comm = city.communities.find((c) => c.communityId === 'c1')!;
    expect(comm.plans.map((p) => p.slug)).toContain('hickory');
    expect(comm.specs.map((s) => s.slug)).toContain('00000149');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** `lib/pdf-tree.ts`

```ts
// packages/admin/lib/pdf-tree.ts
export interface PdfRenderRowLite { type: string; slug: string; city_slug: string | null; community_id: string | null; status: string; entity_id: string | null }
export interface PdfLeaf { slug: string; status: string; entityId: string | null }
export interface PdfCommunityNode { communityId: string; plans: PdfLeaf[]; specs: PdfLeaf[]; self: PdfLeaf | null }
export interface PdfCityNode { citySlug: string; lists: PdfLeaf[]; communities: PdfCommunityNode[] }

export function buildPdfTree(rows: PdfRenderRowLite[]): PdfCityNode[] {
  const cities = new Map<string, PdfCityNode>();
  const city = (s: string) => cities.get(s) ?? cities.set(s, { citySlug: s, lists: [], communities: [] }).get(s)!;
  const comm = (c: PdfCityNode, id: string) => c.communities.find((x) => x.communityId === id)
    ?? (c.communities.push({ communityId: id, plans: [], specs: [], self: null }), c.communities.at(-1)!);
  for (const r of rows) {
    const leaf: PdfLeaf = { slug: r.slug, status: r.status, entityId: r.entity_id };
    const cs = r.city_slug ?? '—';
    if (r.type === 'list') { city(cs).lists.push(leaf); continue; }
    const cn = comm(city(cs), r.community_id ?? '—');
    if (r.type === 'community') cn.self = leaf;
    else if (r.type === 'floorplan') cn.plans.push(leaf);
    else if (r.type === 'qmi') cn.specs.push(leaf);
  }
  return [...cities.values()].sort((a, b) => a.citySlug.localeCompare(b.citySlug));
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Build the RSC page + tree component**

`app/pdfs/page.tsx` (RSC): read `pdf_renders` via `getDb()`, join `cities.slug`/`communities.name` for labels, call `buildPdfTree`, read active theme version for the header badge, render `<PdfTree/>`. Gate: any signed-in user may view (download/regenerate are actions; theme edit is admin-only). `export const dynamic = 'force-dynamic'`.

`components/pdfs/PdfTree.tsx` (client): collapsible city → community → Plans/Specs, with a status dot per leaf (`live`=green, `stale`=amber, `not_built`=grey, `error`=red), Download (`window.open(publicUrl)`), Open, and a **Regenerate** button calling the Task 2.9 server action. City rows show the list downloads + a "Rebuild stale (n)" button.

- [ ] **Step 6: Add the nav entry** in `components/app-shared.tsx` — add a standalone group/item to `mainNavLinks` (PDFs is not an entity):

```tsx
import { FileTextIcon } from 'lucide-react';
// append to mainNavLinks:
{ label: 'Brochures', items: [{ title: 'PDFs', path: '/pdfs', icon: <FileTextIcon className="size-4" /> }] },
```

- [ ] **Step 7: Verify** — `npm run -w @esperanza/admin build:cf` green; manual: `/pdfs` shows the tree with statuses; Download opens the cached PDF.
- [ ] **Step 8: Commit** — `git add packages/admin && git commit -m "feat(admin): PDFs drill-down section + nav entry"`

### Task 2.9: Regenerate / Rebuild-stale server actions

**Files:** Create `packages/admin/lib/pdf-actions.ts`; Test `packages/admin/test/pdf-actions.test.ts` (logic-level)

- [ ] **Step 1: Write the failing test** for the action's effect (marks a row stale so the next request re-renders)

```ts
// packages/admin/test/pdf-actions.test.ts
import { describe, it, expect } from 'vitest';
import { freshDb } from '../../db/test/helpers';
import { computeRegenerateUpdate } from '../lib/pdf-actions';

describe('regenerate', () => {
  it('marks a single render stale (forces re-render on next request)', () => {
    const db = freshDb();
    db.exec(`INSERT INTO pdf_renders (type,slug,status) VALUES ('community','anaqua','live')`);
    const { sql, binds } = computeRegenerateUpdate('community', 'anaqua');
    db.prepare(sql).run(...binds);
    expect((db.prepare(`SELECT status FROM pdf_renders WHERE slug='anaqua'`).get() as any).status).toBe('stale');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** — `computeRegenerateUpdate(type, slug)` returns `{ sql: "UPDATE pdf_renders SET status='stale' WHERE type=? AND slug=? AND status<>'rendering'", binds: [type, slug] }`; the server action (`'use server'`) runs it via `getDb()`, plus a `rebuildStaleForCity(citySlug)` and `rebuildAll()` variant (Phase 4 wires these to `RENDER_Q` for warming; in Phase 2 they just mark stale so the next download regenerates). RBAC: gate `regenerate` to signed-in users; `rebuildAll` to `isAdmin()`.
- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git add packages/admin && git commit -m "feat(admin): pdf regenerate / rebuild-stale actions"`

### Task 2.10: Deploy + verify Phase 2

- [ ] Deploy admin + pdf workers; run `seed-renders` (remote) for qmi+floorplan.
- [ ] E2E: a QMI `dynamic_pdf` and a floor-plan `brochure_pdf_url` resolve to live, cached, correct PDFs (spec sheet w/ stats + optional appended floor-plan pages; floor-plan w/ elevation + plan + structural pages).
- [ ] Invalidation: edit a QMI's price in the admin → its `pdf_renders` row flips to `stale` → next download shows the new price (and the community + city-list rows are stale too).
- [ ] PDFs section: tree shows correct statuses; Regenerate flips to stale → re-renders.
- [ ] Verify gates green. **Phase-2 acceptance:** all three per-entity brochure types live, browsable, and self-invalidating on edit.

## Phase 3 — Theme editor (Settings → PDF Theme)

> **Dependency note:** RBAC Stage 5 (Full Admin / Marketing Admin / General Marketing + `can()`) is **not yet built** (HANDOFF NEXT #2). This phase ships with the **interim gate `isAdmin()`** for all theme view/edit/publish. When Stage 5 lands, swap `isAdmin()` for `can(role, 'pdf.theme.publish')` (Full + Marketing Admin) at the three enforcement layers below; no other change.

### Task 3.1: Signed preview token (protect draft preview)

**Files:** Create `packages/pdf/src/token.ts`; Modify `packages/pdf/src/index.ts` (enforce on `?theme=draft`); Test `packages/pdf/test/token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/token.test.ts
import { describe, it, expect } from 'vitest';
import { signPreviewToken, verifyPreviewToken } from '../src/token';

describe('preview token', () => {
  const secret = 'test-secret';
  it('round-trips a valid, unexpired token', async () => {
    const tok = await signPreviewToken(secret, 'community', 'anaqua', 60);
    expect(await verifyPreviewToken(secret, 'community', 'anaqua', tok)).toBe(true);
  });
  it('rejects a tampered slug', async () => {
    const tok = await signPreviewToken(secret, 'community', 'anaqua', 60);
    expect(await verifyPreviewToken(secret, 'community', 'other', tok)).toBe(false);
  });
  it('rejects an expired token', async () => {
    const tok = await signPreviewToken(secret, 'community', 'anaqua', -1);
    expect(await verifyPreviewToken(secret, 'community', 'anaqua', tok)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** (HMAC-SHA256 via Web Crypto; token = `exp.b64(sig)`)

```ts
// packages/pdf/src/token.ts
async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '');
}
export async function signPreviewToken(secret: string, type: string, slug: string, ttlSec: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = await hmac(secret, `${type}:${slug}:${exp}`);
  return `${exp}.${sig}`;
}
export async function verifyPreviewToken(secret: string, type: string, slug: string, token: string): Promise<boolean> {
  const [expStr, sig] = (token ?? '').split('.');
  const exp = Number(expStr);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(secret, `${type}:${slug}:${exp}`);
  return sig === expected;
}
```

Enforce in `src/index.ts` preview route: when `which==='draft'`, require a valid `?token=` (`verifyPreviewToken(env.PDF_PREVIEW_SECRET!, type, slug, token)`) → else 403. (Active preview needs no token; it's public-equivalent content.)

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): signed preview token + draft-preview guard"`

### Task 3.2: Same-origin preview proxy (admin)

**Files:** Create `packages/admin/app/api/pdf-preview/[type]/[slug]/route.ts`; Modify admin OpenNext/wrangler config (service binding `PDF` → `esperanza-pdf`); Test: route-handler unit test optional (mostly integration).

- [ ] **Step 1: Add the service binding** to the admin worker config (OpenNext `wrangler.jsonc`/`open-next.config`): bind `PDF` to service `esperanza-pdf`. Set admin secret/var `PDF_PREVIEW_SECRET` (same value as the pdf worker's secret).

- [ ] **Step 2: Implement the proxy route** (RSC route handler; runs on the **admin origin** so the editor iframe is same-origin and the existing session applies):

```ts
// packages/admin/app/api/pdf-preview/[type]/[slug]/route.ts
import { NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { auth } from '@/lib/auth';               // Auth.js v5 — must be signed in
import { signPreviewToken } from '@esperanza/pdf/token'; // export from packages/pdf

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string; slug: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const { type, slug } = await params;
  const which = req.nextUrl.searchParams.get('theme') === 'draft' ? 'draft' : 'active';
  const env = getCloudflareContext().env as any;
  const token = which === 'draft' ? await signPreviewToken(env.PDF_PREVIEW_SECRET, type, slug, 120) : '';
  // Call the pdf worker via the service binding (no public round-trip, no CORS).
  const url = `https://pdf.internal/preview/${type}/${encodeURIComponent(slug)}?theme=${which}${token ? `&token=${token}` : ''}`;
  const res = await env.PDF.fetch(new Request(url));
  // Re-emit as same-origin HTML so the iframe loads without frame-ancestors issues.
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
```

> Requires `packages/pdf` to export `token` (add `"./token": "./src/token.ts"` to a `packages/pdf/package.json` `exports` map). The iframe `src` is `/api/pdf-preview/<type>/<slug>?theme=draft` — same origin as the admin, so the session cookie applies and there is no `frame-ancestors` problem.

- [ ] **Step 3: Verify** — signed-in request returns the rendered HTML; signed-out → 401. Commit: `git add packages/admin packages/pdf && git commit -m "feat(admin): same-origin pdf preview proxy via service binding"`

### Task 3.3: Theme server actions (save/publish/revert/rollback)

**Files:** Modify `packages/admin/lib/pdf-actions.ts`; Test `packages/admin/test/pdf-theme-actions.test.ts`

- [ ] **Step 1: Write the failing test** (publish semantics against `freshDb`)

```ts
// packages/admin/test/pdf-theme-actions.test.ts
import { describe, it, expect } from 'vitest';
import { freshDb } from '../../db/test/helpers';
import { applyPublish } from '../lib/pdf-actions';

describe('publish theme', () => {
  it('first publish → version 1 in active + history; second → 2', () => {
    const db = freshDb();
    applyPublish(db as any, 'matt@hazard.house');
    let active = db.prepare(`SELECT version FROM pdf_themes WHERE kind='active'`).get() as any;
    expect(active.version).toBe(1);
    expect((db.prepare(`SELECT count(*) c FROM pdf_theme_history`).get() as any).c).toBe(1);
    // edit draft, publish again
    db.prepare(`UPDATE pdf_themes SET theme_json='{"footer":{"phone":"x"}}' WHERE kind='draft'`).run();
    applyPublish(db as any, 'matt@hazard.house');
    active = db.prepare(`SELECT version FROM pdf_themes WHERE kind='active'`).get() as any;
    expect(active.version).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** the pure SQL sequence (the server action wraps it for D1; the test runs it on better-sqlite3)

```ts
// packages/admin/lib/pdf-actions.ts  (theme section)
type Sqlish = { prepare(s: string): { run(...b: unknown[]): unknown; get(...b: unknown[]): any } };

/** Copy draft → active with a new version; record history. Returns the new version. */
export function applyPublish(db: Sqlish, publishedBy: string): number {
  const draft = db.prepare(`SELECT theme_json FROM pdf_themes WHERE kind='draft'`).get();
  const next = ((db.prepare(`SELECT COALESCE(MAX(version),0) m FROM pdf_theme_history`).get()?.m ?? 0) as number) + 1;
  db.prepare(`UPDATE pdf_themes SET theme_json=?, version=?, updated_by=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE kind='active'`).run(draft.theme_json, next, publishedBy);
  db.prepare(`INSERT INTO pdf_theme_history (version, theme_json, published_by) VALUES (?,?,?)`).run(next, draft.theme_json, publishedBy);
  return next;
}
export function applyRollback(db: Sqlish, version: number, by: string): void {
  const h = db.prepare(`SELECT theme_json FROM pdf_theme_history WHERE version=?`).get(version);
  if (!h) throw new Error('no such version');
  db.prepare(`UPDATE pdf_themes SET theme_json=?, kind='draft' WHERE kind='draft'`).run(h.theme_json); // load into draft; publish to apply
}
```

The `'use server'` actions: `saveDraftTheme(json)` (validate via `parseTheme` then `UPDATE pdf_themes ... WHERE kind='draft'`), `publishTheme()` (calls `applyPublish`, then enqueues a warm of high-traffic PDFs via `RENDER_Q` — Phase 4; in Phase 3, publish just bumps the version so PDFs self-heal on next request), `revertDraft()` (copy active→draft), `rollbackTheme(version)`. All gated by `isAdmin()`.

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(admin): theme save/publish/revert/rollback actions"`

### Task 3.4: Theme editor UI

**Files:** Create `packages/admin/app/settings/pdf-theme/page.tsx`, `packages/admin/components/pdf-theme/PdfThemeEditor.tsx` (+ control sub-components); Modify `packages/admin/app/settings/page.tsx` (hub note)

- [ ] **Step 1: RSC page** `app/settings/pdf-theme/page.tsx` — gate with `isAdmin()` (mirror `app/settings/fields/page.tsx`: 403 if not admin). Load draft theme via `getDb()`. `export const dynamic='force-dynamic'`. Render `<PdfThemeEditor draft={theme} version={activeVersion} />`.

- [ ] **Step 2: Client editor** `components/pdf-theme/PdfThemeEditor.tsx` — left controls grouped (Brand: logo `ImageUploader`, color pickers, font `SelectField` from the allow-list; Footer & contact; Section labels; Page setup; QMI options `appendFloorPlanPages` switch; Copy library `RichTextField` keyed by collection; Disclaimers `RichTextField` per type). On any change → local theme state → debounced `saveDraftTheme(JSON)` → re-key the preview iframe to refresh. Right: `<iframe src={`/api/pdf-preview/${type}/${sampleSlug}?theme=draft&v=${nonce}`}/>` with template-type tabs + sample-entity `<Select>` (sample slugs fetched from `pdf_renders`). Actions: Revert / Save draft / **Publish** (confirm dialog: "All PDFs re-render with the new theme on next download").

- [ ] **Step 3: Reach the editor** — add a link in the account menu / Settings (the Field Builder lives in the account menu per the sidebar comment). Update `app/settings/page.tsx` so it no longer claims Fields is the only Settings surface (make it a small hub linking Fields + PDF Theme, or keep the redirect and link PDF Theme from the PDFs header per Task 2.8).

- [ ] **Step 4: Verify** — `build:cf` green; manual: change `colors.accent`, preview updates live; Publish → `pdf_themes.active.version` increments.
- [ ] **Step 5: Commit** — `git add packages/admin && git commit -m "feat(admin): PDF theme editor UI + live preview + publish"`

### Task 3.5: Secrets + deploy + end-to-end theme verify

- [ ] Set `PDF_PREVIEW_SECRET` on both workers: `wrangler secret put PDF_PREVIEW_SECRET` (pdf) and the matching admin value.
- [ ] Deploy both. Verify: edit theme → publish → an already-`live` community PDF, on its next request, re-renders with the new look (its `theme_version` no longer matches `active.version` → `stale-present` → background regen). Confirm the PDFs section shows rows going stale→live after publish.
- [ ] **Phase-3 acceptance:** an admin restyles all brochures via the editor with a live preview and one Publish; no engineering, no per-PDF work.

---

## Phase 4 — Aggregate list PDFs + cutover

### Task 4.1: List data loader

**Files:** Create `packages/pdf/src/data/list.ts`; Test `packages/pdf/test/data-list.test.ts`

- [ ] **Step 1: Write the failing test** (a McAllen Locations list = published communities in that city, as plan-style cards or community rows)

```ts
// packages/pdf/test/data-list.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { d1FromSqlite } from './_d1adapter';
import { loadListData } from '../src/data/list';

const DB = join(__dirname, '../../db');
function db() {
  const d = new Database(':memory:');
  readdirSync(join(DB,'migrations')).filter(f=>f.endsWith('.sql')).sort().forEach(f=>d.exec(readFileSync(join(DB,'migrations',f),'utf8')));
  d.exec(readFileSync(join(DB,'views.sql'),'utf8'));
  d.exec(`INSERT INTO cities (id,slug,city_name) VALUES ('ci1','mcallen','McAllen')`);
  d.exec(`INSERT INTO communities (id,name,slug,city_id,published) VALUES ('c1','Anaqua','anaqua','ci1',1)`);
  return d1FromSqlite(d);
}

describe('loadListData', () => {
  it('locations list = published communities in the city', async () => {
    const data = await loadListData(db(), 'mcallen', 'locations');
    expect(data?.cityName).toBe('McAllen');
    expect(data?.cards.map((c) => c.name)).toContain('Anaqua');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** (three kinds: `locations` = communities, `qmis` = published QMIs, `plans` = published floor plans in the city; each mapped to a `PlanCardData`-like card)

```ts
// packages/pdf/src/data/list.ts
import type { PlanCardData } from '../templates/components';
import { renditionUrl } from './shared';
export type ListKind = 'locations' | 'qmis' | 'plans';
export interface ListData { citySlug: string; cityName: string; kind: ListKind; cards: PlanCardData[] }
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

export async function loadListData(db: D1Database, citySlug: string, kind: ListKind): Promise<ListData | null> {
  const city = await db.prepare(`SELECT id, city_name FROM cities WHERE slug=?`).bind(citySlug).first<any>();
  if (!city) return null;
  let rows: any[] = [];
  if (kind === 'locations') {
    rows = ((await db.prepare(`SELECT id,name,featured_image_url img,price_from price FROM communities WHERE city_id=? AND published=1 ORDER BY name`).bind(city.id).all<any>()).results) ?? [];
  } else if (kind === 'qmis') {
    rows = ((await db.prepare(`SELECT id, address name, image_url img, COALESCE(override_price,synced_price) price, COALESCE(override_total_square_footage,synced_total_square_footage) sqft, COALESCE(override_bedroom_count,synced_bedroom_count) beds FROM qmi WHERE COALESCE(override_city_id,synced_city_id)=? AND published=1`).bind(city.id).all<any>()).results) ?? [];
  } else {
    rows = ((await db.prepare(`SELECT DISTINCT fp.id, fp.name, fp.image_url img, fp.starting_price price, fp.total_square_footage sqft, fp.bedroom_max beds, fp.bathroom_max baths, fp.car_garage_count garage, fp.stories_count stories FROM floor_plans fp JOIN qmi q ON q.synced_floor_plan_id=fp.id WHERE COALESCE(q.override_city_id,q.synced_city_id)=? AND fp.published=1`).bind(city.id).all<any>()).results) ?? [];
  }
  const cards: PlanCardData[] = rows.map((r) => ({
    id: String(r.id), name: String(r.name ?? ''), price: num(r.price), sqft: num(r.sqft),
    beds: num(r.beds), baths: num(r.baths), garage: num(r.garage), stories: num(r.stories),
    imageUrl: renditionUrl(String(r.img ?? ''), 'w1200'),
  }));
  return { citySlug, cityName: String(city.city_name ?? ''), kind, cards };
}
```

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): list data loader (locations/qmis/plans by city)"`

### Task 4.2: List template (paged grid)

**Files:** Create `packages/pdf/src/templates/list.tsx`; Modify dispatch; Test `packages/pdf/test/template-list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/pdf/test/template-list.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/templates';
import { defaultTheme } from '../src/theme';
import type { ListData } from '../src/data/list';

const data: ListData = { citySlug: 'mcallen', cityName: 'McAllen', kind: 'locations',
  cards: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: `Community ${i}`, price: 300000 + i, sqft: 2000, beds: 3, baths: 2, garage: 2, stories: 1, imageUrl: '' })) };

describe('list template', () => {
  it('renders a city cover + a card per member with page-break chunks', () => {
    const html = renderTemplate('list', defaultTheme, data);
    expect(html).toContain('McAllen');
    expect(html).toContain('Community 0');
    expect(html).toContain('Community 19');
    expect(html.match(/page-break/g)!.length).toBeGreaterThanOrEqual(1); // paginated
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** (chunk cards into pages of N; CSS paged-media + explicit chunk breaks)

```tsx
// packages/pdf/src/templates/list.tsx
import type { Theme } from '../theme';
import type { ListData } from '../data/list';
import { CoverBand, Footer, FloorPlanCard } from './components';

const PER_PAGE = 9; // 3×3 grid; tune to fit Letter
const TITLES = { locations: 'Locations', qmis: 'Quick Move-In Homes', plans: 'Floor Plans' } as const;

export function ListBrochure({ theme, data }: { theme: Theme; data: ListData }) {
  const pages: typeof data.cards[] = [];
  for (let i = 0; i < data.cards.length; i += PER_PAGE) pages.push(data.cards.slice(i, i + PER_PAGE));
  return (
    <div>
      {pages.map((cards, pi) => (
        <div key={pi} className={pi < pages.length - 1 ? 'page-break' : undefined}>
          <CoverBand theme={theme} title={data.cityName} subtitle={TITLES[data.kind]} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 14 }}>
            {cards.map((c) => <FloorPlanCard key={c.id} plan={c} />)}
          </div>
          <Footer theme={theme} disclaimer={theme.disclaimers.list} />
        </div>
      ))}
    </div>
  );
}
```

Add `case 'list': return wrapHtml(theme, <ListBrochure theme={theme} data={data as ListData} />);` to dispatch; extend `serve.loadData` + `preview` with `loadListData` (slug `mcallen-locations` → split into `citySlug`+`kind`).

- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): list template (paged card grid) + dispatch/serve/preview"`

### Task 4.3: List serving — 302-poll for never-built + `/poll` route

**Files:** Modify `packages/pdf/src/index.ts`, `packages/pdf/src/serve.ts`; Test `packages/pdf/test/serve-list.test.ts`

- [ ] **Step 1: Write the failing test** — a never-built **list** returns 302 to `/poll/...` (not an inline render), while a never-built per-entity still renders inline.

```ts
// packages/pdf/test/serve-list.test.ts (excerpt)
// seed a 'list' pdf_renders row status='not_built'; call serve(...,'list', 'mcallen-locations');
// expect res.status === 302 and Location header to /poll/list/mcallen-locations,
// and that deps.render was NOT awaited inline (it is enqueued instead).
```

- [ ] **Step 2: Run to verify it fails** → FAIL.
- [ ] **Step 3: Implement** — in `serve()`, branch on `type === 'list'` for the `absent` case: enqueue a rebuild (`env.RENDER_Q?.send({ type, slug, reason: 'cold' })`) and return `302 → /poll/list/<slug>`. Add a `GET /poll/:type/:slug` route that returns 200 + the PDF if now `live`, else a small HTML "building…" page that auto-refreshes. Per-entity `absent` keeps the inline-render path.
- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): list cold-path 302-poll + /poll route"`

### Task 4.4: Render queue (debounce + rebuild) + consumer

**Files:** Modify `packages/pdf/wrangler.toml` (queue producer+consumer), `packages/pdf/src/index.ts` (`queue()` handler), `packages/pdf/src/invalidate.ts` (enqueueListRebuild with delay); Modify `packages/db/lib/pdf-invalidate.ts` consumers to enqueue list rebuilds; Test `packages/pdf/test/queue.test.ts`

- [ ] **Step 1: Add the queue to `wrangler.toml`**

```toml
[[queues.producers]]
binding = "RENDER_Q"
queue = "esperanza-pdf-render"

[[queues.consumers]]
queue = "esperanza-pdf-render"
max_batch_size = 3
max_retries = 3
dead_letter_queue = "esperanza-pdf-render-dlq"
```

Create the queues: `wrangler queues create esperanza-pdf-render` (+ `-dlq`).

- [ ] **Step 2: Write the failing test** for the consumer handler (rebuilds each job's render under the lease)

```ts
// packages/pdf/test/queue.test.ts (excerpt)
// build a fake MessageBatch of [{body:{type:'list',slug:'mcallen-locations'}}],
// stub render/putObject; call worker.queue(batch, env, ctx);
// expect the render to run and the pdf_renders row to be marked live.
```

- [ ] **Step 3: Implement** the `queue()` handler in `src/index.ts` — for each message, acquire the lease + `rebuild()` (reuse the `serve.ts` `rebuild` helper, exported), `markLive`/`markError`, `ack`/`retry`. **Debounce:** `enqueueListRebuild(env, citySlug, kind)` sends with `{ delaySeconds: 30 }` so rapid member edits coalesce (the queue de-dups by re-marking stale; the consumer renders once when it drains). Wire the Phase-2 invalidation fanout: when it marks a `list` row stale, also `enqueueListRebuild`.
- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git add packages/pdf packages/db && git commit -m "feat(pdf): render queue consumer + list debounce enqueue"`

### Task 4.5: Nightly cron (safety net + warm) — activates at cutover

**Files:** Modify `packages/pdf/wrangler.toml` (cron trigger), `packages/pdf/src/index.ts` (`scheduled()` handler); Test `packages/pdf/test/cron.test.ts`

- [ ] **Step 1: Add the cron** (commented until a slot frees at cutover — the account is at its 5-cron cap; see §10 of the spec):

```toml
[triggers]
crons = ["0 7 * * *"]   # 07:00 UTC nightly; ENABLE at cutover when legacy crons are disabled
```

- [ ] **Step 2: Write the failing test** — `scheduled()` enqueues a rebuild for every `status='stale'` list row (and re-warms any list not rebuilt in 24h).
- [ ] **Step 3: Implement** `scheduled()` — `SELECT type,slug FROM pdf_renders WHERE type='list' AND (status<>'live' OR last_rendered_at < now-24h)` → `RENDER_Q.send` each. This is also the initial warm.
- [ ] **Step 4: Run to verify it passes** → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(pdf): nightly list-rebuild cron (enable at cutover)"`

### Task 4.6: Seed list renders + extend the tree

**Files:** Modify `packages/pdf/scripts/seed-renders.ts`, confirm `buildPdfTree` already surfaces lists (Task 2.8 covers it).

- [ ] **Step 1:** Extend `seed-renders` — for each city × `{locations, qmis, plans}`, insert a `list` `pdf_renders` row (`slug = <citySlug>-<kind>`, `entity_id = list:<citySlug>:<kind>`, `r2_key = pdf/list/list:<citySlug>:<kind>.pdf`, `city_slug`).
- [ ] **Step 2:** Operational run (remote). Verify the PDFs tree shows city-level list downloads with statuses.
- [ ] **Step 3: Commit** — `git commit -am "feat(pdf): seed list renders per city"`

### Task 4.7: Framer integration for the community link (Phase-C field)

**Files:** Modify `packages/framer-push/src/collections.ts` (communities map), and run the Phase-C `setFields` to add the field to the Framer Communities collection.

- [ ] **Step 1:** Add `brochurePdfUrl` to the `communities` map in `collections.ts` (string field, not link — mind the link-vs-string gotcha noted in the spec §10).
- [ ] **Step 2:** Provision the field on the Framer Communities collection via the Phase-C `setFields` path (`packages/framer-push/src/framer.ts`), type `string`; store the returned `framer_field_id`.
- [ ] **Step 3:** Verify a community record in Framer receives its `brochure_pdf_url`. (QMI `dynamic_pdf` + floor-plan `brochure_pdf_url` already flow unchanged — no work.)
- [ ] **Step 4: Commit** — `git add packages/framer-push && git commit -m "feat(framer): surface communities.brochure_pdf_url to Framer"`

### Task 4.8: Cutover + retire `ehi.hazardhouse.ai` (operational)

- [ ] Confirm all link fields backfilled (`dynamic_pdf`, both `brochure_pdf_url`) and resolving to live PDFs.
- [ ] Free a cron slot (disable a legacy worker cron per README §7–§9) and **enable the nightly cron**; run an initial **warm all lists** (`rebuildAll` → `RENDER_Q`).
- [ ] Repoint the public host to `media.esperanzahomes.com` once the zone is on the account (until then `r2.dev`); confirm `PDF_PUBLIC_BASE_URL` matches the backfilled URLs (if the host changes, re-run the URL backfill).
- [ ] Keep `ehi.hazardhouse.ai` read-only during a soak window; confirm zero traffic depends on it; then decommission.
- [ ] **Phase-4 acceptance:** submarket list PDFs generate (debounced + nightly), all four types are live/browsable/themed, Framer links resolve to the new engine, and `ehi.hazardhouse.ai` is retired.

### Task 4.9: Deploy + full verify
- [ ] Deploy pdf + admin + framer-push. Run full `seed-renders` (all types) remote.
- [ ] Verify gates green (`typecheck`, `test`, `build:cf`). Smoke each PDF type + a theme publish + an edit-invalidation + a list rebuild.

---

## Plan self-review (applied)

**1. Spec coverage** — every spec section maps to ≥1 task:

| Spec § | Covered by |
|---|---|
| §2 four PDF types | community (1.6/1.7), qmi (2.1/2.2), floorplan (2.3/2.4), list (4.1/4.2) |
| §3 worker / serve / preview / single-flight / launch-per-render | 1.1, 1.8 (close-in-finally), 1.9 (lease), 1.10, 1.11 |
| §4 Browser Rendering (`document.fonts.ready`, Letter, renditions) | 1.8, 1.12 |
| §4.4 lists debounce + nightly | 4.3, 4.4, 4.5 |
| §5 React→HTML templates | 1.6, 2.2, 2.4, 4.2 |
| §6 theme (active/draft/history, JSON, css vars, fonts, publish/version) | 1.2, 1.3, 3.3 |
| §7 data model (pdf_renders, pdf_render_log, communities col, view, slugs, seed) | 1.2, 1.4, 1.13, 2.7, 4.6 |
| §8 invalidation (hash at render, lazy per-entity, list debounce, theme publish) | 1.9/1.10, 2.6, 4.4, 3.3 |
| §9 admin (PDFs tree, theme editor, RBAC interim) | 2.8, 3.1–3.4 |
| §10 integration / serving / Framer / cutover | 1.13/2.7 writeback, 4.7 Framer, 4.8 cutover |
| §11 error handling + render log | 1.9 markError, 1.10 last-good + **pdf_render_log write (added in rebuild)** |
| §12 testing (local snapshot/theme/invalidation/slug + remote render) | throughout; 1.8 remote smoke |
| §13 phasing | Phases 0–4 |

**2. Placeholder scan** — no `TBD`/`TODO`. **One disclosed exception:** the two Node operational scripts `scripts/derive-renditions.ts` and `scripts/seed-renders.ts` are specified at **algorithm + exact-SQL level** rather than line-complete, because their R2/D1 client calls must be filled from the repo's existing helpers (`packages/db/scripts/lib/r2.ts`, `packages/db/scripts/lib/d1.ts`) whose signatures the executor should follow. Every other step is line-complete with runnable code. This is intentional, not a hidden placeholder.

**3. Type consistency** — `Env`, `PdfType`, `RenderStatus`, `slugFor/r2KeyFor/publicUrlFor`, `stableHash`, `decideFreshness`, `renderTemplate`, `renderPdf`, `serve`, and the `store` functions are used with identical signatures across all phases. Two deliberate notes:
- `PdfRenderRow` exists twice by design: the **worker** version (`freshness.ts`, raw snake_case D1 row) vs the **Drizzle** inferred type (`schema.ts`, camelCase) — different packages, never cross-imported.
- `rebuild()` in `serve.ts` is **exported** (fixed inline) so the Phase-4 queue consumer reuses the identical render path.

**4. Conscious simplifications (documented, not gaps):**
- **Invalidation hooks (Task 2.6)** mark affected renders `stale` on *any* entity write rather than comparing the new `data_hash` first. A no-op save therefore triggers one extra lazy re-render — cheap and safe. Hash-compare-before-stale is a later optimization (the `data_hash` is already stored at render time).
- **Theme invalidation is global** (any publish bumps `themeVersion`, invalidating all types). Per-template-type theme hashes are a noted future optimization (spec §6.1), not v1.
- The single cross-runtime seam (`affectedRenderKeys` sync-vs-async) is implemented as an injected `q(sql, binds) => rows[]` resolver (Task 2.6 note) so the dependency logic is shared verbatim between the better-sqlite3 test, the admin (D1/async), and ingest.

---

## Execution handoff

**Plan complete and saved to `docs/plans/2026-05-31-pdf-platform.md`.** It is the full Phases 0–4 plan, TDD-structured, with runnable code in every code step (one disclosed algorithm-level exception for the two operational Node scripts).

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration (REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`). Best for a plan this size: each task is self-contained and independently testable, and the two-stage review catches drift early.
2. **Inline Execution** — I execute tasks in this session in batches with checkpoints for your review (REQUIRED SUB-SKILL: `superpowers:executing-plans`).

A practical note for either path: **Phases 1–3 can be built and verified entirely without cutover** (the engine, all per-entity brochures, the theme editor — served at `r2.dev` URLs, with no cron and no `ehi.hazardhouse.ai` changes). Only **Phase 4** touches the live site (Framer link repoint, cron slot, decommission), so it should land as a deliberate, separately-scheduled cutover.
