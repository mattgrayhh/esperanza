'use client';

// =============================================================================
// JsonBlocksEditor — cities.city_copy_blocks_json + city_venue_blocks_json widget.
//
// Both columns are FLAT { key -> value } objects (the public API parses them and drops
// absent keys). This editor edits BOTH at once (they save together via saveCityBlocks)
// and emits exactly that flat-object shape.
//
//   * Known keys render as a labeled form (CITY_COPY_BLOCK_KEYS / CITY_VENUE_BLOCK_KEYS).
//   * Keys whose VALUE is an image (isImageBlockKey: *_image, image_0, live_in_image)
//     get an inline R2 uploader (uploadBlockImage → stable URL stored as the value).
//   * Venue *_venues keys are markdown (textarea); other string keys are text/textarea.
//   * Free-key fallback: operators can add arbitrary extra keys (schema is open for copy).
//
// On save we drop blank values (matches the mapper's "absent keys dropped" rule).
//
// Re-skinned with shadcn (Card/Input/Textarea/Button). The flat key→value model,
// saveCityBlocks/uploadBlockImage calls, and the airtableusercontent preview guard are
// UNCHANGED.
// =============================================================================

import { useRef, useState, useTransition } from 'react';
import { saveCityBlocks, uploadBlockImage } from '../../lib/actions';
import { prepareForUpload } from '../../lib/prepare-upload';
import {
  CITY_COPY_BLOCK_KEYS,
  CITY_VENUE_BLOCK_KEYS,
  isImageBlockKey,
} from '../../lib/field-config';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { PlusIcon, ImageIcon, UploadIcon, RefreshCwIcon, XIcon } from 'lucide-react';

type Blocks = Record<string, string>;

const VENUE_MARKDOWN = new Set(['eat_venues', 'shop_venues', 'play_venues', 'relax_venues', 'stay_venues']);

export function JsonBlocksEditor({
  id,
  initialCopy,
  initialVenue,
  onResult,
}: {
  id: string;
  initialCopy: Blocks;
  initialVenue: Blocks;
  onResult?: (msg: string) => void;
}) {
  const [copy, setCopy] = useState<Blocks>(initialCopy);
  const [venue, setVenue] = useState<Blocks>(initialVenue);
  const [pending, startTransition] = useTransition();

  function onSave() {
    startTransition(async () => {
      const res = await saveCityBlocks(id, copy, venue);
      onResult?.(res.ok ? 'Blocks saved' : `Error: ${res.error}`);
    });
  }

  return (
    <div className="grid gap-6">
      <BlockGroup
        id={id}
        title="Copy Blocks — city_copy_blocks_json"
        knownKeys={CITY_COPY_BLOCK_KEYS}
        allowFreeKeys
        markdownKeys={undefined}
        blocks={copy}
        onChange={setCopy}
      />
      <BlockGroup
        id={id}
        title="Venue Blocks — city_venue_blocks_json"
        knownKeys={CITY_VENUE_BLOCK_KEYS}
        allowFreeKeys={false}
        markdownKeys={VENUE_MARKDOWN}
        blocks={venue}
        onChange={setVenue}
      />
      <Button type="button" onClick={onSave} disabled={pending} className="justify-self-start">
        {pending ? 'Saving…' : 'Save blocks'}
      </Button>
    </div>
  );
}

function BlockGroup({
  id,
  title,
  knownKeys,
  allowFreeKeys,
  markdownKeys,
  blocks,
  onChange,
}: {
  id: string;
  title: string;
  knownKeys: readonly string[];
  allowFreeKeys: boolean;
  markdownKeys?: ReadonlySet<string>;
  blocks: Blocks;
  onChange: (next: Blocks) => void;
}) {
  const [newKey, setNewKey] = useState('');
  // Render the known keys first (in order), then any extra keys already present.
  const extraKeys = Object.keys(blocks).filter((k) => !knownKeys.includes(k));
  const orderedKeys = [...knownKeys, ...extraKeys];

  const set = (k: string, v: string) => onChange({ ...blocks, [k]: v });
  const addKey = () => {
    const k = newKey.trim();
    if (!k || k in blocks || knownKeys.includes(k)) return;
    onChange({ ...blocks, [k]: '' });
    setNewKey('');
  };

  return (
    <Card size="sm" className="gap-3 p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid gap-2">
        {orderedKeys.map((k) => (
          <BlockRow
            key={k}
            id={id}
            blockKey={k}
            value={blocks[k] ?? ''}
            isImage={isImageBlockKey(k)}
            isMarkdown={Boolean(markdownKeys?.has(k))}
            onChange={(v) => set(k, v)}
          />
        ))}
      </div>
      {allowFreeKeys ? (
        <div className="flex gap-2">
          <Input
            placeholder="add custom key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="h-7 max-w-56 text-xs"
          />
          <Button type="button" variant="outline" size="xs" onClick={addKey}>
            <PlusIcon /> key
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function BlockRow({
  id,
  blockKey,
  value,
  isImage,
  isMarkdown,
  onChange,
}: {
  id: string;
  blockKey: string;
  value: string;
  isImage: boolean;
  isMarkdown: boolean;
  onChange: (v: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPick(file: File | undefined) {
    if (!file) return;
    setErr(null);
    startTransition(async () => {
      const prepared = await prepareForUpload(file);
      if (!prepared.ok) {
        setErr(prepared.error);
        return;
      }
      const res = await uploadBlockImage('cities', id, blockKey, prepared.file);
      if (res.ok) onChange(res.url);
      else setErr(res.error);
    });
  }

  return (
    <div className="grid grid-cols-[200px_1fr] items-start gap-3">
      <span className="self-center font-mono text-xs text-muted-foreground">{blockKey}</span>
      {isImage ? (
        // Operator DAM rule: image blocks show the IMAGE (thumbnail) + an upload/replace
        // affordance — NEVER an editable raw-URL field. The stable URL is held in state and
        // saved by saveCityBlocks; it is never surfaced as text. A stale Airtable URL (and
        // an empty value) fall back to a placeholder prompting a re-upload.
        (() => {
          const isStaleAirtable = value.includes('airtableusercontent.com');
          const hasImage = value.trim() !== '' && !isStaleAirtable;
          return (
            <div className="grid gap-1.5">
              <div className="relative flex h-20 w-28 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                {hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={value} alt={blockKey} className="h-full w-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center gap-1 px-1 text-center text-muted-foreground">
                    <ImageIcon className="size-5" />
                    <span className="text-[10px] leading-tight">
                      {isStaleAirtable ? 'Stale — re-upload' : 'No image'}
                    </span>
                  </div>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                disabled={pending}
                onChange={(e) => onPick(e.target.files?.[0])}
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  onClick={() => fileRef.current?.click()}
                >
                  {hasImage ? <RefreshCwIcon /> : <UploadIcon />}
                  {pending ? 'Uploading…' : hasImage ? 'Replace' : 'Upload'}
                </Button>
                {hasImage || isStaleAirtable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={pending}
                    onClick={() => onChange('')}
                  >
                    <XIcon />
                    Remove
                  </Button>
                ) : null}
              </div>
              {err ? <span className="text-xs text-destructive">{err}</span> : null}
            </div>
          );
        })()
      ) : isMarkdown ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} placeholder="markdown" />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
