'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { uploadGalleryImage } from '../../lib/actions';
import { filterAcceptedFiles } from '../../lib/dropped-files';
import { prepareForUpload } from '../../lib/prepare-upload';
import { runWithConcurrency, UPLOAD_CONCURRENCY } from '../../lib/upload-pool';
import { parseGalleryUrls } from '../../lib/gallery-urls';
import { cn } from '@/lib/utils';
import { FieldLabel } from './FieldLabel';
import { Button } from '@/components/ui/button';
import { UploadIcon, XIcon, ImageIcon, GripVerticalIcon, CheckIcon, PlusIcon } from 'lucide-react';

const ACCEPT = 'image/*';

const AIRTABLE_HOST = 'airtableusercontent.com';

export function ImageGalleryEditor({
  entity,
  id,
  field,
  label,
  initialValue,
  help,
  compact = false,
  galleryUrls: controlledUrls,
  onGalleryUrlsChange,
  suggestions,
  suggestionsLabel = 'From the floor plan',
  suggestionsHelp = 'Master-plan photos. Click to add to (or remove from) this home’s gallery.',
  suggestionGroups,
}: {
  entity: string;
  id: string;
  field: string;
  label: string;
  initialValue: string;
  help?: string;
  compact?: boolean;
  /** When set, gallery order is owned by the parent (e.g. QMI site header slots). */
  galleryUrls?: string[];
  onGalleryUrlsChange?: (urls: string[]) => void;
  /** Inherited photos (e.g. the assigned floor plan's) offered as a selectable palette.
   *  A suggestion is "selected" when its url is present in the gallery; clicking toggles
   *  it in/out. Upload path is unchanged. */
  suggestions?: string[];
  suggestionsLabel?: string;
  suggestionsHelp?: string;
  /** Multiple labeled inherit palettes (e.g. plan Interior vs Exterior). When set, takes
   *  precedence over the single `suggestions`. Each group toggles into the same gallery. */
  suggestionGroups?: Array<{ label: string; help?: string; urls: string[] }>;
}) {
  const [internalUrls, setInternalUrls] = useState<string[]>(() => parseGalleryUrls(initialValue));
  const controlled = controlledUrls !== undefined && onGalleryUrlsChange !== undefined;
  const urls = controlled ? controlledUrls! : internalUrls;

  function applyUrls(update: string[] | ((prev: string[]) => string[])) {
    const next = typeof update === 'function' ? update(urls) : update;
    if (controlled) onGalleryUrlsChange!(next);
    else setInternalUrls(next);
  }

  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!controlled) setInternalUrls(parseGalleryUrls(initialValue));
  }, [initialValue, controlled]);

  function reorder(from: number, to: number) {
    if (from === to) return;
    applyUrls((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });
  }

  function remove(index: number) {
    applyUrls((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleSuggestion(url: string) {
    applyUrls((prev) => (prev.includes(url) ? prev.filter((u) => u !== url) : [...prev, url]));
  }

  function addAll(groupUrls: string[]) {
    applyUrls((prev) => [...prev, ...groupUrls.filter((u) => !prev.includes(u))]);
  }

  // One render path for both the single `suggestions` palette and multi `suggestionGroups`.
  const groups =
    suggestionGroups && suggestionGroups.length > 0
      ? suggestionGroups.filter((g) => g.urls.length > 0)
      : suggestions && suggestions.length > 0
        ? [{ label: suggestionsLabel, help: suggestionsHelp, urls: suggestions }]
        : [];

  function addFiles(picked: Iterable<File> | null | undefined) {
    if (!picked) return;
    const files = filterAcceptedFiles(picked, ACCEPT);
    if (files.length === 0) {
      setErr('Only image files can be added to the gallery.');
      return;
    }
    setErr(null);
    const baseIndex = urls.length;
    setProgress({ done: 0, total: files.length });
    startTransition(async () => {
      const errors: string[] = [];
      // Collected per input slot so the gallery keeps the drop order even
      // though uploads finish out of order.
      const uploaded: (string | null)[] = files.map(() => null);
      await runWithConcurrency(files, UPLOAD_CONCURRENCY, async (file, i) => {
        try {
          const prepared = await prepareForUpload(file);
          if (!prepared.ok) {
            errors.push(prepared.error);
            return;
          }
          const res = await uploadGalleryImage(entity, id, baseIndex + i, prepared.file);
          if (res.ok) uploaded[i] = res.url;
          else errors.push(`${file.name}: ${res.error}`);
        } catch {
          errors.push(`${file.name}: upload failed`);
        } finally {
          setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        }
      });
      const added = uploaded.filter((u): u is string => u !== null);
      if (added.length > 0) applyUrls((prev) => [...prev, ...added]);
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

  const serialized = JSON.stringify(urls);
  const showControls = compact ? true : undefined;

  return (
    <div className="grid gap-2 text-sm">
      <FieldLabel label={label} help={help} />

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
        {urls.length > 0 ? (
          <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-3 sm:grid-cols-4')}>
            {urls.map((url, i) => {
              const isAirtable = url.includes(AIRTABLE_HOST);
              const isDragging = dragIndex === i;
              const isDropTarget = dropIndex === i && dragIndex !== null && dragIndex !== i;
              return (
                <div
                  key={`${i}-${url}`}
                  draggable={!pending}
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragIndex !== null && dragIndex !== i) setDropIndex(i);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node) && dropIndex === i) {
                      setDropIndex(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragIndex !== null) reorder(dragIndex, i);
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                  className={cn(
                    'group relative overflow-hidden rounded-md border border-border bg-muted/30',
                    isDragging && 'opacity-50',
                    isDropTarget && 'ring-2 ring-primary ring-offset-1'
                  )}
                >
                  {isAirtable ? (
                    <div className="flex h-24 flex-col items-center justify-center gap-1 p-1 text-center text-muted-foreground">
                      <ImageIcon className="size-5" />
                      <span className="text-[10px]">Stale — re-upload</span>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={`${label} ${i + 1}`} className="h-24 w-full object-cover" draggable={false} />
                  )}

                  <div
                    className={cn(
                      'absolute inset-0 flex flex-col items-end justify-between p-0.5 transition-opacity',
                      showControls ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    )}
                  >
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
                    <span
                      className={cn(
                        'inline-flex size-5 items-center justify-center rounded-sm bg-background/80 text-muted-foreground',
                        !compact && 'opacity-0 group-hover:opacity-100'
                      )}
                      title="Drag to reorder"
                    >
                      <GripVerticalIcon className="size-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border px-4 py-2 text-center text-muted-foreground">
            <span className="text-xs text-balance">No images yet — drag photos here or use Add images</span>
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

      {groups.map((group, gi) => {
        const unselected = group.urls.filter((u) => !urls.includes(u));
        return (
          <div key={`grp-${gi}-${group.label}`} className="grid gap-2 rounded-lg border border-dashed border-border p-2">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel label={group.label} help={group.help} />
              {unselected.length > 0 ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => addAll(group.urls)} className="h-7">
                  Add all
                </Button>
              ) : null}
            </div>
            <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-3 sm:grid-cols-4')}>
              {group.urls.map((url, i) => {
                const selected = urls.includes(url);
                return (
                  <button
                    key={`sug-${gi}-${i}-${url}`}
                    type="button"
                    onClick={() => toggleSuggestion(url)}
                    aria-pressed={selected}
                    title={selected ? 'In gallery — click to remove' : 'Click to add to gallery'}
                    className={cn(
                      'group relative overflow-hidden rounded-md border bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      selected ? 'border-primary ring-2 ring-primary ring-offset-1' : 'border-border opacity-80 hover:opacity-100'
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`${group.label} ${i + 1}`} className="h-24 w-full object-cover" draggable={false} />
                    <span
                      className={cn(
                        'absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-sm text-white',
                        selected ? 'bg-primary' : 'bg-background/80 text-muted-foreground'
                      )}
                    >
                      {selected ? <CheckIcon className="size-3" /> : <PlusIcon className="size-3" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {err ? <span className="text-xs text-destructive">{err}</span> : null}
    </div>
  );
}
