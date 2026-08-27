import { describe, expect, it } from 'vitest';
import {
  classifyPromoBannerStyle,
  listingPromoBannerText,
  promoBannerStyleFromCopy,
} from '../lib/promo-banner-style';

describe('classifyPromoBannerStyle', () => {
  it('returns green for 4.99% rate promos', () => {
    expect(classifyPromoBannerStyle('4.99% 30 Year Fixed Rate*')).toBe('green');
    expect(classifyPromoBannerStyle('4.99% Rate + up to $5,000 in Closing Costs')).toBe('green');
  });

  it('returns green for 4.99 even when flex is also mentioned', () => {
    expect(
      classifyPromoBannerStyle('4.99% Interest Rate OR up to $20,000 Flex Cash!')
    ).toBe('green');
  });

  it('returns gold for flex promos', () => {
    expect(classifyPromoBannerStyle('UNLOCK YOUR 10K FLEX DISCOUNT NOW!')).toBe('gold');
    expect(classifyPromoBannerStyle('Unlock Your $20K Flex Discount Now!')).toBe('gold');
    expect(classifyPromoBannerStyle('Enjoy $15,000 in a Flex Discount!')).toBe('gold');
  });

  it('returns green for non-rate, non-flex copy', () => {
    expect(classifyPromoBannerStyle('Eligible for Homebuyer Advantage Program')).toBe('green');
  });
});

describe('promoBannerStyleFromCopy', () => {
  it('returns green when 4.99 appears in any field', () => {
    expect(promoBannerStyleFromCopy('', '4.99% Rate')).toBe('green');
    expect(promoBannerStyleFromCopy('Unlock flex', '4.99% 30 Year Fixed Rate*')).toBe('green');
  });
});

describe('listingPromoBannerText', () => {
  it('prefers per-home incentive over resolved promo_text', () => {
    expect(listingPromoBannerText('stale flex', '4.99% 30 Year Fixed Rate*')).toBe('stale flex');
  });

  it('falls back to promo_text when incentive is empty', () => {
    expect(listingPromoBannerText('', '4.99% 30 Year Fixed Rate*')).toBe(
      '4.99% 30 Year Fixed Rate*'
    );
  });
});
