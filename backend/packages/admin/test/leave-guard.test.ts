import { describe, expect, it } from 'vitest';
import {
  isSameDocumentLink,
  resolveInternalHrefFromParts,
} from '../components/record-edit/leave-guard';

const origin = 'https://admin.example.com';

function anchor(attrs: Record<string, string>) {
  return {
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
    hasAttribute(name: string) {
      return name in attrs;
    },
    target: attrs.target ?? '',
  };
}

describe('leave-guard helpers', () => {
  it('ignores hash-only, external, download, and new-tab links', () => {
    expect(isSameDocumentLink(anchor({ href: '#section-map' }))).toBe(false);
    expect(isSameDocumentLink(anchor({ href: 'https://other.example.com/x' }))).toBe(true);
    expect(isSameDocumentLink(anchor({ href: '/communities', download: '' }))).toBe(false);
    expect(isSameDocumentLink(anchor({ href: '/communities', target: '_blank' }))).toBe(false);
  });

  it('resolves same-origin internal paths and skips the current page', () => {
    expect(
      resolveInternalHrefFromParts('/communities', origin, '/communities/abc', '', ''),
    ).toBe('/communities');
    expect(
      resolveInternalHrefFromParts('/communities/abc', origin, '/communities/abc', '', ''),
    ).toBe(null);
    expect(
      resolveInternalHrefFromParts('/communities/abc#map', origin, '/communities/abc', '', '#overview'),
    ).toBe('/communities/abc#map');
  });

  it('ignores external origins', () => {
    expect(
      resolveInternalHrefFromParts('https://www.esperanzahomes.com/live', origin, '/communities/abc', '', ''),
    ).toBe(null);
  });
});
