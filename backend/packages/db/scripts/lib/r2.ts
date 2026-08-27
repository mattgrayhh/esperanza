// =============================================================================
// esperanza-cf — image → R2 migration helpers (Phase 2).
//
// For any image value that is an Airtable attachment / v5.airtableusercontent.com
// signed URL, download the bytes and upload to R2 at <entity>/<id>/<filename>,
// then return the STABLE public URL (media.esperanzahomes.com / configurable CDN
// base) to persist in D1. We NEVER persist an airtableusercontent URL.
//
// Already-stable urls (media/cdn.esperanzahomes.com, the permanent url-typed
// Airtable fields) are kept as-is — idempotent re-runs don't re-upload.
//
// Upload path: `wrangler r2 object put <bucket>/<key> --file=<tmp> --content-type
// <ct> --local|--remote`. Download via global fetch (Node 20+/26). The R2 bucket
// is 'esperanza-cms' (binding IMAGES). The public base defaults to
// media.esperanzahomes.com; override with CDN_BASE_URL (the task referenced
// cdn.esperanzahomes.com — set CDN_BASE_URL=https://cdn.esperanzahomes.com to use it).
// =============================================================================

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Signed/expiring image host we must never persist to D1 (guard, still enforced here).
export const FORBIDDEN_IMAGE_HOST = 'airtableusercontent.com';

export const DEFAULT_BUCKET = 'esperanza-cms';
// The stable public asset host is the R2 bucket's public domain. It was formerly
// media.esperanzahomes.com (the legacy web host), which was decommissioned
// 2026-06-15 — so that host must NEVER be the CDN base or be treated as "stable",
// or scripts re-mint dead URLs. See scripts/rehost-media-host.mts.
export const DEFAULT_CDN_BASE = 'https://img.hazardhouse.ai';

export function cdnBase(): string {
  return (process.env.CDN_BASE_URL ?? DEFAULT_CDN_BASE).replace(/\/+$/, '');
}

/**
 * Hosts we treat as already-stable (never re-upload): the R2 public domain only.
 * media.esperanzahomes.com is DELIBERATELY excluded — it is the dead legacy host;
 * any value still on it must be re-hosted, not skipped as "stable".
 */
export function isStableUrl(url: string): boolean {
  if (!url) return false;
  const base = cdnBase();
  return (
    url.startsWith(base) ||
    /https?:\/\/[a-z0-9-]+\.r2\.dev\//.test(url) ||
    /https?:\/\/[a-z0-9-]+\.r2\.cloudflarestorage\.com\//.test(url)
  );
}

export function isSignedAirtableUrl(url: string): boolean {
  return typeof url === 'string' && url.includes(FORBIDDEN_IMAGE_HOST);
}

/** Sanitize a filename for an R2 key (keep extension; collapse unsafe chars). */
export function safeFilename(name: string | undefined, fallback: string): string {
  const base = (name && name.trim()) || fallback;
  return base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

/** Derive the R2 object key for an entity/record/file. */
export function r2Key(entity: string, recordId: string, filename: string): string {
  return `${entity}/${recordId}/${filename}`;
}

/** The stable public URL for an R2 key. */
export function publicUrl(key: string): string {
  return `${cdnBase()}/${key}`;
}

export interface MigrateOptions {
  bucket?: string;
  mode: 'local' | 'remote';
  cwd: string; // dir with a wrangler.toml binding the R2 bucket
  dryRun?: boolean;
  maxRetries?: number;
}

export interface MigrateResult {
  /** the stable URL to persist (or the original if it was already stable). */
  url: string;
  /** true if bytes were uploaded this run. */
  uploaded: boolean;
  /** true if the source was a signed/attachment url that needed migrating. */
  migrated: boolean;
  bytes?: number;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Migrate ONE image url. Returns the stable url to persist.
 *   * already-stable -> returned unchanged, no upload.
 *   * signed/attachment -> downloaded + uploaded to R2 -> stable url.
 *   * dry-run -> computes the would-be stable url, no network writes.
 */
export async function migrateImageUrl(
  entity: string,
  recordId: string,
  url: string,
  filenameHint: string | undefined,
  opts: MigrateOptions
): Promise<MigrateResult> {
  if (!url) return { url, uploaded: false, migrated: false };
  if (isStableUrl(url)) return { url, uploaded: false, migrated: false };

  const isSigned = isSignedAirtableUrl(url) || /^https?:\/\//.test(url);
  // We migrate any non-stable http(s) url (covers signed Airtable + any external
  // host that would otherwise rot). Non-http values (already keys, data: etc.) pass through.
  if (!/^https?:\/\//.test(url)) return { url, uploaded: false, migrated: false };

  const filename = safeFilename(filenameHint ?? deriveName(url), `${recordId}.bin`);
  const key = r2Key(entity, recordId, filename);
  const stable = publicUrl(key);

  if (opts.dryRun) {
    return { url: stable, uploaded: false, migrated: true };
  }

  // download
  const maxRetries = opts.maxRetries ?? 4;
  let buf: Buffer | null = null;
  let contentType = 'application/octet-stream';
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          await sleep(Math.min(2 ** attempt * 500, 8000));
          continue;
        }
        throw new Error(`download ${res.status} ${res.statusText}`);
      }
      contentType = res.headers.get('content-type') ?? contentType;
      buf = Buffer.from(await res.arrayBuffer());
      break;
    } catch (e) {
      if (attempt < maxRetries) {
        await sleep(Math.min(2 ** attempt * 500, 8000));
        continue;
      }
      throw new Error(`Failed to download ${url} for ${entity}/${recordId}: ${(e as Error).message}`);
    }
  }

  // upload via wrangler r2 object put — retry transient R2 errors (e.g. code 10001
  // "internal error, please try again"), which occur under rapid sequential puts.
  const dir = mkdtempSync(join(tmpdir(), 'esp-r2-'));
  const tmp = join(dir, filename);
  writeFileSync(tmp, buf!);
  const args = [
    'wrangler',
    'r2',
    'object',
    'put',
    `${opts.bucket ?? DEFAULT_BUCKET}/${key}`,
    `--file=${tmp}`,
    '--content-type',
    contentType,
    opts.mode === 'remote' ? '--remote' : '--local',
  ];
  for (let attempt = 0; ; attempt++) {
    try {
      execFileSync('npx', args, { cwd: opts.cwd, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
      break;
    } catch (e) {
      if (attempt < maxRetries) {
        await sleep(Math.min(2 ** attempt * 500, 8000));
        continue;
      }
      throw new Error(`Failed to upload ${key} to R2 for ${entity}/${recordId} after ${maxRetries + 1} attempts: ${(e as Error).message}`);
    }
  }

  return { url: stable, uploaded: true, migrated: true, bytes: buf!.length };
}

function deriveName(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ?? 'file.bin';
  } catch {
    return 'file.bin';
  }
}
