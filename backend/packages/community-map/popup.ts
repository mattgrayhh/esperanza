export interface MapCommunity {
  id: string;
  name: string;
  town: string;
  state: string;
  priceFrom: number | null;
  image?: string;
  url?: string;
  comingSoon?: boolean;
  promoBadgeText?: string;
  masterPlanned: boolean;
  coordinates: [number, number]; // [lng, lat]
}

export interface PopupOptions {
  showIncentiveBanner?: boolean;
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createCommunityPopupHTML(c: MapCommunity, opts: PopupOptions = {}): string {
  const priceAmount = c.priceFrom ? `$${Number(c.priceFrom).toLocaleString()}` : '';
  const cityState = `${c.town || ''}${c.town && c.state ? ', ' : ''}${c.state || ''}`;
  const href = escapeHtml(c.url || '#');
  const badge = c.comingSoon
    ? `<span class="qmi-popup-badge qmi-popup-badge--soon">Coming Soon</span>`
    : opts.showIncentiveBanner && c.promoBadgeText
      ? `<span class="qmi-popup-badge qmi-popup-badge--promo">${escapeHtml(c.promoBadgeText)}</span>`
      : '';
  return `
        <a class="qmi-popup" href="${href}">
            ${c.image ? `<div class="qmi-popup-imgwrap"><img class="qmi-popup-img" src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" loading="lazy" />${badge}</div>` : ''}
            <div class="qmi-popup-body">
                <div class="qmi-popup-info">
                    <div class="qmi-popup-title">${escapeHtml(c.name ?? '')}</div>
                    <div class="qmi-popup-location">${escapeHtml(cityState)}</div>
                </div>
                ${priceAmount ? `<div class="qmi-popup-price-block"><div class="qmi-popup-price-label">From</div><div class="qmi-popup-price">${priceAmount}</div></div>` : ''}
            </div>
        </a>
    `;
}
