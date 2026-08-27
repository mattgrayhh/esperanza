'use client';

// =============================================================================
// RichTextEditor — the universal TRUE WYSIWYG editor for ALL rich-text fields
// (community description/amenities, the floor-plan *_rich copy blocks, city venue
// copy, blog content, etc.). Replaces the lightweight markdown RichTextField so the
// sales team gets headings, bullet/numbered lists, bold/italic, links, quotes, and
// inline images everywhere — entered visually, no markdown syntax to learn.
//
// Output: safe HTML. TipTap's ProseMirror schema (StarterKit + Link + Image)
// CONSTRAINS the output to the tag subset the site's rich text supports
// (h1-h4,p,strong,em,a,ul,ol,li,blockquote,br,img); pasted markup with unknown
// nodes/marks is dropped. saveEntity also sanitizes server-side as a second line.
//
// STORAGE CONTRACT: the value travels via a HIDDEN <input name={field}>, synced to
// editor.getHTML() on every update. Empty doc → '' (saveEntity coerces '' → NULL).
//
// LEGACY LOAD: most existing `*_rich`/description/amenities values are MARKDOWN
// ("- bullet", "**bold**"). toEditorHtml() converts markdown → HTML on load (TipTap
// parses HTML, not markdown) so authors see real formatting. On save the field is
// rewritten as HTML; the public API's htmlFt passes HTML through and still converts any
// not-yet-migrated markdown — so the swap is backward compatible during the rollout.
//
// INLINE IMAGE UPLOAD requires a record id (R2 key = <entity>/<id>/…). When `id` is
// absent (a few detail screens render fields without it) the image button is hidden;
// all text formatting still works.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { uploadGalleryImage } from '../../lib/actions';
import { prepareForUpload } from '../../lib/prepare-upload';
import { toEditorHtml } from '../../lib/markdown';
import { FieldLabel } from './FieldLabel';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  ImageIcon,
} from 'lucide-react';

const ACCEPT = 'image/*';

/** TipTap content styles — explicit (no @tailwindcss/typography prose plugin). */
export const RICH_EDITOR_CONTENT_CLASS = [
  'min-h-[12rem] max-w-none px-3 py-2 text-sm leading-relaxed text-foreground focus:outline-none',
  '[&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold',
  '[&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold',
  '[&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold',
  '[&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold',
  '[&_p]:my-2',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5',
  '[&_li]:pl-0.5',
  '[&_strong]:font-semibold',
  '[&_em]:italic',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_a]:text-primary [&_a]:underline',
  '[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs',
].join(' ');

function displayLabel(label: string): string {
  return label.replace(/\s*\(md\)\s*$/i, '').trim();
}

function ToolbarDivider() {
  return <Separator orientation="vertical" className="mx-0.5 h-5" />;
}

/** Re-render toolbar when the cursor moves or doc changes so block/mark toggles track selection. */
function useEditorToolbarRevision(editor: Editor | null): void {
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const bump = () => setRevision((n) => n + 1);
    editor.on('selectionUpdate', bump);
    editor.on('transaction', bump);
    return () => {
      editor.off('selectionUpdate', bump);
      editor.off('transaction', bump);
    };
  }, [editor]);
}

function RichTextToolbar({
  editor,
  canUpload,
  uploading,
  onPickImageClick,
  onSetLink,
}: {
  editor: Editor | null;
  canUpload: boolean;
  uploading: boolean;
  onPickImageClick: () => void;
  onSetLink: (ed: Editor) => void;
}) {
  useEditorToolbarRevision(editor);

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border/60 bg-muted/30 px-2 py-1.5"
    >
      <div
        role="group"
        aria-label="Block style for current line"
        className="inline-flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5"
      >
        <TbSegment
          label="Body"
          active={editor?.isActive('paragraph') ?? false}
          onClick={() => editor?.chain().focus().setParagraph().run()}
        />
        <TbSegment
          label="H2"
          active={editor?.isActive('heading', { level: 2 }) ?? false}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <TbSegment
          label="H3"
          active={editor?.isActive('heading', { level: 3 }) ?? false}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        />
      </div>

      <ToolbarDivider />

      <div role="group" aria-label="Text style" className="flex items-center gap-0.5">
        <TbButton
          label="Bold"
          active={editor?.isActive('bold') ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <BoldIcon />
        </TbButton>
        <TbButton
          label="Italic"
          active={editor?.isActive('italic') ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <ItalicIcon />
        </TbButton>
      </div>

      <ToolbarDivider />

      <div role="group" aria-label="Lists" className="flex items-center gap-0.5">
        <TbButton
          label="Bullet list"
          active={editor?.isActive('bulletList') ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <ListIcon />
        </TbButton>
        <TbButton
          label="Numbered list"
          active={editor?.isActive('orderedList') ?? false}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrderedIcon />
        </TbButton>
      </div>

      <ToolbarDivider />

      <div role="group" aria-label="Insert" className="flex items-center gap-0.5">
        <TbButton
          label="Blockquote"
          active={editor?.isActive('blockquote') ?? false}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <QuoteIcon />
        </TbButton>
        <TbButton
          label="Link"
          active={editor?.isActive('link') ?? false}
          onClick={() => editor && onSetLink(editor)}
        >
          <LinkIcon />
        </TbButton>
        {canUpload ? (
          <TbButton
            label="Insert image"
            disabled={uploading || !editor}
            onClick={onPickImageClick}
          >
            <ImageIcon />
          </TbButton>
        ) : null}
      </div>

      {uploading ? (
        <span className="ml-auto text-xs text-muted-foreground">Uploading…</span>
      ) : null}
    </div>
  );
}

/** Text-labeled block style (Body / H2 / H3). */
function TbSegment({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-md px-2 py-0.5 text-xs font-medium transition-[color,background-color,box-shadow] duration-150',
        active
          ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
          : 'text-muted-foreground hover:text-foreground'
      )}
      aria-label={label === 'Body' ? 'Body text for current line' : `Heading ${label.slice(1)} for current line`}
      aria-pressed={active}
      title={label === 'Body' ? 'Body text (current line)' : `Heading ${label.slice(1)} (current line)`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** Icon toolbar toggle. `active` reflects the editor's current mark/node. */
function TbButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn(
        'text-muted-foreground hover:text-foreground',
        active && 'bg-brand/10 text-brand hover:bg-brand/15 hover:text-brand'
      )}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function RichTextEditor({
  field,
  label,
  value,
  help,
  entity,
  id,
}: {
  field: string;
  label: string;
  value: string;
  help?: string;
  /** entity segment + record id — needed to key inline-image R2 uploads. When `id`
   *  is empty the image button is hidden (text formatting still works). */
  entity?: string;
  id?: string;
}) {
  // Markdown/plain legacy values → HTML so TipTap shows real formatting (see header).
  const initialHtml = toEditorHtml(value);
  // HTML mirror submitted via the hidden input.
  const [html, setHtml] = useState(initialHtml);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const imgIndex = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const htmlDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canUpload = Boolean(entity && id);

  const editor = useEditor({
    extensions: [
      // levels [1,2,3,4]: H4 stays in the schema so legacy "####" survives a round-trip,
      // but the toolbar only exposes Body + H2/H3 (H1/H4 remain in schema for legacy HTML).
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      }),
      Image.configure({ inline: false }),
    ],
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: RICH_EDITOR_CONTENT_CLASS,
        'aria-label': displayLabel(label),
      },
    },
    onUpdate: ({ editor: ed }) => {
      const next = ed.isEmpty ? '' : ed.getHTML();
      if (htmlDebounceRef.current) clearTimeout(htmlDebounceRef.current);
      htmlDebounceRef.current = setTimeout(() => setHtml(next), 280);
    },
    onBlur: ({ editor: ed }) => {
      if (htmlDebounceRef.current) clearTimeout(htmlDebounceRef.current);
      setHtml(ed.isEmpty ? '' : ed.getHTML());
    },
  });

  useEffect(() => {
    return () => {
      if (htmlDebounceRef.current) clearTimeout(htmlDebounceRef.current);
    };
  }, []);

  const setLink = useCallback((ed: Editor) => {
    const prev = ed.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url === null) return;
    if (url === '') {
      ed.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    ed.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, []);

  const onPickImage = useCallback(
    async (file: File | undefined | null) => {
      if (!file || !editor || !entity || !id) return;
      setErr(null);
      setUploading(true);
      try {
        const prepared = await prepareForUpload(file);
        if (!prepared.ok) {
          setErr(prepared.error);
          return;
        }
        const res = await uploadGalleryImage(entity, id, imgIndex.current++, prepared.file);
        if (res.ok) editor.chain().focus().setImage({ src: res.url, alt: file.name }).run();
        else setErr(res.error);
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [editor, entity, id]
  );

  return (
    <div className="grid gap-1.5 text-sm">
      {displayLabel(label) ? (
        <FieldLabel label={displayLabel(label)} help={help} />
      ) : null}

      <input type="hidden" name={field} value={html} />

      <div className="rounded-[10px] border border-border/60 bg-background shadow-sm">
        <RichTextToolbar
          editor={editor}
          canUpload={canUpload}
          uploading={uploading}
          onPickImageClick={() => fileRef.current?.click()}
          onSetLink={setLink}
        />

        {canUpload ? (
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => onPickImage(e.target.files?.[0])}
          />
        ) : null}

        <EditorContent editor={editor} />
      </div>

      {err ? <span className="text-xs text-destructive">{err}</span> : null}
    </div>
  );
}
