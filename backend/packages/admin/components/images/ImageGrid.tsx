'use client';

// =============================================================================
// ImageGrid — the IMAGES Digital Asset Manager (DAM) grid (client). Adapted from the
// bundui file-manager visual into a responsive grid of asset TILES: each tile shows the
// r2.dev thumbnail, the filename, light metadata (plan / elevation / updated), and a
// hover action menu (Open · Replace · Edit details · Copy URL · Delete).
//
// CRITICAL DAM CONTRACT (operator): assets are UPLOADED/REPLACED as files with an INLINE
// PREVIEW — a raw URL is NEVER shown or typed as the source of truth. "Copy URL" is a
// convenience for pasting an asset elsewhere; it copies to the clipboard but never
// surfaces an editable URL field. All writes go through server actions:
//   · upload (new)     → createImageAsset(formData)         (create images row + R2 put)
//   · replace (re-up)  → uploadImage('images', id, 'file_url', file)  (same images id)
//   · delete           → deleteImageAsset(id)
// The list itself is fetched SERVER-SIDE (RSC → buildImagesLibrary); this component only
// renders it and triggers the actions, then router.refresh() to re-read.
//
// Re-skinned with shadcn (Button/Card/Dialog/DropdownMenu/Input/Badge) + lucide icons.
// =============================================================================

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createImageAsset, uploadImage, deleteImageAsset } from '../../lib/actions';
import { prepareForUpload } from '../../lib/prepare-upload';
import { runWithConcurrency, UPLOAD_CONCURRENCY } from '../../lib/upload-pool';
import type { ImageAsset } from '../../lib/images-library';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ImageIcon,
  UploadCloudIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Trash2Icon,
  CopyIcon,
  CheckIcon,
  PencilLineIcon,
  ExternalLinkIcon,
  SearchIcon,
  AlertTriangleIcon,
} from 'lucide-react';

export function ImageGrid({
  assets,
  truncated,
}: {
  assets: ImageAsset[];
  truncated: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImageAsset | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ImageAsset | null>(null);

  const uploadRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTargetId = useRef<string | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? assets.filter((a) =>
        [a.filename, a.slug, a.planName, a.caption, a.elevation, a.id]
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
    : assets;

  // --- upload (new assets) — one createImageAsset call per file ---------------
  function onUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const list = Array.from(files);
    setProgress({ done: 0, total: list.length });
    startTransition(async () => {
      const errors: string[] = [];
      await runWithConcurrency(list, UPLOAD_CONCURRENCY, async (file) => {
        try {
          const prepared = await prepareForUpload(file);
          if (!prepared.ok) {
            errors.push(prepared.error);
            return;
          }
          const fd = new FormData();
          fd.set('file', prepared.file);
          const res = await createImageAsset(fd);
          if (!res.ok) errors.push(`${file.name}: ${res.error}`);
        } catch {
          errors.push(`${file.name}: upload failed`);
        } finally {
          setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        }
      });
      if (errors.length > 0) {
        setError(
          errors.length === 1
            ? errors[0]!
            : `${errors.length} of ${list.length} uploads failed — ${errors.join(' · ')}`
        );
      }
      setProgress(null);
      if (uploadRef.current) uploadRef.current.value = '';
      router.refresh();
    });
  }

  // --- replace (re-upload to the SAME images id via uploadImage) --------------
  function onReplaceFile(file: File | undefined) {
    const id = replaceTargetId.current;
    if (!file || !id) return;
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const prepared = await prepareForUpload(file);
      if (!prepared.ok) {
        setError(prepared.error);
        setBusyId(null);
        replaceTargetId.current = null;
        if (replaceRef.current) replaceRef.current.value = '';
        return;
      }
      const res = await uploadImage('images', id, 'file_url', prepared.file);
      if (!res.ok) setError(res.error);
      setBusyId(null);
      replaceTargetId.current = null;
      if (replaceRef.current) replaceRef.current.value = '';
      router.refresh();
    });
  }

  function triggerReplace(id: string) {
    replaceTargetId.current = id;
    replaceRef.current?.click();
  }

  function onDelete(asset: ImageAsset) {
    setError(null);
    setBusyId(asset.id);
    startTransition(async () => {
      const res = await deleteImageAsset(asset.id);
      if (!res.ok) setError(res.error);
      setBusyId(null);
      setConfirmDelete(null);
      router.refresh();
    });
  }

  async function copyUrl(asset: ImageAsset) {
    if (!asset.url) return;
    try {
      await navigator.clipboard.writeText(asset.url);
      setCopiedId(asset.id);
      setTimeout(() => setCopiedId((c) => (c === asset.id ? null : c)), 1500);
    } catch {
      setError('Could not copy to clipboard');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
            Images
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Digital asset library. Upload or drag files in — each becomes a stable, public asset.
            Replace or delete from any tile. You never handle a raw URL.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search assets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-56 pl-8"
            />
          </div>
          <Button onClick={() => uploadRef.current?.click()} disabled={pending}>
            <UploadCloudIcon />
            {progress ? `Uploading ${progress.done} of ${progress.total}…` : pending ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </header>

      {/* hidden file inputs (upload + replace) */}
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={pending}
        onChange={(e) => onUploadFiles(e.target.files)}
      />
      <input
        ref={replaceRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={pending}
        onChange={(e) => onReplaceFile(e.target.files?.[0])}
      />

      {/* ── Prominent dropzone ───────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => uploadRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onUploadFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 px-6 py-8 text-center transition-colors',
          'hover:border-primary/50 hover:bg-muted/40',
          dragOver && 'border-primary bg-primary/5',
          pending && 'pointer-events-none opacity-60'
        )}
      >
        <UploadCloudIcon className="size-7 text-muted-foreground" />
        <div className="text-sm font-medium text-foreground">
          {progress
            ? `Uploading ${progress.done} of ${progress.total}…`
            : pending
              ? 'Uploading…'
              : 'Drop images here or click to upload'}
        </div>
        <div className="text-xs text-muted-foreground">
          PNG, JPG, WebP, AVIF — multiple files supported. Stored as stable public assets.
        </div>
      </button>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangleIcon className="size-4 shrink-0" />
          {error}
        </div>
      ) : null}

      {/* ── Asset grid ───────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <ImageIcon className="size-10 text-muted-foreground/60" />
          <div className="text-sm font-medium text-foreground">
            {q ? 'No assets match your search.' : 'No images yet.'}
          </div>
          {!q ? (
            <Button variant="outline" size="sm" onClick={() => uploadRef.current?.click()}>
              <UploadCloudIcon />
              Upload your first asset
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {filtered.map((asset) => (
            <AssetTile
              key={asset.id}
              asset={asset}
              busy={busyId === asset.id && pending}
              copied={copiedId === asset.id}
              onOpen={() => setPreview(asset)}
              onReplace={() => triggerReplace(asset.id)}
              onCopy={() => copyUrl(asset)}
              onDelete={() => setConfirmDelete(asset)}
            />
          ))}
        </div>
      )}

      {truncated ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing the first 500 assets. Use search to narrow down.
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          {assets.length} asset{assets.length === 1 ? '' : 's'}
        </p>
      )}

      {/* ── Lightbox preview ─────────────────────────────────────────── */}
      <Dialog open={preview != null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          {preview ? (
            <>
              <DialogHeader>
                <DialogTitle className="truncate">{preview.filename}</DialogTitle>
                <DialogDescription className="font-mono text-xs">{preview.id}</DialogDescription>
              </DialogHeader>
              <div className="flex max-h-[60vh] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                {preview.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview.url}
                    alt={preview.caption || preview.filename}
                    className="max-h-[60vh] w-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                    <ImageIcon className="size-8" />
                    <span className="text-sm">
                      {preview.staleAirtable ? 'Stale Airtable image — replace it' : 'No image'}
                    </span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Meta label="Slug" value={preview.slug} />
                <Meta label="Plan" value={preview.planName} />
                <Meta label="Elevation" value={preview.elevation} />
                <Meta label="Updated" value={preview.updatedAt} />
                {preview.caption ? (
                  <div className="col-span-2">
                    <Meta label="Caption" value={preview.caption} />
                  </div>
                ) : null}
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  variant="outline"
                  onClick={() => {
                    triggerReplace(preview.id);
                    setPreview(null);
                  }}
                >
                  <RefreshCwIcon />
                  Replace
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => copyUrl(preview)} disabled={!preview.url}>
                    {copiedId === preview.id ? <CheckIcon /> : <CopyIcon />}
                    {copiedId === preview.id ? 'Copied' : 'Copy URL'}
                  </Button>
                  <Button render={<Link href={`/images/${preview.id}`} />} variant="default">
                    <PencilLineIcon />
                    Edit details
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ──────────────────────────────────────── */}
      <Dialog open={confirmDelete != null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          {confirmDelete ? (
            <>
              <DialogHeader>
                <DialogTitle>Delete asset?</DialogTitle>
                <DialogDescription>
                  This removes <span className="font-medium">{confirmDelete.filename}</span> from the
                  library. This can&rsquo;t be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => onDelete(confirmDelete)}
                  disabled={pending}
                >
                  <Trash2Icon />
                  {pending ? 'Deleting…' : 'Delete'}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-foreground">
        {value || <span className="text-muted-foreground/60">—</span>}
      </span>
    </div>
  );
}

function AssetTile({
  asset,
  busy,
  copied,
  onOpen,
  onReplace,
  onCopy,
  onDelete,
}: {
  asset: ImageAsset;
  busy: boolean;
  copied: boolean;
  onOpen: () => void;
  onReplace: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const hasImage = asset.url !== '';
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md">
      {/* Thumbnail (click → lightbox) */}
      <button
        type="button"
        onClick={onOpen}
        className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-muted/30"
        aria-label={`Preview ${asset.filename}`}
      >
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.url}
            alt={asset.caption || asset.filename}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageIcon className="size-6" />
            <span className="px-2 text-center text-[10px] leading-tight">
              {asset.staleAirtable ? 'Stale Airtable — replace' : 'No image'}
            </span>
          </div>
        )}
        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-xs font-medium">
            Working…
          </div>
        ) : null}
        {asset.staleAirtable ? (
          <Badge variant="destructive" className="absolute left-2 top-2 h-5">
            stale
          </Badge>
        ) : null}
      </button>

      {/* Meta + actions */}
      <div className="flex items-start gap-1 p-2.5">
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-sm font-medium text-foreground"
            title={asset.caption || asset.filename}
          >
            {asset.caption || asset.filename}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {asset.planName || asset.elevation || asset.slug || '—'}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Asset actions" />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpen}>
              <ExternalLinkIcon />
              Open preview
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onReplace}>
              <RefreshCwIcon />
              Replace file
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={`/images/${asset.id}`} />}>
              <PencilLineIcon />
              Edit details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCopy} disabled={!hasImage}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? 'Copied URL' : 'Copy URL'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
