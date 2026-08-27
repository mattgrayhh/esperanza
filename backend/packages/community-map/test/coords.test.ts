import { describe, it, expect } from 'vitest';
import { parseCoords } from '../coords';

describe('parseCoords', () => {
  it('parses "lat,lng" into [lng,lat]', () => {
    expect(parseCoords('26.2034,-98.2306')).toEqual([-98.2306, 26.2034]);
  });
  it('tolerates whitespace', () => {
    expect(parseCoords(' 26.2 , -98.2 ')).toEqual([-98.2, 26.2]);
  });
  it('returns null for malformed input', () => {
    expect(parseCoords('')).toBeNull();
    expect(parseCoords('26.2')).toBeNull();
    expect(parseCoords('a,b')).toBeNull();
  });
});
