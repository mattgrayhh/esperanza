'use client';

// =============================================================================
// ElevationGalleryEditor — like ImageGalleryEditor, but each image carries an
// ELEVATION TYPE (e.g. "Tuscan Brick", "Farmhouse"). Stores an ordered JSON array of
// { url, type } in a single hidden <input name={field}>.
//
// The type is auto-derived from the filename on add (filenames encode it ~99% of the
// time) and editable per-image via a dropdown. The live plan page renders these as a
// captioned grid (the public API emits `elevations_json`; the site renders it).
//
// UX mirrors ImageGalleryEditor (drag-drop bulk upload, reorder, remove) plus a type
// <select> under each thumbnail.
// =============================================================================

import { useRef, useState, useTransition } from 'react';
import { uploadGalleryImage } from '../../lib/actions';
import { filterAcceptedFiles } from '../../lib/dropped-files';
import { prepareForUpload } from '../../lib/prepare-upload';
import { runWithConcurrency, UPLOAD_CONCURRENCY } from '../../lib/upload-pool';
import { parseTypedGallery, deriveElevationType, ELEVATION_TYPES, type TypedImage } from '../../lib/elevation-types';
import { cn } from '@/lib/utils';
import { FieldLabel } from './FieldLabel';
import { Button } from '@/components/ui/button';
import { UploadIcon, XIcon, ChevronUpIcon, ChevronDownIcon, ImageIcon } from 'lucide-react';

const ACCEPT = 'image/*';
const AIRTABLE_HOST = 'airtableusercontent.com';

export function ElevationGalleryEditor({
  entity,
  id,
  field,
  label,
  initialValue,
  help,
}: {
  entity: string;
  id: string;
  field: string;
  label: string;
  initialValue: string;
  help?: string;
}) {
  const [items, setItems] = useState<TypedImage[]>(() => parseTypedGallery(initialValue));
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function move(index: number, dir: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const swap = index + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[index], next[swap]] = [next[swap]!, next[index]!];
      return next;
    });
  }

  function remove(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function setType(index: number, type: string) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, type } : it)));
  }

  function addFiles(picked: Iterable<File> | null | undefined) {
    if (!picked) return;
    const files = filterAcceptedFiles(picked, ACCEPT);
    if (files.length === 0) {
      setErr('Only image files can be added to the gallery.');
      return;
    }
    setErr(null);
    const baseIndex = items.length; // slot for the first new image
    setProgress({ done: 0, total: files.length });
    startTransition(async () => {
      const errors: string[] = [];
      // Collected per input slot so the gallery keeps the drop order even
      // though uploads finish out of order.
      const uploaded: (TypedImage | null)[] = files.map(() => null);
      await runWithConcurrency(files, UPLOAD_CONCURRENCY, async (file, i) => {
        try {
          const prepared = await prepareForUpload(file);
          if (!prepared.ok) {
            errors.push(prepared.error);
            return;
          }
          const res = await uploadGalleryImage(entity, id, baseIndex + i, prepared.file);
          if (res.ok) {
            // Derive the type from the ORIGINAL file's name (downscale renames it).
            const type = deriveElevationType(file.name) ?? deriveElevationType(res.url) ?? '';
            uploaded[i] = { url: res.url, type };
          } else {
            errors.push(`${file.name}: ${res.error}`);
          }
        } catch {
          errors.push(`${file.name}: upload failed`);
        } finally {
          setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        }
      });
      const added = uploaded.filter((u): u is TypedImage => u !== null);
      if (added.length > 0) setItems((prev) => [...prev, ...added]);
      if (errors.length > 0) {
        setErr(
          errors.length === 1
            ? errors[0]!
            : `${errors.length} of ${files.length} uploads failed — ${errors.join(' · ')}`
        );
      }
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    });
  }

  const serialized = JSON.stringify(items);

  return (
    <div className="grid gap-2 text-sm">
      <FieldLabel label={label} help={help} />

      {/* Hidden input carries the serialized [{url,type}] array into the form submit */}
      <input type="hidden" name={field} value={serialized} />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!pending) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'grid gap-2 rounded-lg transition-colors',
          dragOver && 'outline-2 outline-dashed outline-primary bg-primary/5'
        )}
      >
        {items.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {items.map((it, i) => {
              const isAirtable = it.url.includes(AIRTABLE_HOST);
              return (
                <div key={i} className="overflow-hidden rounded-md border border-border bg-muted/30">
                  <div className="group relative">
                    {isAirtable ? (
                      <div className="flex h-24 flex-col items-center justify-center gap-1 p-1 text-center text-muted-foreground">
                        <ImageIcon className="size-5" />
                        <span className="text-[10px]">Stale — re-upload</span>
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.url} alt={it.type || `${label} ${i + 1}`} className="h-24 w-full object-cover" />
                    )}

                    {/* Controls overlay */}
                    <div className="absolute inset-0 flex flex-col items-end justify-between p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="size-5 rounded-sm"
                        onClick={() => remove(i)}
                        title="Remove"
                      >
                        <XIcon className="size-3" />
                      </Button>
                      <div className="flex gap-0.5">
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="size-5 rounded-sm"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          title="Move up"
                        >
                          <ChevronUpIcon className="size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="size-5 rounded-sm"
                          disabled={i === items.length - 1}
                          onClick={() => move(i, 1)}
                          title="Move down"
                        >
                          <ChevronDownIcon className="size-3" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Per-image elevation type. A value not in the canonical list (custom
                      or unrecognized) is still selectable so it isn't silently dropped. */}
                  <select
                    value={it.type}
                    onChange={(e) => setType(i, e.target.value)}
                    className="w-full border-t border-border bg-background px-1.5 py-1 text-xs"
                    title="Elevation type"
                  >
                    <option value="">— type —</option>
                    {it.type && !ELEVATION_TYPES.includes(it.type) ? (
                      <option value={it.type}>{it.type}</option>
                    ) : null}
                    {ELEVATION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
            <span className="text-xs">No images yet — drag elevations here or use Add images</span>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={pending}
          onChange={(e) => addFiles(e.target.files)}
          className="hidden"
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          className="w-fit"
        >
          <UploadIcon />
          {progress
            ? `Uploading ${progress.done} of ${progress.total}…`
            : pending
              ? 'Uploading…'
              : 'Add images'}
        </Button>
      </div>

      {err ? <span className="text-xs text-destructive">{err}</span> : null}
    </div>
  );
}
