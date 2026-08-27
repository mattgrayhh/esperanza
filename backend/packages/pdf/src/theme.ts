export interface Theme {
  brand: {
    logoWordmarkUrl?: string; logoMonogramUrl?: string;
    colors: { primary: string; accent: string; neutral: string; bandText: string; pageBg: string; ink: string };
    fontHeading: string; fontBody: string; fontLabel: string;
    headerPatternUrl?: string; watermarkUrl?: string;
  };
  footer: { website: string; phone: string; salesHours: string; showEqualHousingLogo: boolean; modifiedDateFormat: string };
  sectionLabels: { letterSpacing: string; case: 'upper' | 'none'; color: string };
  page: { size: 'Letter'; marginsMm: { top: number; right: number; bottom: number; left: number } };
  qmi: { appendFloorPlanPages: boolean };
  copy: { collectionIntros: Record<string, string>; esperanzaDifference: string };
  disclaimers: { community: string; qmi: string; floorplan: string; list: string };
}

export const defaultTheme: Theme = {
  brand: {
    // Vector wordmark in R2 (brand greens #244027 / gold #74613c). Used by every template
    // that isn't rendered over baked-in artwork (the QMI grid bakes the logo into its PNG).
    logoWordmarkUrl: 'https://img.hazardhouse.ai/brand/nav-logo.svg',
    colors: { primary: '#1f3d2f', accent: '#b08d57', neutral: '#888888', bandText: '#ffffff', pageBg: '#ffffff', ink: '#333333' },
    fontHeading: 'Cormorant', fontBody: 'Inter', fontLabel: 'Inter',
  },
  // phone/salesHours wording matches the brand marketing sheets verbatim (raw-digit phone,
  // long-form hours) — the QMI contact band must read exactly like the reference one-pager.
  footer: { website: 'esperanzahomes.com', phone: '9562758069', salesHours: 'Monday - Saturday 9:30 AM - 6:30 PM Sunday 12:00 PM - 6:00 PM', showEqualHousingLogo: true, modifiedDateFormat: 'MM/DD/YYYY' },
  sectionLabels: { letterSpacing: '0.2em', case: 'upper', color: '#b08d57' },
  page: { size: 'Letter', marginsMm: { top: 12, right: 12, bottom: 12, left: 12 } },
  qmi: { appendFloorPlanPages: true },
  copy: { collectionIntros: {}, esperanzaDifference: '' },
  disclaimers: { community: '', qmi: '', floorplan: '', list: '' },
};

export function parseTheme(json: string): Theme {
  let parsed: any = {};
  try { parsed = JSON.parse(json); } catch { /* fall back to defaults */ }
  const d = defaultTheme;
  return {
    brand: { ...d.brand, ...parsed.brand, colors: { ...d.brand.colors, ...(parsed.brand?.colors ?? {}) } },
    footer: { ...d.footer, ...parsed.footer },
    sectionLabels: { ...d.sectionLabels, ...parsed.sectionLabels },
    page: { ...d.page, ...parsed.page, marginsMm: { ...d.page.marginsMm, ...(parsed.page?.marginsMm ?? {}) } },
    qmi: { ...d.qmi, ...parsed.qmi },
    copy: { ...d.copy, ...parsed.copy, collectionIntros: { ...(parsed.copy?.collectionIntros ?? {}) } },
    disclaimers: { ...d.disclaimers, ...parsed.disclaimers },
  };
}

export function themeToCssVars(t: Theme): string {
  const c = t.brand.colors;
  return [
    `--pdf-primary: ${c.primary}`, `--pdf-accent: ${c.accent}`, `--pdf-neutral: ${c.neutral}`,
    `--pdf-band-text: ${c.bandText}`, `--pdf-page-bg: ${c.pageBg}`, `--pdf-ink: ${c.ink}`,
    `--pdf-font-heading: '${t.brand.fontHeading}', Georgia, serif`,
    `--pdf-font-body: '${t.brand.fontBody}', system-ui, sans-serif`,
    `--pdf-font-label: '${t.brand.fontLabel}', system-ui, sans-serif`,
    `--pdf-label-spacing: ${t.sectionLabels.letterSpacing}`, `--pdf-label-color: ${t.sectionLabels.color}`,
  ].map((s) => `  ${s};`).join('\n');
}

export async function loadActiveTheme(db: D1Database): Promise<{ theme: Theme; version: number }> {
  const row = await db.prepare(`SELECT theme_json, version FROM pdf_themes WHERE kind='active'`).first<{ theme_json: string; version: number }>();
  return { theme: parseTheme(row?.theme_json ?? '{}'), version: row?.version ?? 1 };
}
export async function loadDraftTheme(db: D1Database): Promise<{ theme: Theme; version: number }> {
  const row = await db.prepare(`SELECT theme_json, version FROM pdf_themes WHERE kind='draft'`).first<{ theme_json: string; version: number }>();
  return { theme: parseTheme(row?.theme_json ?? '{}'), version: row?.version ?? 1 };
}
