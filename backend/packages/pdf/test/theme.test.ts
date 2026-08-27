import { describe, it, expect } from 'vitest';
import { defaultTheme, themeToCssVars, parseTheme } from '../src/theme';

describe('theme', () => {
  it('themeToCssVars emits brand tokens as CSS custom properties', () => {
    const css = themeToCssVars(defaultTheme);
    expect(css).toContain('--pdf-primary: #1f3d2f');
    expect(css).toContain('--pdf-accent: #b08d57');
    expect(css).toContain('--pdf-font-heading:');
  });
  it('parseTheme fills missing keys from defaults (tolerant of partial stored JSON)', () => {
    const t = parseTheme('{"brand":{"colors":{"primary":"#000000"}}}');
    expect(t.brand.colors.primary).toBe('#000000');
    expect(t.brand.colors.accent).toBe(defaultTheme.brand.colors.accent);
    expect(t.footer.phone).toBe(defaultTheme.footer.phone);
  });
});
