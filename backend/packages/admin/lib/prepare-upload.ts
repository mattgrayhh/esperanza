// =============================================================================
// prepare-upload — client-side guard + downscale run BEFORE any image upload.
//
// Why this exists: uploads go through a Next.js Server Action whose body is capped
// at 15mb (next.config.ts serverActions.bodySizeLimit). An over-limit body is
// rejected at the framework transport layer — it never comes back as a resolved
// `{ ok:false }` or a thrown error — so the uploader's spinner spins forever
// ("sat 8-10 minutes, wouldn't proceed"). See docs/esperanza/06-module-images.md.
//
// Fix at the source, shared by every uploader (ImageUploader, ImageGalleryEditor,
// ElevationGalleryEditor): an oversized RASTER image is canvas-downscaled to web
// size so it fits comfortably under the cap; an oversized non-image (PDF, svg, gif)
// is rejected with a clear, actionable message instead of hanging. Files already
// small enough pass through untouched — no re-encode, no quality loss.
// =============================================================================

const MB = 1024 * 1024;

/** Payload ceiling. Kept well under next.config's 15mb server-action limit because
 *  the multipart action envelope adds overhead on top of the raw file bytes. */
export const MAX_UPLOAD_BYTES = 12 * MB;

/** Longest-edge bound for downscaled images. Website display never needs more. */
export const MAX_IMAGE_EDGE = 2560;

/** Raster images larger than this are downscaled even when their dimensions are
 *  modest (a big JPEG re-encodes much smaller). Below this they upload as-is. */
export const DOWNSCALE_OVER_BYTES = 8 * MB;

/** Canvas-encodable raster types. Everything else (svg, gif, pdf) is passed through
 *  if it fits or rejected if it doesn't — we never rasterize/flatten those. */
const ENCODABLE = /^image\/(jpeg|png|webp|avif)$/;

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

/** Best-effort mime for a file whose `type` the OS left blank (common on drag-drop). */
export function effectiveType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? '';
}

export function humanSize(bytes: number): string {
  const mb = bytes / MB;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** Aspect-preserving target dimensions bounded by `maxEdge`. Pure. */
export function computeTargetDimensions(
  w: number,
  h: number,
  maxEdge = MAX_IMAGE_EDGE
): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge || longest === 0) return { w, h };
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** True when a file must be processed before it can safely be uploaded. Pure. */
export function needsProcessing(type: string, bytes: number): boolean {
  if (ENCODABLE.test(type)) return bytes > DOWNSCALE_OVER_BYTES;
  return bytes > MAX_UPLOAD_BYTES; // non-encodable: only an issue if over the cap
}

function swapExt(name: string, outType: string): string {
  const ext = outType === 'image/png' ? 'png' : 'jpg';
  return name.replace(/\.[^.]+$/, '') + '.' + ext;
}

async function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error('canvas encode failed');
  return blob;
}

/** Downscale a raster image to web size via canvas. Preserves PNG (alpha) when the
 *  source is PNG; otherwise emits JPEG. Falls back to JPEG if a PNG result is still
 *  over the cap. Browser-only (uses createImageBitmap + canvas). */
async function downscaleImage(file: File, type: string): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const { w, h } = computeTargetDimensions(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('no 2d canvas context');
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const preferPng = type === 'image/png';
  let outType = preferPng ? 'image/png' : 'image/jpeg';
  let blob = await encode(canvas, outType, preferPng ? undefined : 0.85);

  // A downscaled PNG photo can still be large; JPEG is the reliable fallback.
  if (blob.size > MAX_UPLOAD_BYTES && outType === 'image/png') {
    outType = 'image/jpeg';
    blob = await encode(canvas, outType, 0.85);
  }
  return new File([blob], swapExt(file.name, outType), { type: outType });
}

export type PreparedUpload = { ok: true; file: File } | { ok: false; error: string };

/**
 * Make a picked file safe to send through the upload Server Action, or reject it
 * with an actionable message. Never returns a file larger than MAX_UPLOAD_BYTES.
 */
export async function prepareForUpload(file: File): Promise<PreparedUpload> {
  const type = effectiveType(file);

  if (!needsProcessing(type, file.size)) return { ok: true, file };

  // Non-encodable (PDF, SVG, GIF) over the cap — we can't shrink it here.
  if (!ENCODABLE.test(type)) {
    return {
      ok: false,
      error: `"${file.name}" is ${humanSize(file.size)} — the upload limit is ${humanSize(
        MAX_UPLOAD_BYTES
      )}. Please compress it and try again.`,
    };
  }

  try {
    const downsized = await downscaleImage(file, type);
    if (downsized.size > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        error: `Couldn't shrink "${file.name}" below ${humanSize(MAX_UPLOAD_BYTES)} (it's ${humanSize(
          downsized.size
        )}). Please resize or compress it and try again.`,
      };
    }
    return { ok: true, file: downsized };
  } catch {
    return { ok: false, error: `Couldn't process "${file.name}". Please try a smaller image.` };
  }
}
