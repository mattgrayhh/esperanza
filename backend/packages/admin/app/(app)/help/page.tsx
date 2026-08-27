// =============================================================================
// Help & Docs — /help (SERVER COMPONENT). Static-segment override beats the
// [entity] catch-all. Articles are compiled into the bundle at build time
// (gen:help) — no DB read. Spec: docs/specs/2026-06-06-help-wiki-design.md
// =============================================================================

import { HELP_ARTICLES } from '@/lib/help-content.generated';
import { HelpIndex } from '@/components/help/HelpIndex';

export const metadata = { title: 'Help & Docs — Esperanza Admin' };

export default function HelpPage() {
  // Strip html bodies — the index/search only needs the light fields.
  const articles = HELP_ARTICLES.map(({ slug, title, category, summary, keywords }) => ({
    slug,
    title,
    category,
    summary,
    keywords,
  }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">Help &amp; Docs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How-to guides for everything in this admin — homes, communities,
          blogs, promotions, and how changes reach esperanzahomes.com.
        </p>
      </div>
      <HelpIndex articles={articles} />
    </div>
  );
}
