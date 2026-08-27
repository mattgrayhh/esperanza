'use client';

import { useRef, useState, useTransition, useEffect } from 'react';
import { uploadImage } from '../../lib/actions';
import { filterAcceptedFiles } from '../../lib/dropped-files';
import { cn } from '@/lib/utils';
import { ImageIcon, UploadIcon } from 'lucide-react';

const ACCEPT = 'image/*';
const AIRTABLE_HOST = 'airtableusercontent.com';

export function HeroImageSlot({
  entity,
  id,
  field,
  label,
  initialUrl,
  fallbackPreviewUrl,
  className,
  imageFit = 'cover',
  overlay,
  onUrlChange,
}: {
  entity: string;
  id: string;
  field: string;
  label: string;
  initialUrl: string;
  /** Preview-only when `initialUrl` is blank (not submitted on save). */
  fallbackPreviewUrl?: string;
  className?: string;
  imageFit?: 'cover' | 'contain';
  overlay?: React.ReactNode;
  /** Called when the submitted url changes (upload or external initialUrl sync). */
  onUrlChange?: (url: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUrl(initialUrl);
  }, [initialUrl, field]);

  const isAirtable = url.includes(AIRTABLE_HOST);
  const inheritedPreview = url === '' && Boolean(fallbackPreviewUrl?.trim());
  const previewUrl = url || fallbackPreviewUrl || '';
  const hasImage = previewUrl !== '' && !isAirtable;

  function applyUrl(next: string) {
    setUrl(next);
    onUrlChange?.(next);
  }

  function onPick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    startTransition(async () => {
      try {
        const res = await uploadImage(entity, id, field, file);
        if (res.ok) applyUrl(res.url);
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
      <input type="hidden" name={field} value={isAirtable ? '' : url} />

      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt={label}
          className={cn(
            'absolute inset-0 size-full',
            imageFit === 'contain' ? 'object-contain p-2' : 'object-cover'
          )}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
          <ImageIcon className="size-8 opacity-50" />
          <span className="text-xs">{isAirtable ? 'Stale image — drop to replace' : `Drop image for ${label}`}</span>
        </div>
      )}

      {overlay}

      <div
        className={cn(
          'pointer-events-none absolute inset-0 transition-colors',
          dragOver && 'bg-primary/10 ring-2 ring-inset ring-primary',
          hasImage && !dragOver && 'group-hover/slot:bg-black/10'
        )}
      />

      <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 opacity-0 transition-opacity group-hover/slot:opacity-100">
        <span className="rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          {inheritedPreview ? `${label} (from plan)` : label}
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
