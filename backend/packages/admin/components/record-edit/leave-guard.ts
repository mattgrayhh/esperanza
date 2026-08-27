export type PendingLeave = { href: string } | { type: 'back' };

export function isSameDocumentLink(anchor: Pick<HTMLAnchorElement, 'getAttribute' | 'hasAttribute' | 'target'>): boolean {
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return false;
  if (anchor.hasAttribute('download')) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  return true;
}

export function resolveInternalHrefFromParts(
  href: string,
  origin: string,
  pathname: string,
  search: string,
  hash: string,
): string | null {
  if (href.startsWith('#') || href.startsWith('javascript:')) return null;
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return null;
    const target = `${url.pathname}${url.search}${url.hash}`;
    const current = `${pathname}${search}${hash}`;
    if (target === current) return null;
    return target;
  } catch {
    return null;
  }
}

export function resolveInternalHref(anchor: HTMLAnchorElement, location: Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'>): string | null {
  if (!isSameDocumentLink(anchor)) return null;
  const href = anchor.getAttribute('href');
  if (!href) return null;
  return resolveInternalHrefFromParts(href, location.origin, location.pathname, location.search, location.hash);
}
