'use client';

// =============================================================================
// HoaLinksEditor — communities.hoa_links_json widget. Repeatable rows of
// { title, link }, where `link` is a PDF hosted in R2 (e.g. CCRs, amendments).
// Serializes to a JSON array of { title, link } objects. Saves via
// saveCommunityHoaLinks (drops fully-empty rows, JSON-stringifies server-side) or
// the main form Save (reads the __hoa_links hidden input). Capped at 7 rows.
//
// Each row's document is a DRAG/DROP PDF UPLOAD (uploadBlockImage → R2), not a URL
// text box. Legacy rows whose link is an external URL (e.g. the old
// framerusercontent.com PDFs) still render as an openable link so an operator can
// replace them by uploading the real PDF. Size guarding reuses prepare-upload.ts.
// =============================================================================

import { useRef, useState, useTransition } from 'react';
import { saveCommunityHoaLinks, uploadBlockImage } from '../../lib/actions';
import { prepareForUpload } from '../../lib/prepare-upload';
import { filterAcceptedFiles } from '../../lib/dropped-files';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { XIcon, PlusIcon, UploadIcon, RefreshCwIcon, FileTextIcon } from 'lucide-react';

interface HoaLink {
  title: string;
  link: string;
}

const MAX = 7;
const ACCEPT = 'application/pdf';

/** Human-readable filename from an R2/external PDF url. */
function pdfName(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : 'document.pdf';
  } catch {
    return url.split(/[?#]/)[0]?.split('/').pop() || 'document.pdf';
  }
}

export function HoaLinksEditor({
  id,
  initial,
  onResult,
  showStandaloneSave = false,
}: {
  id: string;
  initial: HoaLink[];
  onResult?: (msg: string) => void;
  /** Secondary path — main Save reads __hoa_links when false (default). */
  showStandaloneSave?: boolean;
}) {
  const [links, setLinks] = useState<HoaLink[]>(initial.length ? initial : [{ title: '', link: '' }]);
  const [pending, startTransition] = useTransition();
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const update = (i: number, patch: Partial<HoaLink>) =>
    setLinks((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setLinks((rows) => rows.filter((_, j) => j !== i));
  const add = () => setLinks((rows) => (rows.length >= MAX ? rows : [...rows, { title: '', link: '' }]));

  async function uploadPdf(i: number, file: File | undefined) {
    if (!file) return;
    setErr(null);
    setUploadingIndex(i);
    try {
      const prepared = await prepareForUpload(file);
      if (!prepared.ok) {
        setErr(prepared.error);
        return;
      }
      const res = await uploadBlockImage('communities', id, `hoa-${i}`, prepared.file);
      if (res.ok) update(i, { link: res.url });
      else setErr(res.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed — please retry.');
    } finally {
      setUploadingIndex(null);
      const input = inputRefs.current[i];
      if (input) input.value = '';
    }
  }

  function onDropPdf(i: number, files: FileList) {
    const accepted = filterAcceptedFiles(files, ACCEPT);
    if (accepted.length === 0) {
      setErr('Drop a PDF file here.');
      return;
    }
    void uploadPdf(i, accepted[0]);
  }

  function onSave() {
    startTransition(async () => {
      const res = await saveCommunityHoaLinks(id, links);
      onResult?.(res.ok ? 'HOA links saved' : `Error: ${res.error}`);
    });
  }

  return (
    <div className="grid gap-3">
      <input type="hidden" name="__hoa_links" value={JSON.stringify(links)} />
      <div className="grid gap-2">
        {links.map((l, i) => {
          const uploading = uploadingIndex === i;
          return (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-2">
              <Input
                placeholder="Document title (e.g. Phase 1 CCRs)"
                value={l.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />

              <div>
                <input
                  ref={(el) => {
                    inputRefs.current[i] = el;
                  }}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => uploadPdf(i, e.target.files?.[0])}
                />
                {l.link ? (
                  <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                    <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                    <a
                      href={l.link}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-xs hover:underline"
                      title={l.link}
                    >
                      {pdfName(l.link)}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => inputRefs.current[i]?.click()}
                      disabled={uploading}
                      aria-label="Replace PDF"
                    >
                      {uploading ? <Spinner className="size-3.5" /> : <RefreshCwIcon />}
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => inputRefs.current[i]?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragIndex(i);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node) && dragIndex === i) setDragIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragIndex(null);
                      if (!uploading) onDropPdf(i, e.dataTransfer.files);
                    }}
                    disabled={uploading}
                    className={
                      'flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-2 py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground ' +
                      (dragIndex === i ? 'border-primary bg-primary/5 text-foreground' : 'border-border')
                    }
                  >
                    {uploading ? (
                      <>
                        <Spinner className="size-3.5" /> Uploading…
                      </>
                    ) : (
                      <>
                        <UploadIcon className="size-3.5" /> Upload PDF (or drop)
                      </>
                    )}
                  </button>
                )}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => remove(i)}
                aria-label="Remove row"
                className="text-muted-foreground hover:text-destructive"
              >
                <XIcon />
              </Button>
            </div>
          );
        })}
      </div>

      {err ? <span className="text-xs text-destructive">{err}</span> : null}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={links.length >= MAX}>
          <PlusIcon /> Add document
        </Button>
        {showStandaloneSave ? (
          <Button type="button" size="sm" onClick={onSave} disabled={pending}>
            {pending ? 'Saving…' : 'Save HOA links'}
          </Button>
        ) : null}
      </div>
      {links.length >= MAX ? (
        <span className="text-xs text-muted-foreground">Max {MAX} links are shown on the site.</span>
      ) : null}
    </div>
  );
}
