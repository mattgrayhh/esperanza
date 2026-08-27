export const COMMUNITY_MAP_CSS = `
:root {
  --qmi-dark-green: #295135;
  --qmi-green: #407e52;
  --qmi-green-light: #e9edea;
  --qmi-green-cta: #dfefe4;
  --qmi-tan: #85754e;
  --qmi-text: #3c3c3c;
  --qmi-text-light: #636464;
  --qmi-white: #fff;
  --qmi-border: #dee2e6;
  --qmi-font-bodoni: 'Bodoni', 'Arapey', Georgia, serif;
  --qmi-font-overpass: 'Overpass', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --qmi-popup-width: 280px;
}

.qmi-pin-wrap { background: transparent !important; border: none !important; }

.qmi-pin-teardrop {
    display: block;
    pointer-events: none;
}

.qmi-pin {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--qmi-dark-green);
    outline: 2px solid #fff;
    outline-offset: -2px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transform: translateZ(0);
}

.qmi-pin-mpc {
    width: 34px;
    height: 34px;
}
.qmi-pin-house {
    width: 60%;
    height: 60%;
    pointer-events: none;
    display: block;
}

.qmi-cluster-wrap { background: transparent !important; border: none !important; }
.qmi-cluster-icon {
    border-radius: 50%;
    color: #fff;
    font: 700 13px var(--qmi-font-overpass);
    display: flex;
    align-items: center;
    justify-content: center;
}

.leaflet-popup-content-wrapper {
    padding: 0 !important;
    border-radius: 10px !important;
    box-shadow: 0 3px 14px rgba(0, 0, 0, 0.18) !important;
    overflow: hidden;
}

.leaflet-popup-content {
    margin: 0 !important;
    width: var(--qmi-popup-width) !important;
}

.leaflet-popup-tip {
    background: var(--qmi-white) !important;
}

.qmi-leaflet-popup .leaflet-popup-close-button {
    top: 6px !important;
    right: 6px !important;
    width: 24px !important;
    height: 24px !important;
    font: 300 22px/24px Arial, sans-serif !important;
    color: #3c3c3c !important;
    text-align: center;
    z-index: 3;
}

.qmi-leaflet-popup .leaflet-popup-close-button:hover {
    color: var(--qmi-green) !important;
    background: transparent !important;
}

.qmi-popup {
    display: block;
    width: var(--qmi-popup-width);
    background: var(--qmi-white);
    text-decoration: none;
    color: inherit;
    cursor: pointer;
}
.qmi-popup:hover .qmi-popup-title { color: var(--qmi-green); }

.qmi-popup-imgwrap {
    position: relative;
    aspect-ratio: 2 / 1;
    overflow: hidden;
}

.qmi-popup-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.qmi-popup-badge {
    position: absolute;
    top: 0;
    left: 0;
    max-width: calc(100% - 16px);
    padding: 6px 12px;
    color: #fff;
    font-family: var(--qmi-font-overpass);
    font-weight: 700;
    font-size: 11px;
    line-height: 1.2;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}

.qmi-popup-badge--soon {
    background: rgba(60, 60, 60, 0.92);
}

.qmi-popup-badge--promo {
    background: var(--qmi-green);
}

.qmi-popup-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px 10px;
}

.qmi-popup-info {
    flex: 1;
    min-width: 0;
}

.qmi-popup-title {
    font-family: var(--qmi-font-bodoni);
    font-size: 1.125rem;
    color: var(--qmi-text);
    line-height: 1.25;
    margin-bottom: 0.15rem;
}

.qmi-popup-location {
    font-family: var(--qmi-font-overpass);
    font-weight: 700;
    color: var(--qmi-tan);
    font-size: 0.875rem;
    line-height: 1.2;
}

.qmi-popup-price-block {
    flex-shrink: 0;
    text-align: right;
}

.qmi-popup-price-label {
    font-family: var(--qmi-font-overpass);
    font-weight: 400;
    font-size: 0.75rem;
    color: #3c3c3c;
    text-transform: uppercase;
    line-height: 1;
    letter-spacing: 0.4px;
}

.qmi-popup-price {
    font-family: var(--qmi-font-overpass);
    font-weight: 700;
    font-size: 1.125rem;
    color: var(--qmi-dark-green);
    line-height: 1.1;
    margin-top: 0.25rem;
}

.qmi-popup-community {
    font-family: var(--qmi-font-overpass);
    font-weight: 400;
    font-size: 12px;
    color: var(--qmi-text-light);
}

.leaflet-control-zoom {
    box-shadow: 0 2px 8px rgba(0,0,0,0.08) !important;
    border-radius: 4px !important;
    border: 1px solid var(--qmi-border) !important;
    overflow: hidden;
}

.leaflet-control-zoom a {
    width: 36px !important;
    height: 36px !important;
    line-height: 36px !important;
    color: var(--qmi-text) !important;
}

.leaflet-container {
    font-family: var(--qmi-font-overpass) !important;
}
`;
