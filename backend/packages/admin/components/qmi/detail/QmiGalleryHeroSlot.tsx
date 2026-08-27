'use client';

import { useRef, useState, useTransition } from 'react';
import { uploadGalleryImage } from '@/lib/actions';
import { filterAcceptedFiles } from '@/lib/dropped-files';
import { cn } from '@/lib/utils';
import { ImageIcon, UploadIcon } from 'lucide-react';

const ACCEPT = 'image/*';
const AIRTABLE_HOST = 'airtableusercontent.com';

export function QmiGalleryHeroSlot({
  entity,
  id,
  index,
  label,
  url,
  onUrlChange,
  className,
}: {
  entity: string;
  id: string;
  /** Position in photo_gallery_json — live site uses [1] and [2] for the header column. */
  index: number;
  label: string;
  url: string;
  onUrlChange: (index: number, nextUrl: string) => void;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isAirtable = url.includes(AIRTABLE_HOST);
  const hasImage = url !== '' && !isAirtable;

  function onPick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    startTransition(async () => {
      try {
        const res = await uploadGalleryImage(entity, id, index, file);
        if (res.ok) onUrlChange(index, res.url);
        else setErr(res.error);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Upload failed');
      } finally {
        if (fileRef.current) fileRef.current.value = '';
      }
    });
  }

  return (
    <div
      className={cn(
        'group/slot relative min-h-0 overflow-hidden rounded-xl border bg-card ring-1 ring-foreground/10',
        !hasImage && 'border-dashed bg-muted/30',
        className
      )}
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
        if (!pending) {
          const files = filterAcceptedFiles(e.dataTransfer.files, ACCEPT);
          if (files[0]) onPick(files[0]);
        }
      }}
    >
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
          <ImageIcon className="size-8 opacity-50" />
          <span className="text-xs">{isAirtable ? 'Stale image — drop to replace' : `Drop image for ${label}`}</span>
        </div>
      )}

      <div
        className={cn(
          'pointer-events-none absolute inset-0 transition-colors',
          dragOver && 'bg-primary/10 ring-2 ring-inset ring-primary',
          hasImage && !dragOver && 'group-hover/slot:bg-black/10'
        )}
      />

      <div className="absolute left-2 top-2 z-10 opacity-0 transition-opacity group-hover/slot:opacity-100">
        <span className="rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          {label}
        </span>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => fileRef.current?.click()}
        className={cn(
          'absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 rounded-md border border-white/30 bg-black/45 px-2 py-1 text-[11px] font-medium text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/60 group-hover/slot:opacity-100',
          pending && 'opacity-100'
        )}
      >
        <UploadIcon className="size-3" />
        {pending ? 'Uploading…' : hasImage ? 'Replace' : 'Upload'}
      </button>

      {err ? (
        <p className="absolute bottom-2 left-2 z-10 max-w-[80%] truncate rounded bg-destructive/90 px-2 py-0.5 text-[10px] text-white">
          {err}
        </p>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        disabled={pending}
        onChange={(e) => onPick(e.target.files?.[0])}
        className="hidden"
      />
    </div>
  );
}
