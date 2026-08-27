// =============================================================================
// HelpProse — renders prebuilt help-article HTML with admin-themed typography.
// Content is repo-authored (help-content/*.md → gen:help), i.e. trusted, so
// dangerouslySetInnerHTML is acceptable per the spec. Backtick spans render as
// UI-term chips (the convention for naming controls in steps). Blockquotes are
// callouts; img is constrained for the later screenshot pass.
// =============================================================================

export function HelpProse({ html }: { html: string }) {
  return (
    <div
      className={[
        'max-w-3xl text-[15px] leading-relaxed text-foreground',
        '[&_h2]:font-heading [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold',
        '[&_h3]:font-heading [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold',
        '[&_p]:my-3',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80',
        '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6',
        '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6',
        '[&_strong]:font-semibold',
        // UI-term chips
        '[&_code]:rounded-md [&_code]:border [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-sans [&_code]:text-[13px] [&_code]:font-medium [&_code]:whitespace-nowrap',
        // callouts
        '[&_blockquote]:my-4 [&_blockquote]:rounded-md [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:bg-muted/50 [&_blockquote]:px-4 [&_blockquote]:py-2',
        // screenshot slots
        '[&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border',
      ].join(' ')}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
