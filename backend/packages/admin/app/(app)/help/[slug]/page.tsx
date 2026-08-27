// =============================================================================
// Help article — /help/[slug] (SERVER COMPONENT). Renders prebuilt HTML with
// HelpProse; "More in <category>" footer links same-category siblings.
// Spec: docs/specs/2026-06-06-help-wiki-design.md
// =============================================================================

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeftIcon, BookOpenIcon } from 'lucide-react';
import { HELP_ARTICLES } from '@/lib/help-content.generated';
import { HelpProse } from '@/components/help/HelpProse';

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = HELP_ARTICLES.find((a) => a.slug === slug);
  if (!article) notFound();

  const related = HELP_ARTICLES.filter(
    (a) => a.category === article.category && a.slug !== article.slug
  );

  return (
    <div className="space-y-6 p-6">
      <Link
        href="/help"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Help &amp; Docs
      </Link>

      <div>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {article.category}
        </p>
        <h1 className="font-heading mt-1 text-2xl font-semibold text-foreground">
          {article.title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{article.summary}</p>
      </div>

      <HelpProse html={article.html} />

      {related.length > 0 ? (
        <div className="max-w-3xl border-t pt-5">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            More in {article.category}
          </h2>
          <ul className="space-y-1.5">
            {related.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/help/${a.slug}`}
                  className="inline-flex items-center gap-2 text-sm text-primary underline-offset-2 hover:underline"
                >
                  <BookOpenIcon className="size-3.5" />
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
