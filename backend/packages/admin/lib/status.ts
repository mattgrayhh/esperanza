// =============================================================================
// Status model (feedback [16][17][27][41][45]). DERIVED from the publish columns.
// Migration 0005 standardized every gate onto `published`:
//   * location entities (qmi/communities/floor_plans): published + coming_soon
//       → Draft / Coming Soon / Live  ("Coming Soon" = on the site, coming-soon state)
//   * blogs: published + publish_date → Draft / Scheduled / Published
//       ("Scheduled" is derived from a future publish_date; not directly settable)
//   * promotions: published → Draft / Live  (gate renamed from `active` in 0005)
//   * testimonials: published → Draft / Live (gate moved from the `status` text column
//       to a real `published` boolean in 0005; `status` is now informational)
// One generic setStatus() server action writes the right columns per gate.
// =============================================================================

import type { EntityKey } from './entities';

export type StatusGate = 'location' | 'blog' | 'promotion' | 'testimonial' | null;

/** Which status track an entity uses (null = no publish gate: collections/images). */
export function statusGate(key: EntityKey): StatusGate {
  switch (key) {
    case 'qmi':
    case 'communities':
    case 'floor_plans':
    // Cities use the SAME publish/coming-soon model as the other location entities
    // (migration 0005 gave cities `published` + `coming_soon`). They are GENERIC
    // field-builder forms, so the only thing that surfaces the publish gate as a
    // header control is being on the 'location' track here (build-edit-view derives
    // the tri-state Status dropdown solely from statusGate). `cities.status` stays a
    // demoted informational text field; this `published`+`coming_soon` gate is the
    // real publish/draft control. setStatus('cities', …) writes both columns.
    case 'cities':
      return 'location';
    case 'blogs':
      return 'blog';
    case 'promotions':
      return 'promotion';
    case 'testimonials':
      return 'testimonial';
    default:
      return null;
  }
}

export const LOCATION_STATUS = ['Draft', 'Coming Soon', 'Live'];
export const BLOG_STATUS = ['Draft', 'Published']; // 'Scheduled' is display-only (future date)
export const PROMOTION_STATUS = ['Draft', 'Live'];
export const TESTIMONIAL_STATUS = ['Live', 'Draft'];

/** Options the operator can pick in the status control. */
export function statusOptions(gate: StatusGate): string[] {
  switch (gate) {
    case 'location':
      return LOCATION_STATUS;
    case 'blog':
      return BLOG_STATUS;
    case 'promotion':
      return PROMOTION_STATUS;
    case 'testimonial':
      return TESTIMONIAL_STATUS;
    default:
      return [];
  }
}

export interface StatusInputs {
  published?: boolean;
  comingSoon?: boolean;
  status?: string | null;
  publishDate?: string | null;
  /** ISO 'now' for the blog Scheduled check (pass once per request). */
  now?: string;
}

/** Display status from raw column values. */
export function deriveStatus(gate: StatusGate, v: StatusInputs): string {
  switch (gate) {
    case 'location':
      if (!v.published) return 'Draft';
      return v.comingSoon ? 'Coming Soon' : 'Live';
    case 'blog':
      if (!v.published) return 'Draft';
      if (v.publishDate && v.now && v.publishDate > v.now) return 'Scheduled';
      return 'Published';
    case 'promotion':
      // gate renamed active→published in 0005; promotions read the published column.
      return v.published ? 'Live' : 'Draft';
    case 'testimonial':
      // gate moved from `status` text to the `published` boolean in 0005.
      return v.published ? 'Live' : 'Draft';
    default:
      return '';
  }
}

/** Column patch (snake_case keys) for a chosen status — the write side of setStatus. */
export function statusPatch(gate: StatusGate, status: string): Record<string, unknown> {
  switch (gate) {
    case 'location':
      if (status === 'Draft') return { published: false, coming_soon: false };
      if (status === 'Coming Soon') return { published: true, coming_soon: true };
      return { published: true, coming_soon: false };
    case 'blog':
      return { published: status === 'Published' };
    case 'promotion':
      return { published: status === 'Live' };
    case 'testimonial':
      // write the real gate; `status` text is informational and left untouched here.
      return { published: status === 'Live' };
    default:
      return {};
  }
}

/** Visual tone for a status badge/dot. */
export function statusTone(status: string): 'live' | 'pending' | 'draft' {
  if (status === 'Live' || status === 'Published') return 'live';
  if (status === 'Coming Soon' || status === 'Scheduled') return 'pending';
  return 'draft';
}
