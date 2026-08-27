// =============================================================================
// dropped-files — pure filtering for files dropped onto the media widgets.
//
// Drag-and-drop hands us everything Finder lets the operator grab (videos,
// zips, …); the widgets must keep only what their `accept` list allows, in the
// original drop order. Some drag sources omit the mime type, so we fall back
// to the filename extension.
// =============================================================================

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  pdf: 'application/pdf',
};

function effectiveType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? '';
}

function matches(type: string, token: string): boolean {
  if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
  return type === token;
}

/** Keep only the files allowed by an `accept` list (e.g. "image/*,application/pdf"),
 *  preserving drop order. */
export function filterAcceptedFiles(files: Iterable<File>, accept: string): File[] {
  const tokens = accept
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return [...files].filter((file) => {
    const type = effectiveType(file);
    return type !== '' && tokens.some((token) => matches(type, token));
  });
}
