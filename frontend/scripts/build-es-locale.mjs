#!/usr/bin/env node
// Run this to EXTEND the dictionary, not on every build: es-bake.mjs consumes the
// committed assets/locales/es.json. Needs the one npm dev dependency in this repo.
// Harvest visible English strings from public/ + islands + sections, merge with
// assets/locales/es.json, and machine-translate missing entries to Spanish.
// Usage: node scripts/build-es-locale.mjs [--dry-run] [--limit=N]
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { translate } from '@vitalets/google-translate-api';
import { loadData } from '../data.mjs';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const OUT = join(ROOT, 'assets', 'locales', 'es.json');
const PROGRESS = join(ROOT, 'assets', 'locales', '.es-build-progress.json');

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

const SKIP_EXACT = new Set([
  'US', 'MX', 'TX', 'EN', 'ES', 'PDF', 'RSVP', 'HOA', 'CCR', 'FAQ', 'EMI', 'APR',
  'Esperanza', 'Homefiniti', 'Mapbox', 'Navien', 'Amarr', 'LiftMaster', 'Lennox',
  'Tempra', 'Rhodes Home Service', 'ONeil', 'O\'Neill', 'Hazard House',
]);

async function buildSkipSet() {
  const skip = new Set(SKIP_EXACT);
  try {
    const d = await loadData();
    for (const c of d.communities || []) if (c.name) skip.add(c.name.trim());
    for (const f of d.floorplans || []) if (f.name) skip.add(f.name.trim());
    for (const c of d.cities || []) if (c.name) skip.add(c.name.trim());
  } catch { /* offline */ }
  // Texas cities commonly appearing alone in nav
  for (const city of ['McAllen', 'Brownsville', 'Harlingen', 'Edinburg', 'Mission', 'Pharr',
    'Weslaco', 'Corpus Christi', 'Laredo', 'San Antonio', 'Austin', 'Houston', 'Dallas']) {
    skip.add(city);
  }
  return skip;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldSkip(s, skip) {
  if (!s || s.length < 2) return true;
  if (skip.has(s)) return true;
  if (/^[\d$#.,\s\-–—|/\\%]+$/.test(s)) return true;
  if (/^https?:\/\//.test(s)) return true;
  if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(s)) return true;
  if (/^\+?\d[\d\s().-]{6,}$/.test(s)) return true;
  return false;
}

function harvestHtml(dir, strings) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'static') continue;
      harvestHtml(p, strings);
    } else if (name.endsWith('.html')) {
      const html = readFileSync(p, 'utf8')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '');
      const texts = html.match(/>([^<]{2,})</g) || [];
      for (const m of texts) {
        const t = decodeEntities(m.slice(1, -1));
        if (!shouldSkip(t, new Set())) strings.add(t);
      }
    }
  }
}

function harvestSourceFiles(strings, skip) {
  const files = [
    join(ROOT, 'sections.mjs'),
    ...readdirSync(join(ROOT, 'islands')).filter(f => f.endsWith('.js')).map(f => join(ROOT, 'islands', f)),
  ];
  const re = /(?:>|"|'|`)([A-Za-z][^"'`<]{3,200}?)(?:<|"|'|`)/g;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(src))) {
      const t = decodeEntities(m[1]);
      if (!shouldSkip(t, skip) && t.length <= 500) strings.add(t);
    }
  }
}

function loadExisting() {
  if (!existsSync(OUT)) return {};
  return JSON.parse(readFileSync(OUT, 'utf8'));
}

function loadProgress() {
  if (!existsSync(PROGRESS)) return {};
  try { return JSON.parse(readFileSync(PROGRESS, 'utf8')); } catch { return {}; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function translateOne(text, attempt) {
  try {
    const r = await translate(text, { from: 'en', to: 'es' });
    return r.text;
  } catch (e) {
    if (attempt < 5 && /Too Many Requests/i.test(String(e.message))) {
      await sleep(2000 * (attempt + 1));
      return translateOne(text, attempt + 1);
    }
    console.error('translate fail:', JSON.stringify(text.slice(0, 60)), e.message);
    return text;
  }
}

async function translateBatch(texts) {
  const out = {};
  for (const text of texts) {
    out[text] = await translateOne(text, 0);
  }
  return out;
}

async function main() {
  const skip = await buildSkipSet();
  const strings = new Set();
  harvestHtml(PUBLIC, strings);
  harvestSourceFiles(strings, skip);

  const existing = loadExisting();
  const progress = loadProgress();
  const merged = { ...existing, ...progress };

  const todo = [...strings].filter(s => !merged[s] && !shouldSkip(s, skip)).sort((a, b) => b.length - a.length);
  const work = todo.slice(0, LIMIT);
  console.log(`Harvested ${strings.size} strings; ${todo.length} need translation; processing ${work.length}${dryRun ? ' (dry run)' : ''}`);

  if (dryRun) {
    work.slice(0, 20).forEach(s => console.log('-', s.slice(0, 100)));
    return;
  }

  const BATCH = 6;
  let done = 0;
  for (let i = 0; i < work.length; i += BATCH) {
    const batch = work.slice(i, i + BATCH);
    const translated = await translateBatch(batch);
    Object.assign(merged, translated);
    done += batch.length;
    if (done % 60 === 0 || i + BATCH >= work.length) {
      writeFileSync(PROGRESS, JSON.stringify(merged, null, 0));
      console.log(`Translated ${done}/${work.length}`);
    }
    await sleep(900);
  }

  const sorted = Object.fromEntries(
    Object.entries(merged).filter(([k, v]) => k && v && k !== v).sort(([a], [b]) => a.localeCompare(b))
  );
  const extraPath = join(ROOT, 'assets', 'locales', 'es-extra.json');
  if (existsSync(extraPath)) Object.assign(sorted, JSON.parse(readFileSync(extraPath, 'utf8')));
  writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');
  if (existsSync(PROGRESS)) writeFileSync(PROGRESS, '{}');
  console.log(`Wrote ${Object.keys(sorted).length} entries to ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
