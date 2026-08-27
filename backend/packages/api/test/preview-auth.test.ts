import { describe, it, expect } from 'vitest';
import { previewAuthorized } from '../src/index';

// The /api/preview/qmi route bypasses the publish gate. This locks down the one thing
// that must never regress: it is authorized ONLY with a configured secret + matching header.
describe('previewAuthorized (draft-preview gate)', () => {
  it('DENIES when no secret is configured (prod: PREVIEW_SECRET unset)', () => {
    expect(previewAuthorized(undefined, 'anything')).toBe(false);
    expect(previewAuthorized('', 'anything')).toBe(false);
  });

  it('DENIES when the header is absent', () => {
    expect(previewAuthorized('s3cret', null)).toBe(false);
    expect(previewAuthorized('s3cret', '')).toBe(false);
  });

  it('DENIES on a wrong secret (incl. length mismatch)', () => {
    expect(previewAuthorized('s3cret', 'nope')).toBe(false);
    expect(previewAuthorized('s3cret', 's3cre')).toBe(false);
    expect(previewAuthorized('s3cret', 's3crets')).toBe(false);
  });

  it('ALLOWS only an exact match', () => {
    expect(previewAuthorized('s3cret', 's3cret')).toBe(true);
  });
});
