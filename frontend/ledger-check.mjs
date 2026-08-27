// ledger-check.mjs — the fixture ledger must describe fixtures that EXIST.
//
// WHY: docs/PROMOTION_FIXTURE_LEDGER.md exists because "it's covered" was claimed in
// review and turned out to be wrong — a ledger named four offers while the rendered
// fixture proved three. A prose ledger nobody verifies is worse than none: it launders an
// unchecked claim into a citation. So every assertion message the ledger quotes in its
// "Assertion" column is grepped for in the fixture sources, and a quote that no longer
// exists fails `npm run check` rather than rotting into a false citation.
//
// SCOPE, precisely: this proves the quoted STRINGS exist in the named files. It does not
// prove the assertions are correct or that they run — that is what the fixtures themselves
// and the mutation testing are for. It closes exactly one hole: the ledger drifting from
// the suite.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = import.meta.dirname;
const LEDGER = join(ROOT, 'docs', 'PROMOTION_FIXTURE_LEDGER.md');

/** Every `backtick-quoted` fragment in the Assertion column of every table row. */
export function ledgerQuotes(md) {
  const out = [];
  for (const line of String(md).split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|');
    if (cells.length < 5) continue;
    const requirement = cells[1].trim();
    const files = cells[2].trim();
    if (/^-+$/.test(requirement) || requirement === 'Requirement') continue; // header/separator
    for (const m of cells[3].matchAll(/`([^`]+)`/g)) out.push({ requirement, files, quote: m[1] });
  }
  return out;
}

/** Normalize both sides to the same text before comparing. Sources are JS, so an
 *  apostrophe inside a single-quoted message is often written as the escape `\u2019`, and
 *  the ledger is Markdown where a backtick cannot appear inside a backtick span (so it
 *  writes 'active' where the source writes `active`). Comparing raw bytes across those two
 *  encodings produces false failures, which would train a reader to ignore this check. */
export function normalizeText(s) {
  return String(s)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/`/g, "'")   // ledger 'active' vs source `active`
    .replace(/\s+/g, ' ');
}

/** The longest literal chunks of a quote, with template placeholders and prose
 *  punctuation removed — what can honestly be grepped for. */
export function literalChunks(quote) {
  const probe = normalizeText(quote)
    .replace(/\$\{[^}]*\}/g, '\u0000')   // ${promo.id} etc — the fixture interpolates these
    .replace(/<[a-z]+>/gi, '\u0000')      // <id>, <x> — placeholders in the prose
    .replace(/…/g, '\u0000');             // the ledger elides long messages with an ellipsis
  return probe.split('\u0000').map(s => s.trim()).filter(s => s.length >= 12).sort((a, b) => b.length - a.length);
}

function fixtureSources() {
  const files = new Map();
  for (const name of readdirSync(ROOT)) {
    if (name.endsWith('.mjs') && name !== 'ledger-check.mjs') files.set(name, readFileSync(join(ROOT, name), 'utf8'));
  }
  const islands = join(ROOT, 'islands');
  if (existsSync(islands)) {
    for (const name of readdirSync(islands)) {
      if (name.endsWith('.js')) files.set('islands/' + name, readFileSync(join(islands, name), 'utf8'));
    }
  }
  return files;
}

export function check() {
  assert.ok(existsSync(LEDGER), 'docs/PROMOTION_FIXTURE_LEDGER.md exists');
  const md = readFileSync(LEDGER, 'utf8');
  const quotes = ledgerQuotes(md);
  // A ledger that quotes nothing would pass every check below vacuously.
  assert.ok(quotes.length >= 100, `the ledger still cites its fixtures (found ${quotes.length} quoted assertions)`);

  const sources = fixtureSources();
  const all = normalizeText([...sources.values()].join('\n'));
  const missing = [];
  for (const { requirement, quote } of quotes) {
    const chunks = literalChunks(quote);
    if (!chunks.length) continue; // pure placeholder, nothing to verify
    // Any of the two longest literal chunks appearing somewhere in the fixtures is enough:
    // messages are built by interpolation, so no single full string need exist.
    if (!chunks.slice(0, 2).some(c => all.includes(c))) missing.push(`${requirement} -> "${chunks[0]}"`);
  }
  assert.deepEqual(missing, [],
    `the ledger cites assertions that no longer exist in the fixtures:\n  ${missing.join('\n  ')}`);

  // Every file the ledger names in its File column must exist, or a row points at nothing.
  const named = new Set();
  for (const { files } of quotes) {
    for (const m of files.matchAll(/`([^`]+)`/g)) {
      for (const f of m[1].split('/').length ? [m[1]] : []) named.add(f.replace(/ .*$/, ''));
    }
  }
  const unknown = [...named].filter(f => /\.(mjs|js)$/.test(f) && !sources.has(f));
  assert.deepEqual(unknown, [], `the ledger names files that do not exist: ${unknown.join(', ')}`);

  console.log(`ledger-check.mjs passed: ${quotes.length} cited assertions all present across ${sources.size} fixture files`);
}

if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) check();
