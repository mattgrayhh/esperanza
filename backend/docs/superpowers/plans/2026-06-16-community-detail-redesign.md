# Community Detail Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic community editor with a bespoke, live-accurate admin community detail page — hero, stat cards, Snowflake basic-info with override status, a live Leaflet/CARTO map with a Framer-exact green-pin tooltip, a recent-activity feed (community + offered floor plans), a compact media bar, and removal of 6 dead/superseded fields.

**Architecture:** A new framework-neutral `@esperanza/community-map` workspace package holds the map/popup core extracted verbatim from the live `Communities.tsx` (Phase 1: admin consumes it; Phase 2 rewiring the Framer component is out of scope). The admin gets a bespoke route `app/(app)/communities/[id]/page.tsx` modeled on the existing QMI bespoke page: a server builder produces a plain-JSON view model; a client shell composes section components inside ONE `<form>` that saves through the existing unchanged `saveEntity('communities', id, formData)` path (so override semantics + audit trail keep working).

**Tech Stack:** Next.js 15 (OpenNext-on-Workers), React 19 server/client components, Drizzle ORM over Cloudflare D1, Leaflet 1.9.4 + leaflet.markercluster (runtime CDN script injection) + CARTO tiles, Vitest + better-sqlite3 in-memory for tests.

## Global Constraints

- Monorepo: npm workspaces, `workspaces: ["packages/*"]`. Workspace packages export raw `.ts`/`.tsx` source (no build step); consumed via `moduleResolution: bundler`. New package name pattern: `@esperanza/<name>`, `"private": true`, `"type": "module"`.
- All writes go through Server Actions only; the save path is `saveEntity(entity, id, formData)` in `packages/admin/lib/actions.ts`. Do NOT add a new write path. Field renderers carry their own `name` attributes and submit via the parent `<form action={onSubmit}>`.
- Override fields submit a hidden input named exactly the base field (e.g. `price_from`); blank value = revert to synced, non-blank = pin override. This contract is owned by `SyncedOverrideField` and `buildOverrideWrite` — reuse, do not reinvent.
- Reads use `getReadDb()` from `packages/admin/lib/db.ts` (pinned to primary). Raw SQL via `db.all<T>(sql.raw(...))`; Drizzle table objects from `@esperanza/db`.
- The community URL segment is `communities`; a static `communities/[id]` route takes precedence over `[entity]/[id]` (proven by `qmi/[id]`).
- Map palette defaults (copy verbatim): `primaryColor "#295135"`, `strokeColor "#0c4128"`, `textDark "#3c3c3c"`, `accentTan "#85754e"`, `mapPanelBg "#e9edea"`; `pinWidth 20`, `pinHeight 32`, `mpcPinSize 34`, `popupMaxWidth 320`, `popupMinWidth 280`, `popupOffsetY -32`.
- The green pin = master-planned-community marker (`qmi-pin-mpc`): `#295135` rounded marker + white house SVG. Communities render the MPC pin (treat the detail community as `masterPlanned: true` for the single-pin preview).
- Leaflet coordinate order is `[lat, lng]`; `parseCoords("lat,lng")` returns `[lng, lat]` (GeoJSON order) and the marker code swaps back. Preserve this exactly.
- Tests: Vitest, in-memory better-sqlite3 loaded from the migration chain, Drizzle wrapper, mock `./db`/`./auth`/`next/cache`/`@opennextjs/cloudflare`. Follow `packages/admin/test/field-builder.test.ts` harness style.
- Pare-down removes EXACTLY these 6 fields from the community form (user-approved 2026-06-16): `directions`, `community_logo_alt`, `photo_gallery_image_alt`, `secondary_image_alt`, `security_details`, `community_map_embed`. DB column retirement is a separate later migration (noted, not executed here).
- Commit after every task. Run `npm run typecheck -w @esperanza/admin` (and the package's typecheck) before committing UI tasks.

---

## File Structure

**New package — `packages/community-map/`** (framework-neutral map core; Phase-2-ready for Framer):
- `package.json` — `@esperanza/community-map`, exports `.` → `./index.ts`.
- `index.ts` — barrel re-export.
- `popup.ts` — `escapeHtml`, `createCommunityPopupHTML`, types `MapCommunity`, `PopupOptions`.
- `pins.ts` — `MAP_PIN_SVG`, `MPC_ICON_PATH`, `MPC_ICON_VIEWBOX`, `mpcPinHTML`, `teardropPinHTML`.
- `tiles.ts` — `MAP_TILE_PRESETS`, `DEFAULT_TILE`.
- `coords.ts` — `parseCoords`.
- `palette.ts` — `DEFAULT_PALETTE`, `DEFAULT_PIN_SIZES`, `DEFAULT_POPUP` constants.
- `css.ts` — `COMMUNITY_MAP_CSS` (the `--qmi-*` vars + pin/popup/leaflet CSS string).
- `render.ts` — `loadLeaflet()`, `renderSingleCommunityMap(el, opts)` (vanilla, uses `window.L`).
- `tsconfig.json`, `vitest.config.ts`, `test/popup.test.ts`, `test/coords.test.ts`.

**Admin data layer — `packages/admin/lib/`:**
- `community-detail.ts` — `buildCommunityDetailView(id)` → `CommunityDetailView`.
- `community-activity.ts` — `loadCommunityActivity(id)` → `ActivityGroup[]` (reuses `activity-format.ts`).
- `community-counts.ts` — `communityStatCounts(id)` → `{ qmiCount; floorPlanCount }`.

**Admin UI — `packages/admin/`:**
- `app/(app)/communities/[id]/page.tsx` — RSC route.
- `components/communities/detail/CommunityDetail.tsx` — client shell (the `<form>`).
- `components/communities/detail/CommunityHero.tsx`
- `components/communities/detail/CommunityStatCards.tsx`
- `components/communities/detail/CommunityBasicInfo.tsx`
- `components/communities/detail/CommunityMap.tsx` — `'use client'` React wrapper over `@esperanza/community-map`.
- `components/communities/detail/RecentActivity.tsx`
- `components/communities/detail/CommunityMediaBar.tsx`
- `components/communities/detail/CommunityRemainingFields.tsx`
- `test/community-detail.test.ts`, `test/community-activity.test.ts`, `test/community-counts.test.ts`.

**Config change — `packages/admin/lib/field-config.ts`:** remove the 6 pared fields from the communities config.

---

## Task 1: Scaffold `@esperanza/community-map` + pure popup/coords/pins core

**Files:**
- Create: `packages/community-map/package.json`
- Create: `packages/community-map/tsconfig.json`
- Create: `packages/community-map/vitest.config.ts`
- Create: `packages/community-map/coords.ts`
- Create: `packages/community-map/popup.ts`
- Create: `packages/community-map/pins.ts`
- Create: `packages/community-map/tiles.ts`
- Create: `packages/community-map/palette.ts`
- Create: `packages/community-map/index.ts`
- Test: `packages/community-map/test/coords.test.ts`, `packages/community-map/test/popup.test.ts`

**Interfaces:**
- Produces: `MapCommunity` (`{ id: string; name: string; town: string; state: string; priceFrom: number | null; image?: string; url?: string; comingSoon?: boolean; promoBadgeText?: string; masterPlanned: boolean; coordinates: [number, number] /* [lng,lat] */ }`); `createCommunityPopupHTML(c: MapCommunity, opts?: { showIncentiveBanner?: boolean }): string`; `parseCoords(raw: string): [number, number] | null`; `escapeHtml(s: string): string`; `mpcPinHTML(opts)`, `teardropPinHTML(opts)`; `MAP_TILE_PRESETS`, `DEFAULT_TILE`; `DEFAULT_PALETTE`, `DEFAULT_PIN_SIZES`, `DEFAULT_POPUP`.

- [ ] **Step 1: Write the failing tests**

`packages/community-map/test/coords.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseCoords } from '../coords';

describe('parseCoords', () => {
  it('parses "lat,lng" into [lng,lat]', () => {
    expect(parseCoords('26.2034,-98.2306')).toEqual([-98.2306, 26.2034]);
  });
  it('tolerates whitespace', () => {
    expect(parseCoords(' 26.2 , -98.2 ')).toEqual([-98.2, 26.2]);
  });
  it('returns null for malformed input', () => {
    expect(parseCoords('')).toBeNull();
    expect(parseCoords('26.2')).toBeNull();
    expect(parseCoords('a,b')).toBeNull();
  });
});
```

`packages/community-map/test/popup.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createCommunityPopupHTML } from '../popup';
import type { MapCommunity } from '../popup';

const base: MapCommunity = {
  id: 'rec1', name: 'Palo Alto Groves', town: 'Brownsville', state: 'TX',
  priceFrom: 249990, image: 'https://r2/x.jpg', url: '/new-homes/palo-alto/',
  masterPlanned: true, coordinates: [-97.5, 25.9],
};

describe('createCommunityPopupHTML', () => {
  it('renders name, "City, State", and "From $price"', () => {
    const html = createCommunityPopupHTML(base);
    expect(html).toContain('Palo Alto Groves');
    expect(html).toContain('Brownsville, TX');
    expect(html).toContain('$249,990');
    expect(html).toContain('qmi-popup-price-label');
    expect(html).toContain('qmi-popup');
  });
  it('omits the price block when priceFrom is null', () => {
    const html = createCommunityPopupHTML({ ...base, priceFrom: null });
    expect(html).not.toContain('qmi-popup-price-block');
  });
  it('escapes HTML in the name', () => {
    const html = createCommunityPopupHTML({ ...base, name: 'A & <b>B</b>' });
    expect(html).toContain('A &amp; &lt;b&gt;B&lt;/b&gt;');
  });
  it('shows a Coming Soon badge when comingSoon', () => {
    const html = createCommunityPopupHTML({ ...base, comingSoon: true });
    expect(html).toContain('qmi-popup-badge--soon');
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd packages/community-map && npx vitest run`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create the package scaffolding**

`packages/community-map/package.json`:
```json
{
  "name": "@esperanza/community-map",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Framework-neutral Leaflet/CARTO community map + Framer-exact popup card. Shared by the Framer Communities component and the admin community detail page.",
  "main": "index.ts",
  "types": "index.ts",
  "exports": { ".": "./index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": { "vitest": "^2.0.0" }
}
```
(Pin `vitest` to the version already used elsewhere — check `packages/admin/package.json` and match it.)

`packages/community-map/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "noEmit": true, "lib": ["ES2022", "DOM", "DOM.Iterable"], "jsx": "preserve" },
  "include": ["**/*.ts"]
}
```

`packages/community-map/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 4: Implement `coords.ts`**

```typescript
// Parse a "lat,lng" string into GeoJSON [lng, lat] order (Leaflet markers swap back to [lat,lng]).
export function parseCoords(raw: string | null | undefined): [number, number] | null {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  const [lat, lng] = parts as [number, number];
  return [lng, lat];
}
```

- [ ] **Step 5: Implement `popup.ts`** (lifted verbatim from `Communities.tsx` lines 978–1010, generalized to `MapCommunity`)

```typescript
export interface MapCommunity {
  id: string;
  name: string;
  town: string;
  state: string;
  priceFrom: number | null;
  image?: string;
  url?: string;
  comingSoon?: boolean;
  promoBadgeText?: string;
  masterPlanned: boolean;
  coordinates: [number, number]; // [lng, lat]
}

export interface PopupOptions {
  showIncentiveBanner?: boolean;
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createCommunityPopupHTML(c: MapCommunity, opts: PopupOptions = {}): string {
  const priceAmount = c.priceFrom ? `$${Number(c.priceFrom).toLocaleString()}` : '';
  const cityState = `${c.town || ''}${c.town && c.state ? ', ' : ''}${c.state || ''}`;
  const href = escapeHtml(c.url || '#');
  const badge = c.comingSoon
    ? `<span class="qmi-popup-badge qmi-popup-badge--soon">Coming Soon</span>`
    : opts.showIncentiveBanner && c.promoBadgeText
      ? `<span class="qmi-popup-badge qmi-popup-badge--promo">${escapeHtml(c.promoBadgeText)}</span>`
      : '';
  return `
        <a class="qmi-popup" href="${href}">
            ${c.image ? `<div class="qmi-popup-imgwrap"><img class="qmi-popup-img" src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" loading="lazy" />${badge}</div>` : ''}
            <div class="qmi-popup-body">
                <div class="qmi-popup-info">
                    <div class="qmi-popup-title">${escapeHtml(c.name ?? '')}</div>
                    <div class="qmi-popup-location">${escapeHtml(cityState)}</div>
                </div>
                ${priceAmount ? `<div class="qmi-popup-price-block"><div class="qmi-popup-price-label">From</div><div class="qmi-popup-price">${priceAmount}</div></div>` : ''}
            </div>
        </a>
    `;
}
```

- [ ] **Step 6: Implement `pins.ts`, `tiles.ts`, `palette.ts`** (constants verbatim from `Communities.tsx`)

`palette.ts`:
```typescript
export const DEFAULT_PALETTE = {
  primaryColor: '#295135',
  strokeColor: '#0c4128',
  textDark: '#3c3c3c',
  accentTan: '#85754e',
  mapPanelBg: '#e9edea',
} as const;

export const DEFAULT_PIN_SIZES = { pinWidth: 20, pinHeight: 32, mpcPinSize: 34 } as const;

export const DEFAULT_POPUP = { popupMaxWidth: 320, popupMinWidth: 280, popupOffsetY: -32 } as const;
```

`tiles.ts` — copy the `MAP_TILE_PRESETS` object verbatim from `Communities.tsx` lines 28–52, and add:
```typescript
export const DEFAULT_TILE = MAP_TILE_PRESETS.positron;
```

`pins.ts` — copy `MAP_PIN_SVG` (line 18), `MPC_ICON_PATH` and `MPC_ICON_VIEWBOX` (lines 266–270) verbatim, then add builders matching the marker code (lines 789–801):
```typescript
export function mpcPinHTML(primaryColor: string, mpcPinSize: number): string {
  return `<div class="qmi-pin qmi-pin-mpc" style="background:${primaryColor};width:${mpcPinSize}px;height:${mpcPinSize}px;"><svg class="qmi-pin-house" viewBox="${MPC_ICON_VIEWBOX}" aria-hidden="true"><path d="${MPC_ICON_PATH}" fill="#fff"/></svg></div>`;
}
export function teardropPinHTML(pinWidth: number, pinHeight: number): string {
  return `<img class="qmi-pin-teardrop" src="${MAP_PIN_SVG}" alt="" style="width:${pinWidth}px;height:${pinHeight}px" />`;
}
```

- [ ] **Step 7: Implement `index.ts` barrel**

```typescript
export * from './coords';
export * from './popup';
export * from './pins';
export * from './tiles';
export * from './palette';
export * from './css';
export * from './render';
```
(`css.ts` and `render.ts` arrive in Task 2; create empty stubs now so the barrel compiles: `export const COMMUNITY_MAP_CSS = '';` in `css.ts` and `export {};` in `render.ts`, replaced in Task 2.)

- [ ] **Step 8: Run the tests, verify they pass**

Run: `cd packages/community-map && npx vitest run`
Expected: PASS (7 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/community-map
git commit -m "feat(community-map): scaffold shared map package with popup/coords/pins core"
```

---

## Task 2: Map CSS + vanilla single-community renderer

**Files:**
- Modify: `packages/community-map/css.ts` (replace stub)
- Modify: `packages/community-map/render.ts` (replace stub)
- Test: `packages/community-map/test/render.test.ts`

**Interfaces:**
- Consumes: `createCommunityPopupHTML`, `mpcPinHTML`, `teardropPinHTML`, `DEFAULT_TILE`, `DEFAULT_PALETTE`, `DEFAULT_PIN_SIZES`, `DEFAULT_POPUP`, `MapCommunity` (Task 1).
- Produces: `COMMUNITY_MAP_CSS: string`; `loadLeaflet(): Promise<void>`; `renderSingleCommunityMap(el: HTMLElement, opts: SingleMapOptions): () => void` (returns a cleanup fn); `SingleMapOptions` (`{ community: MapCommunity; zoom?: number; palette?: Partial<typeof DEFAULT_PALETTE>; openPopup?: boolean }`).

- [ ] **Step 1: Write the failing test** (only the pure CSS surface is unit-tested; map rendering is verified manually in Task 6)

`packages/community-map/test/render.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { COMMUNITY_MAP_CSS } from '../css';

describe('COMMUNITY_MAP_CSS', () => {
  it('defines the pin + popup classes and the dark-green var', () => {
    expect(COMMUNITY_MAP_CSS).toContain('.qmi-pin-mpc');
    expect(COMMUNITY_MAP_CSS).toContain('.qmi-popup-title');
    expect(COMMUNITY_MAP_CSS).toContain('--qmi-dark-green');
    expect(COMMUNITY_MAP_CSS).toContain('.leaflet-popup-content');
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd packages/community-map && npx vitest run test/render.test.ts`
Expected: FAIL (stub CSS is empty).

- [ ] **Step 3: Implement `css.ts`**

Export `COMMUNITY_MAP_CSS` as a single template string. Copy verbatim, in this order, from `Communities.tsx`: the `.qmi-pin*` rules (lines 2343–2383), the `.leaflet-popup*` overrides (2311–2341), the `.qmi-popup*` card rules (2385–2489), and the `.leaflet-control-zoom` / `.leaflet-container` rules (2491–2507). Prefix the string with a `:root` block using the palette (defaults inlined; the renderer can also set them as inline style on the container):
```typescript
export const COMMUNITY_MAP_CSS = `
:root {
  --qmi-dark-green: #295135;
  --qmi-green: #407e52;
  --qmi-green-light: #e9edea;
  --qmi-green-cta: #dfefe4;
  --qmi-tan: #85754e;
  --qmi-text: #3c3c3c;
  --qmi-text-light: #636464;
  --qmi-white: #fff;
  --qmi-border: #dee2e6;
  --qmi-font-bodoni: 'Bodoni', 'Arapey', Georgia, serif;
  --qmi-font-overpass: 'Overpass', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --qmi-popup-width: 280px;
}
/* …all the .qmi-pin*, .leaflet-popup*, .qmi-popup*, .leaflet-control-zoom rules copied verbatim… */
`;
```

- [ ] **Step 4: Implement `render.ts`**

`loadLeaflet()` — copy the script/CSS injection from `Communities.tsx` lines 597–657 (the `ensureCss` + `loadScript` + Leaflet/markercluster sequence), wrapped so it resolves a Promise when `window.L` is ready. `renderSingleCommunityMap(el, opts)` — a trimmed version of the map-init (lines 693–750) + single-marker bind (lines 789–870) for ONE community:
```typescript
import { createCommunityPopupHTML, type MapCommunity } from './popup';
import { mpcPinHTML, teardropPinHTML } from './pins';
import { DEFAULT_TILE } from './tiles';
import { DEFAULT_PALETTE, DEFAULT_PIN_SIZES, DEFAULT_POPUP } from './palette';

declare global { interface Window { L: any } }

export interface SingleMapOptions {
  community: MapCommunity;
  zoom?: number;
  palette?: Partial<typeof DEFAULT_PALETTE>;
  openPopup?: boolean;
}

export function loadLeaflet(): Promise<void> {
  // …verbatim ensureCss + loadScript sequence from Communities.tsx 597–657,
  //   resolving when window.L && window.L.markerClusterGroup are present…
  return new Promise((resolve, reject) => { /* … */ });
}

export function renderSingleCommunityMap(el: HTMLElement, opts: SingleMapOptions): () => void {
  const L = window.L;
  const palette = { ...DEFAULT_PALETTE, ...opts.palette };
  const [lng, lat] = opts.community.coordinates;
  const map = L.map(el, {
    center: [lat, lng],
    zoom: opts.zoom ?? 13,
    zoomControl: false,
    scrollWheelZoom: false,
    preferCanvas: true,
  });
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.tileLayer(DEFAULT_TILE.url, { attribution: DEFAULT_TILE.attribution, subdomains: 'abcd', detectRetina: true }).addTo(map);
  const icon = L.divIcon({
    className: 'qmi-pin-wrap',
    html: opts.community.masterPlanned
      ? mpcPinHTML(palette.primaryColor, DEFAULT_PIN_SIZES.mpcPinSize)
      : teardropPinHTML(DEFAULT_PIN_SIZES.pinWidth, DEFAULT_PIN_SIZES.pinHeight),
    iconSize: [DEFAULT_PIN_SIZES.mpcPinSize, DEFAULT_PIN_SIZES.mpcPinSize],
    iconAnchor: [DEFAULT_PIN_SIZES.mpcPinSize / 2, DEFAULT_PIN_SIZES.mpcPinSize / 2],
  });
  const marker = L.marker([lat, lng], { icon }).addTo(map);
  marker.bindPopup(createCommunityPopupHTML(opts.community), {
    closeButton: true,
    maxWidth: DEFAULT_POPUP.popupMaxWidth,
    minWidth: DEFAULT_POPUP.popupMinWidth,
    offset: [0, DEFAULT_POPUP.popupOffsetY],
    className: 'qmi-leaflet-popup',
  });
  if (opts.openPopup !== false) marker.openPopup();
  return () => { map.remove(); };
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd packages/community-map && npx vitest run`
Expected: PASS (8 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
cd packages/community-map && npx tsc --noEmit -p tsconfig.json
git add packages/community-map
git commit -m "feat(community-map): add map CSS and vanilla single-community renderer"
```

---

## Task 3: Wire `@esperanza/community-map` into the admin

**Files:**
- Modify: `packages/admin/package.json` (add dependency)

**Interfaces:**
- Produces: `@esperanza/community-map` importable from admin code.

- [ ] **Step 1: Add the dependency**

In `packages/admin/package.json` `dependencies`, add (mirroring `@esperanza/db`):
```json
"@esperanza/community-map": "*"
```

- [ ] **Step 2: Refresh the workspace symlink**

Run (from repo root): `npm install`
Expected: creates `node_modules/@esperanza/community-map` symlink → `packages/community-map`. No version bumps.

- [ ] **Step 3: Verify resolution with a throwaway typecheck import**

Run: `cd packages/admin && node -e "console.log(require.resolve('@esperanza/community-map/package.json'))"`
Expected: prints the path under `packages/community-map`.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/package.json package-lock.json
git commit -m "chore(admin): depend on @esperanza/community-map"
```

---

## Task 4: `community-counts.ts` — per-community QMI + floor-plan counts

**Files:**
- Create: `packages/admin/lib/community-counts.ts`
- Test: `packages/admin/test/community-counts.test.ts`

**Interfaces:**
- Produces: `communityStatCounts(db: Db, communityId: string, communityName: string): Promise<{ qmiCount: number; floorPlanCount: number }>` (`Db` = the type returned by `getReadDb()`; import from `./db`).

- [ ] **Step 1: Write the failing test** (in-memory sqlite, following `field-builder.test.ts` harness)

`packages/admin/test/community-counts.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { communityStatCounts } from '../lib/community-counts';
// load the migration chain helper used by other tests (copy the loadSchema() pattern from field-builder.test.ts)

let db: any;
beforeEach(() => {
  const sqlite = new Database(':memory:');
  // apply migrations (reuse the helper). Then seed:
  sqlite.exec(`INSERT INTO communities (id,name) VALUES ('recC','Agave');`);
  sqlite.exec(`INSERT INTO qmi (id, synced_community_id) VALUES ('q1','recC'),('q2','recC');`);
  sqlite.exec(`INSERT INTO qmi (id, synced_community_id, override_community_id) VALUES ('q3','recX','recC');`);
  sqlite.exec(`INSERT INTO floor_plans (id, communities) VALUES ('fp1','Agave, Other'),('fp2','agave'),('fp3','Nowhere');`);
  db = drizzle(sqlite);
});

describe('communityStatCounts', () => {
  it('counts QMIs by effective community id (override wins)', async () => {
    const r = await communityStatCounts(db, 'recC', 'Agave');
    expect(r.qmiCount).toBe(3);
  });
  it('counts floor plans whose CSV includes the community name, case-insensitively', async () => {
    const r = await communityStatCounts(db, 'recC', 'Agave');
    expect(r.floorPlanCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd packages/admin && npx vitest run test/community-counts.test.ts`
Expected: FAIL — `communityStatCounts` not found.

- [ ] **Step 3: Implement `community-counts.ts`**

```typescript
import { sql } from 'drizzle-orm';
import type { Db } from './db';

// Per-community live counts. QMIs link via COALESCE(override_community_id, synced_community_id);
// floor plans are denormalized on floor_plans.communities (CSV of names, case-insensitive match).
export async function communityStatCounts(
  db: Db,
  communityId: string,
  communityName: string
): Promise<{ qmiCount: number; floorPlanCount: number }> {
  const [qmiRow] = await db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM qmi
        WHERE COALESCE(override_community_id, synced_community_id) = ${communityId}`
  );
  // Match the name as a whole CSV token, case-insensitively. Wrap both sides in ", " sentinels
  // so "Agave" does not match "Agave Ridge".
  const needle = `%, ${communityName.toLowerCase()},%`;
  const [fpRow] = await db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM floor_plans
        WHERE (', ' || LOWER(REPLACE(communities, ', ', ',')) || ',') LIKE ${needle}`
  );
  return { qmiCount: qmiRow?.n ?? 0, floorPlanCount: fpRow?.n ?? 0 };
}
```
Note: the CSV is stored ", "-joined (see `applyMembership`). The normalization collapses ", " → "," then re-wraps with ", " sentinels for a whole-token match. Verify the test passes; if the seed used ", " vs "," adjust the normalization to match the real stored format (the test seeds `'Agave, Other'`).

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/admin && npx vitest run test/community-counts.test.ts`
Expected: PASS (2 tests). If `floorPlanCount` is off, fix the CSV normalization until the case-insensitive whole-token semantics hold for both `'Agave, Other'` and `'agave'`.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/lib/community-counts.ts packages/admin/test/community-counts.test.ts
git commit -m "feat(admin): per-community QMI + floor-plan live counts"
```

---

## Task 5: `community-activity.ts` — activity feed (community + offered floor plans)

**Files:**
- Create: `packages/admin/lib/community-activity.ts`
- Test: `packages/admin/test/community-activity.test.ts`

**Interfaces:**
- Consumes: `groupActivity`, `type AuditRow`, `type ActivityGroup` from `./activity-format`; `parseCommunityNames` from `./community-floor-plans`.
- Produces: `loadCommunityActivity(db: Db, communityId: string, communityName: string, limit?: number): Promise<ActivityGroup[]>`.

- [ ] **Step 1: Write the failing test**

`packages/admin/test/community-activity.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { loadCommunityActivity } from '../lib/community-activity';
// reuse migration loader

let db: any;
beforeEach(() => {
  const sqlite = new Database(':memory:');
  // apply migrations
  sqlite.exec(`INSERT INTO communities (id,name) VALUES ('recC','Agave');`);
  sqlite.exec(`INSERT INTO floor_plans (id, name, communities) VALUES ('fp1','Barbados','Agave'),('fp2','Cortona','Other');`);
  sqlite.exec(`INSERT INTO audit_log (entity, entity_id, field, action, actor, at) VALUES
    ('communities','recC','price_from','update','ingest','2026-06-16T10:00:00.000Z'),
    ('communities','recC','description','update','matt@hazard.house','2026-06-15T10:00:00.000Z'),
    ('floor_plans','fp1','starting_price','override_set','matt@hazard.house','2026-06-16T11:00:00.000Z'),
    ('floor_plans','fp2','starting_price','update','ingest','2026-06-16T12:00:00.000Z');`);
  db = drizzle(sqlite);
});

describe('loadCommunityActivity', () => {
  it('includes the community rows and ONLY its offered floor plans, newest first', async () => {
    const groups = await loadCommunityActivity(db, 'recC', 'Agave');
    // fp1 (Barbados, Agave) included; fp2 (Cortona, Other) excluded
    const ats = groups.map((g) => g.at);
    expect(ats[0]).toBe('2026-06-16T11:00:00.000Z'); // fp1 override, newest of the included set
    expect(groups.some((g) => g.entity === 'floor_plans')).toBe(true);
    // fp2 must not appear
    expect(groups.find((g) => g.at === '2026-06-16T12:00:00.000Z')).toBeUndefined();
  });
  it('respects the limit', async () => {
    const groups = await loadCommunityActivity(db, 'recC', 'Agave', 2);
    expect(groups.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd packages/admin && npx vitest run test/community-activity.test.ts`
Expected: FAIL — function not found.

- [ ] **Step 3: Implement `community-activity.ts`**

```typescript
import { sql } from 'drizzle-orm';
import type { Db } from './db';
import { groupActivity, type AuditRow, type ActivityGroup } from './activity-format';
import { parseCommunityNames } from './community-floor-plans';

// Activity for a community = its own audit rows PLUS audit rows for the floor plans it offers
// (floor_plans.communities CSV includes this community's name). Newest-first, grouped.
export async function loadCommunityActivity(
  db: Db,
  communityId: string,
  communityName: string,
  limit = 25
): Promise<ActivityGroup[]> {
  // Resolve offered floor-plan ids via the denormalized CSV (case-insensitive whole-token).
  const planRows = await db.all<{ id: string; communities: string | null }>(
    sql`SELECT id, communities FROM floor_plans`
  );
  const lc = communityName.toLowerCase();
  const planIds = planRows
    .filter((p) => parseCommunityNames(p.communities).some((n) => n.toLowerCase() === lc))
    .map((p) => p.id);

  const communityRows = await db.all<AuditRow>(
    sql`SELECT entity, field, action, actor, at FROM audit_log
        WHERE entity = 'communities' AND entity_id = ${communityId}
        ORDER BY at DESC, id DESC LIMIT ${limit}`
  );

  let planAudit: AuditRow[] = [];
  if (planIds.length > 0) {
    const ids = sql.join(planIds.map((p) => sql`${p}`), sql`, `);
    planAudit = await db.all<AuditRow>(
      sql`SELECT entity, field, action, actor, at FROM audit_log
          WHERE entity = 'floor_plans' AND entity_id IN (${ids})
          ORDER BY at DESC, id DESC LIMIT ${limit}`
    );
  }

  const merged = [...communityRows, ...planAudit]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
  return groupActivity(merged);
}
```
Note: `groupActivity` (from `activity-format.ts`) expects newest-first input and collapses same-(entity,action,actor)-same-day runs. The merge sorts DESC before grouping, satisfying that contract.

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/admin && npx vitest run test/community-activity.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/admin/lib/community-activity.ts packages/admin/test/community-activity.test.ts
git commit -m "feat(admin): community recent-activity feed (community + offered floor plans)"
```

---

## Task 6: `community-detail.ts` — the bespoke view-model builder

**Files:**
- Create: `packages/admin/lib/community-detail.ts`
- Test: `packages/admin/test/community-detail.test.ts`

**Interfaces:**
- Consumes: `getReadDb` (`./db`), `communities`/`floorPlans` tables (`@esperanza/db`), `effectiveValue` (`@esperanza/db/override`), `resolveFieldConfig` (`./field-config-source`), `buildFieldView` semantics (reuse the existing `buildEditView` field-building by EXTRACTING the per-field loop into an exported helper — see Step 3), `communityStatCounts` (Task 4), `loadCommunityActivity` (Task 5), `parseCoords`/`MapCommunity` (`@esperanza/community-map`), `statusGate`/`deriveStatus`/`statusOptions` (`./status`).
- Produces: `buildCommunityDetailView(id: string): Promise<CommunityDetailView | null>` and the `CommunityDetailView` interface:
```typescript
export interface CommunityDetailView {
  id: string;
  displayName: string;          // name
  subtitle: string;             // town
  status: string;               // 'Draft' | 'Coming Soon' | 'Live'
  statusOptions: string[];
  hero: { featuredImageUrl: string; description: string };
  stats: { city: string; startingPrice: string; qmiCount: number; floorPlanCount: number };
  basicInfo: FieldView[];       // price_from, square_footage_range, bed_count, bath_count (override) + name/slug/town/master_planned (admin)
  map: { community: import('@esperanza/community-map').MapCommunity | null }; // null when geo missing
  media: { featured: FieldView; secondary: FieldView; logo: FieldView; descriptionImage: FieldView; gallery: FieldView }; // image/imageGallery FieldViews
  activity: import('./activity-format').ActivityGroup[];
  remaining: { group: string; fields: FieldView[] }[]; // grouped leftover admin fields (post-pare-down)
}
```
(`FieldView` imported from `../components/EntityEditForm`.)

- [ ] **Step 1: Refactor — export the per-field builder from `build-edit-view.ts`**

In `packages/admin/lib/build-edit-view.ts`, change `function buildFieldView(...)` to `export function buildFieldView(...)` (no behavior change). This lets the community builder reuse identical FieldView construction (override locking, image forcing, select option resolution) instead of duplicating it.

- [ ] **Step 2: Write the failing test**

`packages/admin/test/community-detail.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
// reuse migration loader; mock ./db getReadDb to return the in-memory drizzle instance

let sqlite: any;
beforeEach(() => {
  sqlite = new Database(':memory:');
  // apply migrations
  sqlite.exec(`INSERT INTO communities (id,name,slug,town,description,published,coming_soon,
      synced_price_from, latitude, longitude, featured_image_url, city_name, master_planned)
    VALUES ('recC','Agave','agave','Phoenix','Desert living',1,0, 396990, 33.45, -112.07,
      'https://r2/agave.jpg','Phoenix, AZ', 1);`);
  vi.doMock('../lib/db', () => ({ getReadDb: () => drizzle(sqlite) }));
});

describe('buildCommunityDetailView', () => {
  it('builds hero, status, stats, basic info, and a map community from coords', async () => {
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const v = await buildCommunityDetailView('recC');
    expect(v).not.toBeNull();
    expect(v!.displayName).toBe('Agave');
    expect(v!.status).toBe('Live');
    expect(v!.hero.featuredImageUrl).toContain('agave.jpg');
    expect(v!.stats.startingPrice).toContain('396,990');
    expect(v!.map.community).not.toBeNull();
    expect(v!.map.community!.coordinates).toEqual([-112.07, 33.45]); // [lng,lat]
    expect(v!.map.community!.masterPlanned).toBe(true);
    expect(v!.basicInfo.some((f) => f.field === 'price_from')).toBe(true);
  });
  it('returns map.community = null when coordinates are missing', async () => {
    sqlite.exec(`UPDATE communities SET latitude=NULL, longitude=NULL WHERE id='recC';`);
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    const v = await buildCommunityDetailView('recC');
    expect(v!.map.community).toBeNull();
  });
  it('returns null for an unknown id', async () => {
    const { buildCommunityDetailView } = await import('../lib/community-detail');
    expect(await buildCommunityDetailView('nope')).toBeNull();
  });
});
```

- [ ] **Step 3: Implement `community-detail.ts`**

Build the row read (like `buildEditView`), resolve config via `resolveFieldConfig('communities')`, and assemble:
- `status` via `statusGate('communities')` + `deriveStatus` + `statusOptions`.
- `hero` from `featured_image_url` + `description`.
- `stats`: `city` from `city_name`/`town`; `startingPrice` = `$` + `effectiveValue(synced_price_from, override_price_from).toLocaleString()`; counts via `communityStatCounts(db, id, name)`.
- `basicInfo`: call the exported `buildFieldView` for the 4 override fields (`price_from`, `square_footage_range`, `bed_count`, `bath_count`) + admin fields (`name`, `slug`, `town`, `master_planned`), pulling each `FieldConfig` from the resolved config by `field`.
- `map.community`: build a `MapCommunity` from `latitude`/`longitude` → `coordinates: [lng, lat]` (or use `parseCoords` if you read `lat_long`); `masterPlanned: true`; `priceFrom` from effective price; `image` from featured; `url` from `/new-homes/${slug}/`; `state: 'TX'`. If no lat/long → `null`.
- `media`: `buildFieldView` for `featured_image_url`, `secondary_image_url`, `community_logo_url`, `description_image_url` (image kind) + `photo_gallery_json` (imageGallery kind).
- `activity`: `loadCommunityActivity(db, id, name)`.
- `remaining`: the leftover admin fields (everything in config minus publish/synced/basic-info/media/the 6 pared fields), grouped by their `group` attribute into `{ group, fields }[]`.

Reuse `resolveFieldConfig`, `buildFieldView`, and `loadOptionSets` exactly as `buildEditView` does. Return `null` if the row is missing.

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/admin && npx vitest run test/community-detail.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/admin/lib/community-detail.ts packages/admin/lib/build-edit-view.ts packages/admin/test/community-detail.test.ts
git commit -m "feat(admin): buildCommunityDetailView bespoke view model"
```

---

## Task 7: Pare down the 6 dead/superseded community fields

**Files:**
- Modify: `packages/admin/lib/field-config.ts` (communities config)
- Test: `packages/admin/test/community-detail.test.ts` (add a case)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test** (append to `community-detail.test.ts`)

```typescript
it('does not surface any of the 6 pared fields', async () => {
  const { buildCommunityDetailView } = await import('../lib/community-detail');
  const v = await buildCommunityDetailView('recC');
  const all = [...v!.basicInfo, ...v!.remaining.flatMap((g) => g.fields),
               ...Object.values(v!.media)];
  const fields = new Set(all.map((f: any) => f.field));
  for (const dead of ['directions','community_logo_alt','photo_gallery_image_alt',
                      'secondary_image_alt','security_details','community_map_embed']) {
    expect(fields.has(dead)).toBe(false);
  }
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd packages/admin && npx vitest run test/community-detail.test.ts`
Expected: FAIL — the fields still appear via the config.

- [ ] **Step 3: Remove the entries from the communities config**

In `packages/admin/lib/field-config.ts`, delete these lines from the `communities` `fields` array: `directions`, `community_logo_alt`, `photo_gallery_image_alt`, `secondary_image_alt`, `security_details`, `community_map_embed`. (If `field_definitions` seeds from this config, the remote D1 seed will follow on next reseed; note in the PR that a `field_definitions` cleanup may be needed for the live admin — see `reference_esperanza_admin_field_definitions`.)

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/admin && npx vitest run test/community-detail.test.ts && npx vitest run test/field-config-parity.test.ts`
Expected: PASS. If `field-config-parity` fails, update its expectations to match the removals.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/lib/field-config.ts packages/admin/test/community-detail.test.ts
git commit -m "feat(admin): remove 6 dead/superseded community fields from the editor"
```

---

## Task 8: `CommunityMap.tsx` — React wrapper over the shared map

**Files:**
- Create: `packages/admin/components/communities/detail/CommunityMap.tsx`

**Interfaces:**
- Consumes: `loadLeaflet`, `renderSingleCommunityMap`, `COMMUNITY_MAP_CSS`, `type MapCommunity` (`@esperanza/community-map`).
- Produces: `export function CommunityMap({ community }: { community: MapCommunity | null })`.

- [ ] **Step 1: Implement the client component** (no unit test — DOM/Leaflet; verified manually in Task 10)

```tsx
'use client';
import { useEffect, useRef } from 'react';
import {
  loadLeaflet,
  renderSingleCommunityMap,
  COMMUNITY_MAP_CSS,
  type MapCommunity,
} from '@esperanza/community-map';

export function CommunityMap({ community }: { community: MapCommunity | null }) {
  const elRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!community || !elRef.current) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    loadLeaflet().then(() => {
      if (cancelled || !elRef.current) return;
      cleanup = renderSingleCommunityMap(elRef.current, { community, openPopup: true });
    });
    return () => { cancelled = true; cleanup?.(); };
  }, [community]);

  if (!community) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Add latitude/longitude to preview the community on the map.
      </div>
    );
  }
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: COMMUNITY_MAP_CSS }} />
      <div ref={elRef} className="qmi-map" style={{ height: 320, width: '100%', borderRadius: 8, overflow: 'hidden' }} />
    </>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd packages/admin && npx tsc --noEmit
git add packages/admin/components/communities/detail/CommunityMap.tsx
git commit -m "feat(admin): CommunityMap client wrapper over @esperanza/community-map"
```

---

## Task 9: Section components + `CommunityDetail` shell + route

**Files:**
- Create: `packages/admin/components/communities/detail/CommunityHero.tsx`
- Create: `packages/admin/components/communities/detail/CommunityStatCards.tsx`
- Create: `packages/admin/components/communities/detail/CommunityBasicInfo.tsx`
- Create: `packages/admin/components/communities/detail/RecentActivity.tsx`
- Create: `packages/admin/components/communities/detail/CommunityMediaBar.tsx`
- Create: `packages/admin/components/communities/detail/CommunityRemainingFields.tsx`
- Create: `packages/admin/components/communities/detail/CommunityDetail.tsx`
- Create: `packages/admin/app/(app)/communities/[id]/page.tsx`

**Interfaces:**
- Consumes: `CommunityDetailView` (Task 6); `GenericField`, `SyncedOverrideField`, `ImageUploader`, `ImageGalleryEditor`, `PublishedToggle` (existing components); `saveEntity` (`../lib/actions`); `CommunityMap` (Task 8); `timeAgo`, `activityPhrase`, `entityLabel` (`../lib/activity-format`).
- Produces: `<CommunityDetail view={view} />` and the route.

- [ ] **Step 1: Build the leaf section components**

Each section is presentational and renders the matching `FieldView`s using the EXISTING renderers, mirroring how `EntityEditForm` (`components/EntityEditForm.tsx` lines 281–326) and `QmiDetail` (`components/qmi/detail/QmiDetail.tsx`) branch by `kind`. Follow those files for class names / spacing so the look matches the app.
- `CommunityBasicInfo` — renders `view.basicInfo`: `kind:'syncedOverride'` → `<SyncedOverrideField {...f} />`; `kind:'generic'` → `<GenericField {...f} />`. Each synced/override field shows the Synced/Override badge that `SyncedOverrideField` already provides.
- `CommunityMediaBar` — COMPACT: render `view.media.featured/secondary/logo/descriptionImage` via `<ImageUploader entity="communities" id={view.id} field={f.field} label={f.label} initialUrl={f.value} />` in a small horizontal row, and `view.media.gallery` via `<ImageGalleryEditor entity="communities" id={view.id} field="photo_gallery_json" label="Photo Gallery" initialValue={f.value} />`. Use small thumbnail sizing (match the current D1 panel scale — see the existing image rail in `EntityEditForm` lines 347–359, but tighter).
- `CommunityRemainingFields` — for each `{ group, fields }`, a labeled block rendering each field by `kind` (generic/image/imageGallery) exactly like `EntityEditForm`. Wrap globally-rare groups in a `<details>` accordion.
- `CommunityHero` — banner with `view.hero.featuredImageUrl` as background (gradient scrim), `view.displayName` + `view.hero.description` overlaid, and a slot for the status badge/actions (passed as children from the shell). Neutral block when no featured image.
- `CommunityStatCards` — four read-only cards from `view.stats`.
- `RecentActivity` — list `view.activity` using `activityPhrase(g)`, `timeAgo(g.at)`, `entityLabel(g.entity)`, and `actorName`; empty-state "No recent activity yet." For floor-plan groups, prefix the plan context via `entityLabel`.

- [ ] **Step 2: Build the `CommunityDetail` shell**

```tsx
'use client';
import { useState, useTransition } from 'react';
import { saveEntity } from '../../../lib/actions';
import { PublishedToggle } from '../../fields/PublishedToggle';
import { CommunityHero } from './CommunityHero';
import { CommunityStatCards } from './CommunityStatCards';
import { CommunityBasicInfo } from './CommunityBasicInfo';
import { CommunityMap } from './CommunityMap';
import { RecentActivity } from './RecentActivity';
import { CommunityMediaBar } from './CommunityMediaBar';
import { CommunityRemainingFields } from './CommunityRemainingFields';
import type { CommunityDetailView } from '../../../lib/community-detail';

export function CommunityDetail({ view }: { view: CommunityDetailView }) {
  const [msg, setMsg] = useState('');
  const [isPending, startTransition] = useTransition();
  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await saveEntity('communities', view.id, formData);
      setMsg(res.ok ? 'Saved' : `Error: ${res.error}`);
    });
  }
  return (
    <div className="space-y-6">
      <CommunityHero view={view}>
        <PublishedToggle
          entityKey="communities" id={view.id} gate="status"
          initialStatus={view.status} statusOptions={view.statusOptions} onResult={setMsg}
        />
      </CommunityHero>
      <CommunityStatCards stats={view.stats} />
      <form action={onSubmit} className="space-y-6">
        <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <CommunityBasicInfo fields={view.basicInfo} />
          <div className="space-y-6">
            <CommunityMap community={view.map.community} />
            <RecentActivity groups={view.activity} />
          </div>
        </section>
        <CommunityMediaBar id={view.id} media={view.media} />
        <CommunityRemainingFields groups={view.remaining} id={view.id} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={isPending} className="…">Save changes</button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </form>
    </div>
  );
}
```
(Match the Save button classes to `QmiDetail.tsx`. Image uploaders inside `CommunityMediaBar`/`CommunityRemainingFields` carry their own hidden inputs and live INSIDE this `<form>` so they submit with everything else — same as `QmiDetail`.)

- [ ] **Step 3: Build the route**

`packages/admin/app/(app)/communities/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation';
import { buildCommunityDetailView } from '@/lib/community-detail';
import { CommunityDetail } from '@/components/communities/detail/CommunityDetail';

export const dynamic = 'force-dynamic';

export default async function CommunityDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await buildCommunityDetailView(id);
  if (!view) notFound();
  return <CommunityDetail view={view} />;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/admin && npx tsc --noEmit`
Expected: no errors. Fix any prop-shape mismatches against the real component signatures (`GenericField`, `SyncedOverrideField`, `ImageUploader`, `ImageGalleryEditor`, `PublishedToggle`) reported in the exploration.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/components/communities/detail packages/admin/app/'(app)'/communities
git commit -m "feat(admin): bespoke community detail page (hero, stats, basic-info, map, activity, media)"
```

---

## Task 10: Manual verification + full test/typecheck sweep

**Files:** none (verification).

- [ ] **Step 1: Run the full admin test + typecheck**

Run: `cd packages/admin && npx vitest run && npx tsc --noEmit`
Expected: all green. Also `cd packages/community-map && npx vitest run && npx tsc --noEmit`.

- [ ] **Step 2: Boot the admin and open a community**

Run: `cd packages/admin && npm run dev` (needs the Cloudflare dev bindings — DB). Navigate to `/communities/<a-real-community-id>`.
Verify: hero featured image + LIVE badge; 4 stat cards; Basic Info with Synced/Override badges; the map renders with the **green MPC pin** and the popup card (image / name / "CITY, TX" / "From $price") matching the live site; recent activity lists community + floor-plan changes; compact media bar; remaining fields; Save persists (check a field round-trips and an `audit_log` row appears).

- [ ] **Step 3: Cross-check tooltip fidelity against live**

Open the live community map (the Framer `Communities` component popup) and the admin popup side by side; confirm identical card layout, fonts, colors, and "From $price" treatment. (They share `createCommunityPopupHTML` + `COMMUNITY_MAP_CSS`, so they should be pixel-identical.)

- [ ] **Step 4: Commit any fixes, then stop for review**

```bash
git add -A && git commit -m "fix(admin): community detail polish from manual verification"
```

---

## Notes / Follow-ups (out of scope for this plan)
- **Map Phase 2:** rewire the live `packages/framer-push/components/Communities.tsx` to import `@esperanza/community-map` (mirror the package into the Framer project as a code file). Gated/operator-coordinated; do not touch the live component here.
- **DB column retire migration:** a later `packages/db` migration may drop the 6 pared columns (`directions`, `community_logo_alt`, `photo_gallery_image_alt`, `secondary_image_alt`, `security_details`, `community_map_embed`). Config removal in Task 7 is sufficient to clean the UI; coordinate the column drop separately (check framer-push/public API for any lingering reads of `community_map_embed`).
- **field_definitions:** if the live admin renders communities from the `field_definitions` D1 table, a remote reseed/cleanup is needed so the 6 fields disappear in production (see `reference_esperanza_admin_field_definitions`).
- **Admin KB:** per `feedback_esperanza_admin_kb_sync`, update the admin knowledgebase (help-content) for the new community detail page in the same PR.
