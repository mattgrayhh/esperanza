import { describe, expect, it } from 'vitest';
import { classifyPromoBannerStyle } from '@esperanza/db/promo-banner-style';

describe('QMI listing card promo banner colors', () => {
  it('classifies 4.99% rate copy as green', () => {
    expect(classifyPromoBannerStyle('4.99% 30 Year Fixed Rate*')).toBe('green');
  });

  it('classifies flex copy as gold', () => {
    expect(classifyPromoBannerStyle('Unlock Your $20K Flex Discount Now!')).toBe('gold');
  });
});
