#!/usr/bin/env node
// harvest-desc-ul.mjs — live QMI pages render the "Highlights" hyphen lines two ways
// (legacy rich text): a real <ul><li> on some homes, literal "<p>- …" paragraphs on
// others. D1's Description is plain text for most homes, so the distinction is gone —
// this script asks the LIVE page which form each home uses and writes
// assets/desc-ul.json {slugs:[…]} for descHtml's <ul> mode (sections.mjs).
// Rerun after QMI churn; homes without a live page (or ambiguous) default to <p>-.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public';
const LIVE = 'https://www.esperanzahomes.com';

const { homes } = await (await fetch(`${API}/qmi`, { headers: { origin: LIVE } })).json();
const ss = await (await fetch(`${LIVE}/sitesearch.json`)).text();

const slugs = [];
let miss = 0;
for (const h of homes) {
  const f = h.fields || h;
  const desc = String(f.Description || '');
  if (!desc.includes('\n- ') || /<\w+[\s>]/.test(desc)) continue; // no bullets / already HTML
  const m = ss.match(new RegExp(`"(/new-homes/[^"]*/${f.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d+/)"`));
  if (!m) { miss++; continue; }
  const html = await (await fetch(LIVE + m[1])).text();
  const first = desc.split('\n').map(l => l.trim()).find(l => l.startsWith('- ')).slice(2).trim();
  const i = html.indexOf(first.slice(0, 30));
  if (i < 0) { miss++; continue; }
  if (/<li\b[^>]*>\s*(?:<[^>]+>\s*)*$/.test(html.slice(Math.max(0, i - 300), i))) slugs.push(f.slug);
}
writeFileSync(join(import.meta.dirname, '..', 'assets', 'desc-ul.json'), JSON.stringify({ harvested: new Date().toISOString().slice(0, 10), slugs: slugs.sort() }, null, 1));
console.log(`desc-ul.json: ${slugs.length} homes render <ul> on live (${miss} unmatched/absent -> default <p>-)`);
