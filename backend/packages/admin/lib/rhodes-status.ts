// =============================================================================
// packages/admin — Rhodes Living unit-status presentation (client-safe, no deps).
//
// Mirrors the STATUS_LABELS / STATUS_COLORS maps and the override <select> options
// in rhodes-living-worker/src/index.ts so the native admin shows the SAME labels the
// public rhodesliving.com site renders. Several canonical statuses collapse to the
// same public label on purpose (e.g. both notice_unrented and vacant_not_ready read
// as "Coming Soon"; everything occupied/leased reads as "Unavailable").
// =============================================================================

import type { RhodesStatus } from './rhodes-client';

export const RHODES_STATUS_LABEL: Record<RhodesStatus, string> = {
  vacant_ready: 'Available Now',
  vacant_not_ready: 'Coming Soon',
  notice_unrented: 'Coming Soon',
  model_home: 'Model Home',
  occupied_no_notice: 'Unavailable',
  vacant_rented: 'Unavailable',
  other: 'Unavailable',
};

/** Tailwind badge classes per status (matches the worker admin's palette). */
export const RHODES_STATUS_BADGE: Record<RhodesStatus, string> = {
  vacant_ready: 'bg-emerald-100 text-emerald-800',
  vacant_not_ready: 'bg-amber-100 text-amber-800',
  notice_unrented: 'bg-blue-100 text-blue-800',
  model_home: 'bg-purple-100 text-purple-800',
  occupied_no_notice: 'bg-slate-100 text-slate-500',
  vacant_rented: 'bg-slate-100 text-slate-500',
  other: 'bg-slate-100 text-slate-500',
};

/** A unit counts as "available" (the stats card) when it's vacant and ready. */
export function isAvailable(status: RhodesStatus): boolean {
  return status === 'vacant_ready';
}

/** Options for the override Status <select>. Empty value = keep the Snowflake status. */
export const RHODES_STATUS_OPTIONS: { value: '' | RhodesStatus; label: string }[] = [
  { value: '', label: '— Keep Snowflake status —' },
  { value: 'vacant_ready', label: 'Available Now' },
  { value: 'vacant_not_ready', label: 'Coming Soon' },
  { value: 'notice_unrented', label: 'Coming Soon (Notice)' },
  { value: 'model_home', label: 'Model Home' },
  { value: 'occupied_no_notice', label: 'Unavailable' },
  { value: 'vacant_rented', label: 'Unavailable (Leased)' },
];
