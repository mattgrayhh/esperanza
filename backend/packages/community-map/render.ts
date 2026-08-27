import { createCommunityPopupHTML, type MapCommunity } from './popup';
import { mpcPinHTML, teardropPinHTML } from './pins';
import { DEFAULT_TILE } from './tiles';
import { DEFAULT_PALETTE, DEFAULT_PIN_SIZES, DEFAULT_POPUP } from './palette';

declare global { interface Window { L: any } }

export interface SingleMapOptions {
  community: MapCommunity;
  zoom?: number;
  palette?: Partial<typeof DEFAULT_PALETTE>;
  openPopup?: boolean;
}

let leafletPromise: Promise<void> | null = null;

export function loadLeaflet(): Promise<void> {
  if (leafletPromise) return leafletPromise;
  const ensureCss = (id: string, href: string) => {
    if (document.querySelector(`#${id}`)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  };

  ensureCss(
    'leaflet-css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
  );
  ensureCss(
    'leaflet-mc-css',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css'
  );
  ensureCss(
    'leaflet-mc-default-css',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css'
  );

  const loadScript = (src: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(s);
    });

  leafletPromise = new Promise<void>((resolve, reject) => {
    if (window.L && (window.L as any).markerClusterGroup) {
      resolve();
    } else if (window.L) {
      loadScript(
        'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'
      ).then(resolve).catch(reject);
    } else {
      loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
        .then(() =>
          loadScript(
            'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'
          )
        )
        .then(resolve)
        .catch(reject);
    }
  }).catch((e) => {
    leafletPromise = null;
    throw e;
  });
  return leafletPromise;
}

export function renderSingleCommunityMap(el: HTMLElement, opts: SingleMapOptions): () => void {
  const L = window.L;
  const palette = { ...DEFAULT_PALETTE, ...opts.palette };
  const [lng, lat] = opts.community.coordinates;
  const map = L.map(el, {
    center: [lat, lng],
    zoom: opts.zoom ?? 13,
    zoomControl: false,
    scrollWheelZoom: false,
    preferCanvas: true,
  });
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.tileLayer(DEFAULT_TILE.url, {
    attribution: DEFAULT_TILE.attribution,
    subdomains: 'abcd',
    detectRetina: true,
  }).addTo(map);
  const icon = L.divIcon({
    className: 'qmi-pin-wrap',
    html: opts.community.masterPlanned
      ? mpcPinHTML(palette.primaryColor, DEFAULT_PIN_SIZES.mpcPinSize)
      : teardropPinHTML(DEFAULT_PIN_SIZES.pinWidth, DEFAULT_PIN_SIZES.pinHeight),
    iconSize: [DEFAULT_PIN_SIZES.mpcPinSize, DEFAULT_PIN_SIZES.mpcPinSize],
    iconAnchor: [DEFAULT_PIN_SIZES.mpcPinSize / 2, DEFAULT_PIN_SIZES.mpcPinSize / 2],
  });
  const marker = L.marker([lat, lng], { icon }).addTo(map);
  marker.bindPopup(createCommunityPopupHTML(opts.community), {
    closeButton: true,
    maxWidth: DEFAULT_POPUP.popupMaxWidth,
    minWidth: DEFAULT_POPUP.popupMinWidth,
    offset: [0, DEFAULT_POPUP.popupOffsetY],
    className: 'qmi-leaflet-popup',
  });
  if (opts.openPopup !== false) marker.openPopup();
  return () => { map.remove(); };
}
