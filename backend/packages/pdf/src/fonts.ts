export interface FontDef { family: string; dataUri: string; weights: number[] }
export const FONT_ALLOWLIST: FontDef[] = [
  { family: 'Cormorant', dataUri: '', weights: [400, 600, 700] },
  { family: 'Inter', dataUri: '', weights: [400, 600] },
];
export function fontFaceCss(): string {
  return FONT_ALLOWLIST.filter((f) => f.dataUri)
    .flatMap((f) => f.weights.map((w) =>
      `@font-face{font-family:'${f.family}';font-weight:${w};src:url(${f.dataUri}) format('woff2');font-display:block;}`))
    .join('\n');
}
