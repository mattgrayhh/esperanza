import { describe, it, expect } from 'vitest';
import { routeRest } from '../src/rest';

describe('rest routing', () => {
  it('parses a records-by-collection path', () => {
    const r = routeRest(new URL('https://x/api/data/records/qmi'));
    expect(r).toEqual({ kind: 'list', collection: 'qmi' });
  });
  it('parses a single-record path', () => {
    const r = routeRest(new URL('https://x/api/data/records/qmi/rec123'));
    expect(r).toEqual({ kind: 'get', collection: 'qmi', id: 'rec123' });
  });
  it('parses recent-changes and sync-status', () => {
    expect(routeRest(new URL('https://x/api/data/recent-changes'))!.kind).toBe('recent');
    expect(routeRest(new URL('https://x/api/data/sync-status'))!.kind).toBe('sync');
  });
  it('returns null for unknown paths', () => {
    expect(routeRest(new URL('https://x/api/data/nope'))).toBeNull();
  });
});
