'use client';

// =============================================================================
// Help & Docs index — category sections + instant client-side search over the
// manifest (title / summary / keywords / category, case-insensitive).
// Spec: docs/specs/2026-06-06-help-wiki-design.md
// =============================================================================

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SearchIcon, BookOpenIcon, ChevronRightIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

export interface HelpIndexArticle {
  slug: string;
  title: string;
  category: string;
  summary: string;
  keywords: string[];
}

export function HelpIndex({ articles }: { articles: HelpIndexArticle[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return articles;
    return articles.filter((a) =>
      [a.title, a.summary, a.category, ...a.keywords].some((s) =>
        s.toLowerCase().includes(q)
      )
    );
  }, [articles, query]);

  // Preserve manifest order (already category-sorted) while grouping.
  const grouped = useMemo(() => {
    const out: { category: string; items: HelpIndexArticle[] }[] = [];
    for (const a of filtered) {
      const last = out[out.length - 1];
      if (last && last.category === a.category) last.items.push(a);
      else out.push({ category: a.category, items: [a] });
    }
    return out;
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search how-tos… (e.g. promotion, photos, publish)"
          className="pl-9"
          aria-label="Search help articles"
        />
      </div>

      {grouped.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No articles match “{query}”. Try a different word — or ask a Full
          Admin to add the topic.
        </p>
      ) : (
        grouped.map((group) => (
          <section key={group.category}>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {group.category}
            </h2>
            <Card>
              <CardContent className="divide-y p-0">
                {group.items.map((a) => (
                  <Link
                    key={a.slug}
                    href={`/help/${a.slug}`}
                    className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <BookOpenIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">{a.title}</span>
                      <span className="block truncate text-sm text-muted-foreground">{a.summary}</span>
                    </span>
                    <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
