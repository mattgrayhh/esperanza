import { describe, it, expect } from 'vitest';
import {
  computeTargetDimensions,
  needsProcessing,
  humanSize,
  effectiveType,
  prepareForUpload,
  MAX_UPLOAD_BYTES,
  MAX_IMAGE_EDGE,
  DOWNSCALE_OVER_BYTES,
} from '../lib/prepare-upload';

const MB = 1024 * 1024;
// Cheaply fake a File of a given size without allocating the bytes.
const file = (bytes: number, name: string, type = ''): File =>
  Object.defineProperty(new File([], name, { type }), 'size', { value: bytes }) as File;

describe('computeTargetDimensions', () => {
  it('leaves within-bounds images untouched', () => {
    expect(computeTargetDimensions(1200, 800)).toEqual({ w: 1200, h: 800 });
  });
  it('scales the longest edge to the cap, preserving aspect', () => {
    expect(computeTargetDimensions(5120, 2560)).toEqual({ w: MAX_IMAGE_EDGE, h: 1280 });
  });
  it('handles portrait orientation', () => {
    expect(computeTargetDimensions(2000, 8000)).toEqual({ w: 640, h: MAX_IMAGE_EDGE });
  });
  it('never returns a zero edge', () => {
    const { w, h } = computeTargetDimensions(10000, 3);
    expect(w).toBe(MAX_IMAGE_EDGE);
    expect(h).toBeGreaterThanOrEqual(1);
  });
});

describe('needsProcessing', () => {
  it('passes small raster images through', () => {
    expect(needsProcessing('image/jpeg', 2 * MB)).toBe(false);
  });
  it('flags large raster images for downscale', () => {
    expect(needsProcessing('image/jpeg', DOWNSCALE_OVER_BYTES + 1)).toBe(true);
  });
  it('passes small PDFs through but flags over-cap ones', () => {
    expect(needsProcessing('application/pdf', 3 * MB)).toBe(false);
    expect(needsProcessing('application/pdf', MAX_UPLOAD_BYTES + 1)).toBe(true);
  });
});

describe('effectiveType', () => {
  it('falls back to the extension when the OS omits the mime', () => {
    expect(effectiveType(file(10, 'plan.PDF'))).toBe('application/pdf');
    expect(effectiveType(file(10, 'shot.jpeg'))).toBe('image/jpeg');
  });
});

describe('humanSize', () => {
  it('formats sensibly', () => {
    expect(humanSize(12 * MB)).toBe('12 MB');
    expect(humanSize(1.5 * MB)).toBe('1.5 MB');
  });
});

describe('prepareForUpload (non-canvas paths)', () => {
  it('passes a small image through unchanged', async () => {
    const f = file(2 * MB, 'ok.jpg', 'image/jpeg');
    const res = await prepareForUpload(f);
    expect(res).toEqual({ ok: true, file: f });
  });
  it('rejects an oversized PDF with an actionable message, never hangs', async () => {
    const res = await prepareForUpload(file(30 * MB, 'brochure.pdf', 'application/pdf'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/limit is 12 MB/);
  });
  it('passes an under-cap PDF through', async () => {
    const res = await prepareForUpload(file(5 * MB, 'brochure.pdf', 'application/pdf'));
    expect(res.ok).toBe(true);
  });
});
