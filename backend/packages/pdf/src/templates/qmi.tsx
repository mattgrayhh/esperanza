import type { Theme } from '../theme';
import type { QmiData } from '../data/qmi';
import { EqualHousingMark } from './components';
import { money } from '../data/shared';

// Full-bleed background PNG (the reference one-pager, 8.5"×11" at 300dpi).
// Provides: Esperanza logo, equal housing mark, and the overall page chrome.
// Every dynamic-data area is covered by a matching-color CSS overlay so the original
// data doesn't bleed through, then our data sits on top.
const QMI_TEMPLATE_PNG = 'https://img.hazardhouse.ai/pdf-templates/qmi-spec-sheet.png';

// Colors extracted from the reference PNG via pixel sampling (300dpi).
const GREEN  = '#295135'; // rgb(41,81,53)   — price box
const TAN    = '#85754e'; // rgb(133,117,78) — address box
const GRAY   = '#cac8c8'; // rgb(202,200,200)— completion bar
const BEIGE  = '#f2f1ed'; // rgb(242,241,237)— stats band
const MUTED  = '#7b7b7b'; // rgb(123,123,123)— contact band

const moneyCents = (n: number | null): string =>
  n == null ? '' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DEFAULT_QMI_DISCLAIMER =
  'The information provided in this document regarding available quick move-in homes at Esperanza Homes is intended for informational purposes only. While we strive to present accurate and up-to-date information, all details—including but not limited to pricing, availability, home features, and community amenities—are not guaranteed and are subject to change without prior notice. Dimensions and floor plans are approximate and may differ from the actual homes. Incentives and promotional offers are valid only when financing through Stonewood Home Lending and are subject to specific terms and conditions and may be limited to select homes and communities. For comprehensive terms, conditions, and further information regarding our homes and offerings, please consult with an Esperanza Homes sales consultant or visit esperanzahomes.com.';

// All position/dimension constants are measured from the reference PDF (300dpi pixel scan →
// divide by 300 to get inches). Adjust here if the background template PNG changes.
// Page: 8.5in × 11in. Zero @page margins set in templates/index.tsx for the qmi type.

// Header boxes (vertically: 80–320px → 0.267–1.067in; height = 240/300 = 0.8in)
const HDR_TOP   = '0.27in';
const HDR_H     = '0.80in';
// Green box (x: 820–1545px → 2.733–5.150in)
const GREEN_L   = '2.73in';
const GREEN_W   = '2.42in';
// Tan box (x: 1565–2425px → 5.217–8.083in; small ~13px gap between boxes)
const TAN_L     = '5.22in';
const TAN_W     = '2.87in';
// Completion bar (x: same as green start → right edge of tan; y: 340–430px → 1.133–1.433in)
const BAR_TOP   = '1.13in';
const BAR_H     = '0.30in';
const BAR_W     = '5.34in'; // green + gap + tan combined width
// Hero column (x: ~260–2330px → 0.87–7.77in)
const COL_L     = '0.87in';
const COL_W     = '6.90in';
// Stats + contact bands run WIDER than the hero (x: ~120–2430px → 0.40–8.10in) —
// using the hero column here leaves slivers of the baked-in band exposed at both edges.
const BAND_L    = '0.40in';
const BAND_W    = '7.70in';
// Description/footer: original text runs full-width (edge-to-edge) so use wider bounds
const WIDE_L    = '0.23in';
const WIDE_W    = '8.04in';
// Hero image (y: 490–1745px → 1.633–5.817in; height 4.183in)
const HERO_TOP  = '1.63in';
const HERO_H    = '4.18in';
// Stats band (y: 1760–1990px → 5.867–6.633in; height 0.767in)
const STATS_TOP = '5.87in';
const STATS_H   = '0.77in';
// Contact band (y: 1995–2175px → 6.650–7.250in; height 0.600in)
const CONTACT_TOP = '6.65in';
const CONTACT_H   = '0.60in';
// Description + features — starts right after contact band bottom (6.65+0.60=7.25in),
// extends to the footer start. The background PNG has the original description text
// from 7.25in–9.57in; this white overlay must cover ALL of it.
const DESC_TOP  = '7.25in';
const DESC_H    = '2.42in'; // covers to 9.67in
// Footer disclaimer — background original runs 9.57–10.87in; cover it fully.
const FOOTER_TOP = '9.57in';
const FOOTER_H   = '1.35in';

/** Per-home Quick Move-In spec sheet — full-bleed PNG background + data overlays. */
export function QmiBrochure({ theme, data }: { theme: Theme; data: QmiData }) {
  const stats = [
    data.totalSqft  != null && { value: data.totalSqft.toLocaleString('en-US'),  label: 'Total Square Feet' },
    data.livingSqft != null && { value: data.livingSqft.toLocaleString('en-US'), label: 'Living Square Feet' },
    data.beds       != null && { value: String(data.beds),                        label: data.beds === 1 ? 'Bedroom' : 'Bedrooms' },
    data.baths      != null && { value: String(data.baths),                       label: 'Baths' },
    data.garage     != null && { value: String(data.garage),                      label: 'Car Garage' },
    data.stories    != null && { value: data.stories.toFixed(1),                  label: data.stories === 1 ? 'Story' : 'Stories' },
  ].filter(Boolean) as { value: string; label: string }[];

  const disclaimer = theme.disclaimers.qmi?.trim() ? theme.disclaimers.qmi : DEFAULT_QMI_DISCLAIMER;

  return (
    <div style={{
      position: 'relative',
      width: '8.5in', height: '11in',
      overflow: 'hidden',
      fontFamily: 'Inter, system-ui, sans-serif',
      // PNG provides the logo, equal housing mark, and page chrome.
      backgroundImage: `url("${QMI_TEMPLATE_PNG}")`,
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
    }}>

      {/* ── GREEN PRICE BOX ── covers original green box, overlays our price data */}
      <div style={{
        position: 'absolute', left: GREEN_L, top: HDR_TOP, width: GREEN_W, height: HDR_H,
        background: GREEN,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: '#fff', textAlign: 'center', lineHeight: 1.25, gap: 1,
      }}>
        {data.statusHeadline ? (
          <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '0.01em' }}>{data.statusHeadline}</div>
        ) : null}
        {data.price != null ? (
          <div style={{ fontSize: 18, fontWeight: 600 }}>{money(data.price)}</div>
        ) : null}
        {data.estMonthly != null ? (
          <div style={{ fontSize: 9, opacity: 0.92 }}>From {moneyCents(data.estMonthly)}*/month</div>
        ) : null}
      </div>

      {/* ── TAN ADDRESS BOX ── covers original tan box, overlays our address data */}
      <div style={{
        position: 'absolute', left: TAN_L, top: HDR_TOP, width: TAN_W, height: HDR_H,
        background: TAN,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: '#fff', textAlign: 'center', lineHeight: 1.3, gap: 1,
        padding: '0 10px',
      }}>
        {data.address ? (
          <div style={{ fontSize: 16, fontWeight: 700 }}>{data.address}</div>
        ) : null}
        {data.community ? (
          <div style={{ fontSize: 11 }}>{data.community}</div>
        ) : null}
        {data.lot ? (
          <div style={{ fontSize: 11 }}>Homesite {data.lot}</div>
        ) : null}
      </div>

      {/* ── COMPLETION BAR ── gray bar beneath the two header boxes */}
      <div style={{
        position: 'absolute', left: GREEN_L, top: BAR_TOP, width: BAR_W, height: BAR_H,
        background: GRAY,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 500, color: '#333',
      }}>
        {data.completion ? `Est. Completion Date: ${data.completion}` : ''}
      </div>

      {/* ── HERO PHOTO ── covers original photo entirely */}
      <div style={{
        position: 'absolute', left: COL_L, top: HERO_TOP, width: COL_W, height: HERO_H,
        background: '#d8e5dc', overflow: 'hidden',
      }}>
        {data.heroImageUrl ? (
          <img src={data.heroImageUrl} alt={data.address}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : null}
      </div>

      {/* ── STATS BAND ── 6-column beige band with large numbers + small-caps labels */}
      <div style={{
        position: 'absolute', left: BAND_L, top: STATS_TOP, width: BAND_W, height: STATS_H,
        background: BEIGE,
        display: 'flex', alignItems: 'center',
      }}>
        {stats.map((s, i) => (
          <div key={s.label} style={{
            flex: 1, textAlign: 'center',
            borderLeft: i === 0 ? 'none' : '1px solid #d0ceca',
            padding: '0 6px',
          }}>
            <div style={{ fontSize: 36, fontWeight: 300, color: '#2a2a2a', lineHeight: 1, fontFamily: 'Georgia, serif' }}>{s.value}</div>
            <div style={{ fontSize: 7, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── CONTACT BAND ── full-width dark gray band with phone + hours */}
      <div style={{
        position: 'absolute', left: BAND_L, top: CONTACT_TOP, width: BAND_W, height: CONTACT_H,
        background: MUTED,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', textAlign: 'center', fontSize: 10.5, lineHeight: 1.4,
        padding: '0 16px',
      }}>
        Call or Text {theme.footer.phone} or visit our Sales Office {theme.footer.salesHours} for more info!
      </div>

      {/* ── DESCRIPTION + FEATURES ── white cover over original text (full-width), our content on top */}
      <div style={{
        position: 'absolute', left: WIDE_L, top: DESC_TOP, width: WIDE_W, height: DESC_H,
        background: '#fff', overflow: 'hidden',
        // White cover spans full width (hides the baked-in text); the content itself is
        // inset so the text's left edge lands at ~0.78in like the reference sheet.
        padding: '6px 0.55in 0 0.55in',
      }}>
        {data.description ? (
          <p style={{ fontSize: 11, lineHeight: 1.65, color: '#333', margin: 0 }}>{data.description}</p>
        ) : null}
        {data.features.length ? (
          <div style={{ marginTop: 14 }}>
            {data.features.map((f) => (
              <div key={f} style={{ fontSize: 11, lineHeight: 1.65, color: '#333', marginTop: 10 }}>- {f}</div>
            ))}
          </div>
        ) : null}
      </div>

      {/* ── FOOTER DISCLAIMER ── white cover over original fine print; equal housing mark from our SVG */}
      <div style={{
        position: 'absolute', left: '0.23in', top: FOOTER_TOP, width: '8.04in', height: FOOTER_H,
        background: '#fff',
        display: 'flex', alignItems: 'flex-end', gap: 14,
      }}>
        <div style={{ flex: 1, fontSize: 6, lineHeight: 1.4, color: '#8a8a8a', textAlign: 'justify' }}
          dangerouslySetInnerHTML={{ __html: disclaimer }} />
        {theme.footer.showEqualHousingLogo ? (
          <div style={{ flexShrink: 0 }}><EqualHousingMark /></div>
        ) : null}
      </div>
    </div>
  );
}
