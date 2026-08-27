'use client';

import { useRef, useState, useTransition } from 'react';
import { uploadImage } from '../../lib/actions';
import { filterAcceptedFiles } from '../../lib/dropped-files';
import { prepareForUpload } from '../../lib/prepare-upload';
import { cn } from '@/lib/utils';
import { FieldLabel } from './FieldLabel';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@/components/ui/attachment';
import { Spinner } from '@/components/ui/spinner';
import { ImageIcon, UploadIcon, RefreshCwIcon, XIcon, FileTextIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

const AIRTABLE_HOST = 'airtableusercontent.com';
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif'];
const ACCEPT = 'image/*,application/pdf';

function isImageUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0] ?? '';
  const file = path.split('/').pop() ?? '';
  if (!file.includes('.')) return true;
  const ext = file.split('.').pop()!.toLowerCase();
  return IMAGE_EXTS.includes(ext);
}

function fileName(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : 'file';
  } catch {
    return url.split(/[?#]/)[0]?.split('/').pop() || 'file';
  }
}

function fileKindLabel(url: string, isDoc: boolean): string {
  if (isDoc) return 'PDF';
  const path = url.split(/[?#]/)[0] ?? '';
  const ext = path.split('.').pop()?.toUpperCase();
  return ext && ext.length <= 5 ? ext : 'Image';
}

/** Prefer the field label when the stored key is an opaque R2 upload hash. */
function displayTitle(label: string, url: string, hasFile: boolean, isDoc: boolean): string {
  if (!hasFile) return label;
  const name = fileName(url);
  if (!isDoc && (!name.includes('.') || name.length > 36)) return label;
  return name;
}

export function ImageUploader({
  entity,
  id,
  field,
  label,
  initialUrl,
  fallbackPreviewUrl,
  help,
  compact = false,
  onUrlChange,
}: {
  entity: string;
  id: string;
  field: string;
  label: string;
  initialUrl: string;
  /** Shown when `initialUrl` is blank — preview only, not submitted or persisted. */
  fallbackPreviewUrl?: string;
  help?: string;
  compact?: boolean;
  /** Called when the stored URL changes (upload / clear) so parents can mirror preview state. */
  onUrlChange?: (url: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  function setStoredUrl(next: string) {
    setUrl(next);
    onUrlChange?.(next);
  }

  function syncHiddenInput(next: string) {
    setStoredUrl(next);
    setErr(null);
  }

  function onPick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    startTransition(async () => {
      try {
        const prepared = await prepareForUpload(file);
        if (!prepared.ok) {
          setErr(prepared.error);
          return;
        }
        const res = await uploadImage(entity, id, field, prepared.file);
        if (res.ok) {
          setStoredUrl(res.url);
        } else {
          setErr(res.error);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Upload failed — please retry.');
      } finally {
        if (fileRef.current) fileRef.current.value = '';
      }
    });
  }

  function onDrop(files: Iterable<File>) {
    const accepted = filterAcceptedFiles(files, ACCEPT);
    if (accepted.length === 0) {
      setErr('Drop an image (or PDF) file here.');
      return;
    }
    onPick(accepted[0]);
  }

  const isAirtable = url.includes(AIRTABLE_HOST);
  const inheritedPreview = url === '' && Boolean(fallbackPreviewUrl?.trim());
  const previewUrl = url || fallbackPreviewUrl || '';
  const hasFile = previewUrl !== '' && !isAirtable;
  const isDocField = /download|brochure|pdf/i.test(field);
  const isDoc = hasFile && (isDocField || !isImageUrl(previewUrl));
  const hasImage = hasFile && !isDoc;
  const isLogoField = /logo/i.test(field) || /logo/i.test(label);
  // Floor-plan / layout diagrams are wide, not square — center-cropping them (the default
  // aspect-square + object-cover) hides most of the plan. Show them "contained" (uncropped)
  // like logos, matching how the live site renders floor_plan_image.
  const isDiagram = isLogoField || /floor_?plan/i.test(field) || /floor\s*plan/i.test(label);
  // Rail (`compact`): full-width vertical preview. Main form: compact horizontal row.
  const useVerticalImage = !isDocField && compact;

  const attachmentState = pending
    ? 'uploading'
    : err || isAirtable
      ? 'error'
      : hasFile
        ? 'done'
        : 'idle';

  const title = pending
    ? displayTitle(label, url, Boolean(url), isDoc)
    : isAirtable
      ? label
      : displayTitle(label, url, hasFile, isDoc);

  const description = pending
    ? 'Uploading…'
    : err
      ? err
      : isAirtable
        ? 'Stale — re-upload'
        : hasFile
          ? inheritedPreview
            ? 'From floor plan'
            : fileKindLabel(previewUrl, isDoc)
          : useVerticalImage
            ? 'Drop an image or click to upload'
            : 'Drag here or upload';

  const size = useVerticalImage ? 'sm' : compact ? 'xs' : 'sm';
  const showAttachmentContent = !(useVerticalImage && hasFile);

  return (
    <div className="grid gap-1.5 text-sm">
      <FieldLabel label={label} help={help} />

      <input ref={hiddenRef} type="hidden" name={field} value={isAirtable ? '' : url} />

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
          if (!pending) onDrop(e.dataTransfer.files);
        }}
        className={cn(dragOver && 'rounded-xl ring-2 ring-primary ring-offset-2')}
      >
        <Attachment
          size={size}
          state={attachmentState}
          orientation={useVerticalImage ? 'vertical' : 'horizontal'}
          className={cn('min-w-0', useVerticalImage ? 'w-full max-w-full' : 'w-full max-w-md')}
        >
          <AttachmentMedia
            variant={hasImage ? 'image' : 'icon'}
            className={cn(
              useVerticalImage && 'w-full',
              isDiagram &&
                'bg-muted/50 [&_img]:!aspect-auto [&_img]:h-full [&_img]:w-full [&_img]:!object-contain [&_img]:p-2',
              isDiagram && useVerticalImage && 'aspect-[4/3]'
            )}
          >
            {pending ? (
              <Spinner />
            ) : hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={label} />
            ) : isDoc ? (
              <FileTextIcon />
            ) : (
              <ImageIcon />
            )}
          </AttachmentMedia>

          {showAttachmentContent ? (
            <AttachmentContent>
              <AttachmentTitle>{title}</AttachmentTitle>
              <AttachmentDescription>{description}</AttachmentDescription>
            </AttachmentContent>
          ) : null}

          <AttachmentActions>
            {hasFile && !inheritedPreview ? (
              <AttachmentAction
                type="button"
                aria-label={`Remove ${title}`}
                disabled={pending}
                onClick={() => {
                  syncHiddenInput('');
                  hiddenRef.current?.dispatchEvent(new Event('input', { bubbles: true }));
                }}
              >
                <XIcon />
              </AttachmentAction>
            ) : null}
            <AttachmentAction
              type="button"
              aria-label={
                inheritedPreview
                  ? `Upload override for ${label}`
                  : hasFile
                    ? `Replace ${title}`
                    : `Upload ${label}`
              }
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              {pending ? (
                <Spinner className="size-3.5" />
              ) : hasFile && !inheritedPreview ? (
                <RefreshCwIcon />
              ) : (
                <UploadIcon />
              )}
            </AttachmentAction>
          </AttachmentActions>

          {hasFile ? (
            <AttachmentTrigger
              render={
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${label}`}
                />
              }
            />
          ) : (
            <AttachmentTrigger
              type="button"
              aria-label={`Upload ${label}`}
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            />
          )}
        </Attachment>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        disabled={pending}
        onChange={(e) => onPick(e.target.files?.[0])}
        className="hidden"
      />

      {inheritedPreview ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-fit"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
        >
          <UploadIcon className="size-3.5" />
          Upload / Replace to override
        </Button>
      ) : null}
    </div>
  );
}
