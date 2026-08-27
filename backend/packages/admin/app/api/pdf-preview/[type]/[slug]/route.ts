// =============================================================================
// packages/admin — Same-origin PDF preview proxy.
//
// Purpose: the admin's theme editor shows a live iframe preview of PDF HTML.
// This route proxies through to the esperanza-pdf Worker via the PDF service
// binding, keeping the request same-origin (no CORS, no public URL needed).
//
// Auth: requires an active Auth.js session (same as all other admin pages).
//       Draft theme previews also require a signed preview token so the pdf
//       worker accepts the ?theme=draft request.
//
// Runtime: force-dynamic so the route is always evaluated (never cached).
// =============================================================================

import { type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { auth } from '@/lib/auth';
import { signPreviewToken } from '@esperanza/pdf/token';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; slug: string }> }
) {
  // Gate: require a valid Auth.js session.
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { type, slug } = await params;
  const which = req.nextUrl.searchParams.get('theme') === 'draft' ? 'draft' : 'active';

  const env = getCloudflareContext().env;

  // For draft previews, sign a short-lived HMAC token so the pdf worker accepts
  // the request. If the secret is not configured (local dev without it set) we
  // omit the token — the pdf worker's /preview route falls back gracefully.
  let tokenParam = '';
  if (which === 'draft' && env.PDF_PREVIEW_SECRET) {
    const token = await signPreviewToken(env.PDF_PREVIEW_SECRET, type, slug, 120);
    tokenParam = `&token=${encodeURIComponent(token)}`;
  }

  // Use the PDF service binding to fetch the preview HTML. The URL must be a
  // valid URL even though it's never actually fetched over the network — the
  // pdf.internal hostname is a convention for intra-Worker service bindings.
  const previewUrl = `https://pdf.internal/preview/${type}/${encodeURIComponent(slug)}?theme=${which}${tokenParam}`;
  // Use the string overload of fetch (not `new Request(...)`) to avoid the type
  // conflict between DOM Request and the CF workers-types Request.
  const pdfRes = await env.PDF.fetch(previewUrl);

  // Stream the response body back. Cast to any to bridge the CF ReadableStream
  // type vs. the DOM ReadableStream type — they're the same at runtime.
  return new Response(pdfRes.body as BodyInit | null, {
    status: pdfRes.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
