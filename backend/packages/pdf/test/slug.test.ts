import { describe, it, expect } from 'vitest';
import { slugFor, r2KeyFor, publicUrlFor } from '../src/slug';
import type { Env } from '../src/env';

const env = { PDF_PUBLIC_BASE_URL: 'https://media.example.com' } as Env;

describe('slug helpers', () => {
  it('community slug prefers slug column, falls back to id', () => {
    expect(slugFor('community', { slug: 'anaqua-at-tres-lagos', id: 'recC1' })).toBe('anaqua-at-tres-lagos');
    expect(slugFor('community', { slug: null, id: 'recC1' })).toBe('recc1');
  });
  it('qmi slug falls back slug -> housenumber -> id', () => {
    expect(slugFor('qmi', { slug: null, housenumber: '00000149', id: 'recQ' })).toBe('00000149');
  });
  it('r2 key is keyed on the immutable entity id', () => {
    expect(r2KeyFor('community', 'recC1')).toBe('pdf/community/recC1.pdf');
  });
  it('publicUrl joins base + type + slug', () => {
    expect(publicUrlFor(env, 'community', 'anaqua')).toBe('https://media.example.com/pdf/community/anaqua');
  });
});
