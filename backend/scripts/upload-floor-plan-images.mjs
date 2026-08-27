#!/usr/bin/env node
// =============================================================================
// upload-floor-plan-images.mjs — one-shot loader for the QMI/Floor Plans
// "Floor Plan Image" (top-down layout) field.
//
//   For each plan folder under SVG_ROOT:
//     1. resolve the floor_plans record (alias map → exact name, else normalized name)
//     2. render its *_main_floor_plan_main_floor_plan.svg → PNG (resvg @2x)
//     3. upload PNG to R2 esperanza-cms at floor_plans/<recId>/floor-plan.png
//     4. set floor_plans.floor_plan_image = <PUBLIC_BASE>/floor_plans/<recId>/floor-plan.png
//
//   Record list is ALWAYS read from REMOTE D1 (that is where the live records are).
//   WRITES (R2 put + D1 UPDATE) only happen when --dry-run is NOT passed.
//
//   Flags:
//     --dry-run   render + match only; print the table, write the report, no writes.
//
//   Output: scripts/floor-plan-image-report.md + a console summary. Exits non-zero if
//   any render/upload hard-failed (report is still written).
// =============================================================================

import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

const SVG_ROOT =
  '<LOCAL_PATH> Room/3. Client Files/Rhodes Enterprises/Client Assets/Esperanza Homes - Selections/api_data/svg_files';
const PUBLIC_BASE = 'https://img.hazardhouse.ai';
const BUCKET = 'esperanza-cms';
const DB_NAME = 'esperanza';
const DB_DIR = join(REPO, 'packages', 'db'); // run wrangler from here (resolves the D1 binding)

const DRY_RUN = process.argv.includes('--dry-run');

// Folder → exact floor_plans.name, for drift the normalizer can't bridge.
const ALIASES = {
  lorenzo: 'San Lorenzo',
  lorenzo_ii: 'San Lorenzo II',
  deluxe_coach: 'RV Deluxe Coach House',
  casita: 'RV Casita',
  francisco_1_story: 'Francisco I',
  francisco_2_story: 'Francisco II',
};

// Normalize a plan name/folder for fuzzy matching.
function norm(s) {
  let x = String(s).toLowerCase().trim();
  x = x.replace(/_{2,}/g, ' ').replace(/_/g, ' ');
  x = x.replace(/[^a-z0-9]+/g, ' ').trim();
  // roman numerals → arabic (only the small ones that appear here)
  x = x.replace(/\biii\b/g, '3').replace(/\bii\b/g, '2');
  x = x.replace(/\bi\b/g, '1');
  // strip story qualifiers
  x = x.replace(/\b[12]\s*story\b/g, '');
  x = x.replace(/\s+/g, ' ').trim();
  return x;
}

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: DB_DIR,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Parse `wrangler d1 execute --json` output (array form or {result:[...]} form).
function d1Query(sql) {
  const out = wrangler(['d1', 'execute', DB_NAME, '--remote', '--json', '--command', sql]);
  const data = JSON.parse(out);
  const block = Array.isArray(data) ? data[0] : (data.result?.[0] ?? data);
  return block?.results ?? [];
}

function d1Exec(sql) {
  wrangler(['d1', 'execute', DB_NAME, '--remote', '--command', sql]);
}

function r2Put(key, file) {
  // retry transient 10001s
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      wrangler([
        'r2',
        'object',
        'put',
        `${BUCKET}/${key}`,
        `--file=${file}`,
        '--content-type=image/png',
        '--remote',
      ]);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Pick the layout SVG inside a plan folder.
function pickFloorPlanSvg(folderPath) {
  const files = readdirSync(folderPath).filter((f) => f.toLowerCase().endsWith('.svg'));
  return (
    files.find((f) => f.endsWith('main_floor_plan_main_floor_plan.svg')) ??
    files.find((f) => f.includes('main_floor_plan')) ??
    null
  );
}

function render(svgPath, outPath) {
  execFileSync('resvg', ['--zoom', '2', svgPath, outPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    throw new Error(`resvg produced no output for ${svgPath}`);
  }
}

// --------------------------------------------------------------------------- //
function main() {
  console.log(`[floor-plan-images] mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE (remote R2 + D1)'}`);

  const records = d1Query('SELECT id, name, quick_move_in_ids FROM floor_plans');
  const byExactName = new Map(records.map((r) => [r.name, r]));
  const byNorm = new Map();
  for (const r of records) {
    const k = norm(r.name);
    if (!byNorm.has(k)) byNorm.set(k, r);
  }

  const folders = readdirSync(SVG_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const tmp = mkdtempSync(join(tmpdir(), 'fpimg-'));

  const matched = []; // {folder, name, id}
  const noRecord = []; // folders with no matching record
  const noSvg = []; // matched folder but no main floor plan svg
  const failures = []; // {folder, id, error}
  const assignedIds = new Set();

  for (const folder of folders) {
    const folderPath = join(SVG_ROOT, folder);
    let rec = null;
    if (ALIASES[folder]) rec = byExactName.get(ALIASES[folder]) ?? null;
    if (!rec) rec = byNorm.get(norm(folder)) ?? null;
    if (!rec) {
      noRecord.push(folder);
      continue;
    }

    const svg = pickFloorPlanSvg(folderPath);
    if (!svg) {
      noSvg.push({ folder, name: rec.name, id: rec.id });
      continue;
    }

    const outPath = join(tmp, `${rec.id}.png`);
    try {
      render(join(folderPath, svg), outPath);
    } catch (err) {
      failures.push({ folder, id: rec.id, error: `render: ${err.message}` });
      continue;
    }

    const key = `floor_plans/${rec.id}/floor-plan.png`;
    const url = `${PUBLIC_BASE}/${key}`;

    if (!DRY_RUN) {
      try {
        r2Put(key, outPath);
        d1Exec(`UPDATE floor_plans SET floor_plan_image = '${url}' WHERE id = '${rec.id}'`);
      } catch (err) {
        failures.push({ folder, id: rec.id, error: `upload/update: ${err.message}` });
        continue;
      }
    }

    matched.push({ folder, name: rec.name, id: rec.id, svg, url });
    assignedIds.add(rec.id);
  }

  // Records with no folder, and (critically) records that have linked QMIs but got no image.
  const noFolder = records.filter((r) => !assignedIds.has(r.id));
  const qmiGap = noFolder.filter(
    (r) => typeof r.quick_move_in_ids === 'string' && r.quick_move_in_ids.trim() !== ''
  );

  // ---- report ----
  const lines = [];
  lines.push('# Floor Plan Image — load report');
  lines.push('');
  lines.push(`- Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE'}`);
  lines.push(`- Folders scanned: ${folders.length}`);
  lines.push(`- Matched & ${DRY_RUN ? 'rendered' : 'uploaded'}: ${matched.length}`);
  lines.push(`- Folders with no DB record: ${noRecord.length}`);
  lines.push(`- Matched folder but no main-floor-plan SVG: ${noSvg.length}`);
  lines.push(`- Records with no folder: ${noFolder.length}`);
  lines.push(`- Records WITH linked QMIs but NO image: ${qmiGap.length}`);
  lines.push(`- Hard failures: ${failures.length}`);
  lines.push('');

  lines.push(`## Matched & ${DRY_RUN ? 'rendered' : 'uploaded'} (${matched.length})`);
  for (const m of matched) lines.push(`- ${m.folder} → ${m.name} (${m.id})`);
  lines.push('');

  lines.push(`## Folders with no DB record (${noRecord.length}) — discontinued / not in D1`);
  for (const f of noRecord) lines.push(`- ${f}`);
  lines.push('');

  if (noSvg.length) {
    lines.push(`## Matched folder but no main-floor-plan SVG (${noSvg.length})`);
    for (const n of noSvg) lines.push(`- ${n.folder} → ${n.name} (${n.id})`);
    lines.push('');
  }

  lines.push(`## Records with no folder (${noFolder.length}) — no SVG art supplied`);
  for (const r of noFolder) lines.push(`- ${r.name} (${r.id})`);
  lines.push('');

  lines.push(`## ⚠ Records WITH linked QMIs but NO image (${qmiGap.length}) — operator follow-up`);
  for (const r of qmiGap) {
    const n = r.quick_move_in_ids.split(',').filter(Boolean).length;
    lines.push(`- ${r.name} (${r.id}) — ${n} linked QMI(s)`);
  }
  lines.push('');

  if (failures.length) {
    lines.push(`## Hard failures (${failures.length})`);
    for (const f of failures) lines.push(`- ${f.folder} (${f.id}): ${f.error}`);
    lines.push('');
  }

  const report = lines.join('\n');
  writeFileSync(join(__dirname, 'floor-plan-image-report.md'), report);

  // console summary
  console.log(report);
  console.log(`[floor-plan-images] report → scripts/floor-plan-image-report.md`);

  if (failures.length) {
    console.error(`[floor-plan-images] ${failures.length} hard failure(s)`);
    process.exit(1);
  }
}

main();
