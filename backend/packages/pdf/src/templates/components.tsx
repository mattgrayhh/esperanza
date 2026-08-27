import type { Theme } from '../theme';
import type { QmiCardData } from '../data/list';
import { money } from '../data/shared';

const moneyCents = (n: number | null): string =>
  n == null ? '' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Header({ theme, title }: { theme: Theme; title: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
      {theme.brand.logoWordmarkUrl
        ? <img src={theme.brand.logoWordmarkUrl} alt="Esperanza Homes" style={{ height: 44 }} />
        : <span style={{ fontFamily: 'var(--pdf-font-heading)', color: 'var(--pdf-primary)', fontSize: 22 }}>Esperanza</span>}
      <span className="pdf-band" style={{ padding: '10px 24px', borderRadius: 4, fontFamily: 'var(--pdf-font-heading)', fontSize: 18 }}>{title}</span>
    </div>
  );
}

export function Footer({ theme, disclaimer }: { theme: Theme; disclaimer: string }) {
  return (
    <div style={{ borderTop: '1px solid #ddd', marginTop: 18, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 8, color: 'var(--pdf-neutral)' }}>
      <div style={{ maxWidth: '78%' }}>
        <div style={{ marginBottom: 4 }}>{theme.footer.website} · {theme.footer.phone} · {theme.footer.salesHours}</div>
        <div dangerouslySetInnerHTML={{ __html: disclaimer }} />
      </div>
      {theme.footer.showEqualHousingLogo
        ? (theme.brand.logoMonogramUrl
            ? <img src={theme.brand.logoMonogramUrl} alt="" style={{ height: 28 }} />
            : <span aria-hidden>⌂=</span>)
        : null}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="pdf-label" style={{ fontSize: 13, margin: '14px 0 10px' }}>{children}</div>;
}

export interface PlanCardData {
  id: string; name: string; beds: number | null; baths: number | null; garage: number | null;
  stories: number | null; sqft: number | null; price: number | null; imageUrl: string;
  // Floor-plan list extras (marketing "Floor Plan List" layout): bed/bath ranges + product type.
  bedsMin?: number | null; bedsMax?: number | null; bathsMin?: number | null; bathsMax?: number | null;
  productType?: string;
}
export function FloorPlanCard({ plan }: { plan: PlanCardData }) {
  return (
    <div style={{ textAlign: 'center', breakInside: 'avoid' }}>
      <div style={{ height: 120, background: '#eef0ee', borderRadius: 3, overflow: 'hidden' }}>
        {plan.imageUrl ? <img src={plan.imageUrl} alt={plan.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
      </div>
      <div style={{ fontFamily: 'var(--pdf-font-heading)', fontSize: 16, color: 'var(--pdf-primary)', marginTop: 6 }}>{plan.name}</div>
      <div style={{ fontSize: 10 }}>
        {[plan.beds && `${plan.beds} Bed`, plan.garage && `${plan.garage} Car Garage`, plan.baths != null && `${plan.baths} Bath`].filter(Boolean).join(' · ')}
        <br />
        {[plan.stories != null && `${plan.stories} ${plan.stories === 1 ? 'Story' : 'Stories'}`, plan.sqft && `${plan.sqft.toLocaleString('en-US')} Sq. Ft.`].filter(Boolean).join(' · ')}
      </div>
      {plan.price != null ? <div style={{ fontWeight: 700, marginTop: 2 }}>{money(plan.price)}</div> : null}
    </div>
  );
}

export interface Stat { value: string; label: string }
export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div style={{ background: '#eee', display: 'flex', justifyContent: 'space-around', padding: '12px 6px', borderRadius: 4 }}>
      {stats.map((s) => (
        <div key={s.label} style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--pdf-font-heading)', fontSize: 22, color: 'var(--pdf-primary)' }}>{s.value}</div>
          <div className="pdf-label" style={{ fontSize: 8 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export function CoverBand({ theme, title, subtitle }: { theme: Theme; title: string; subtitle?: string }) {
  return (
    <div className="pdf-band" style={{ padding: '28px 24px', textAlign: 'center', borderRadius: 4,
      backgroundImage: theme.brand.headerPatternUrl ? `url(${theme.brand.headerPatternUrl})` : undefined, backgroundSize: 'cover' }}>
      <div style={{ fontFamily: 'var(--pdf-font-heading)', fontSize: 34 }}>{title}</div>
      {subtitle ? <div style={{ fontSize: 13, opacity: 0.9 }}>{subtitle}</div> : null}
    </div>
  );
}

// ── Quick Move-In Homes list chrome + card ───────────────────────────────────

const DEFAULT_LIST_DISCLAIMER =
  '* Offer void where prohibited or otherwise restricted by law. All information (including, but not limited to prices, views, availability, school assignments and ratings, incentives, floor plans, site plans, features, standards and options, assessments, and fees, planned amenities, programs, conceptual artist renderings and community development plans) is not guaranteed and remains subject to change or delay without notice. Maps and plans are not to scale, and all dimensions are approximate. Please see an Esperanza Homes sales associate for details and visit esperanzahomes.com for additional disclaimers.';

export function EqualHousingMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 64 64" fill="none" stroke="#444" strokeWidth="3" strokeLinejoin="round" aria-label="Equal Housing Opportunity">
      <path d="M32 9 L59 31 H50 V55 H14 V31 H5 Z" />
      <line x1="22" y1="40" x2="42" y2="40" />
      <line x1="22" y1="48" x2="42" y2="48" />
    </svg>
  );
}

/** Marketing one-pager header: logo · contact lines · green title band.
 *  `title` sets the band text ("Quick Move-In Homes", "Floor Plan List", …).
 *  Contact phone is shown in the brand's hyphenated form (956-275-8069). */
function fmtPhone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : raw;
}
export function QmiListHeader({ theme, title = 'Quick Move-In Homes' }: { theme: Theme; title?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <div style={{ width: '28%', display: 'flex', alignItems: 'center' }}>
        {theme.brand.logoWordmarkUrl
          ? <img src={theme.brand.logoWordmarkUrl} alt="Esperanza Homes" style={{ maxHeight: 60, maxWidth: '100%' }} />
          : <span style={{ fontFamily: 'var(--pdf-font-heading)', color: 'var(--pdf-primary)', fontSize: 30, fontWeight: 700 }}>Esperanza</span>}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ textAlign: 'center', fontWeight: 700, color: '#222', fontSize: 12.5, lineHeight: 1.35, marginBottom: 8 }}>
          Call or Text {fmtPhone(theme.footer.phone)} or<br />Visit our Sales Office Monday - Sunday for more info!
        </div>
        <div className="pdf-band" style={{ padding: '12px', textAlign: 'center', borderRadius: 2, fontFamily: 'var(--pdf-font-heading)', fontSize: 24 }}>
          {title}
        </div>
      </div>
    </div>
  );
}

/** Left-aligned product-type heading with an underline rule (e.g. "Single Family"). */
export function PlanSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--pdf-font-body)', fontWeight: 700, fontSize: 19, color: '#1a1a1a',
      margin: '12px 0 0', paddingBottom: 7, borderBottom: '1px solid #2a2a2a' }}>
      {children}
    </div>
  );
}

/** Format a bed/bath value range: "3 Bed", "3 - 4 Bed", "2.5 Bath", "2.5 - 4 Bath". */
function rangeLabel(min: number | null | undefined, max: number | null | undefined, unit: string): string | null {
  const lo = min ?? max, hi = max ?? min;
  if (lo == null || hi == null) return null;
  return lo === hi ? `${lo} ${unit}` : `${lo} - ${hi} ${unit}`;
}

/** One floor-plan card for the marketing "Floor Plan List": landscape elevation, plan name,
 *  bed/garage/bath ranges and stories/sq.ft. — bullet-separated, no price. */
export function ProductPlanCard({ plan }: { plan: PlanCardData }) {
  const beds = rangeLabel(plan.bedsMin ?? plan.beds, plan.bedsMax ?? plan.beds, 'Bed');
  const baths = rangeLabel(plan.bathsMin ?? plan.baths, plan.bathsMax ?? plan.baths, 'Bath');
  const garage = plan.garage ? `${plan.garage} Car Garage` : null;
  const line1 = [beds, garage, baths].filter(Boolean).join(' • ');
  const line2 = [
    plan.stories != null && `${plan.stories} ${plan.stories === 1 ? 'Story' : 'Stories'}`,
    plan.sqft && `${plan.sqft.toLocaleString('en-US')} Sq. Ft.`,
  ].filter(Boolean).join(' • ');
  return (
    <div style={{ textAlign: 'center', breakInside: 'avoid' }}>
      <div style={{ height: 118, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {plan.imageUrl ? <img src={plan.imageUrl} alt={plan.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : null}
      </div>
      <div style={{ fontFamily: 'var(--pdf-font-heading)', fontSize: 18, fontWeight: 600, color: 'var(--pdf-primary)', marginTop: 4 }}>{plan.name}</div>
      <div style={{ fontSize: 9.5, color: '#222', lineHeight: 1.45, marginTop: 1 }}>
        {line1}<br />{line2}
      </div>
    </div>
  );
}

/** Footer matching the marketing one-pager: logo · website + disclaimer · equal-housing mark. */
export function BrandFooter({ theme, disclaimer }: { theme: Theme; disclaimer?: string }) {
  const site = theme.footer.website || 'esperanzahomes.com';
  const siteDisplay = site.charAt(0).toUpperCase() + site.slice(1);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, paddingTop: 8 }}>
      <div style={{ width: 140 }}>
        {theme.brand.logoWordmarkUrl
          ? <img src={theme.brand.logoWordmarkUrl} alt="Esperanza Homes" style={{ maxHeight: 42, maxWidth: '100%' }} />
          : <span style={{ fontFamily: 'var(--pdf-font-heading)', color: 'var(--pdf-primary)', fontSize: 18, fontWeight: 700 }}>Esperanza</span>}
      </div>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ color: 'var(--pdf-primary)', fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{siteDisplay}</div>
        <div style={{ fontSize: 6.5, color: '#777', lineHeight: 1.32 }}
          dangerouslySetInnerHTML={{ __html: disclaimer && disclaimer.trim() ? disclaimer : DEFAULT_LIST_DISCLAIMER }} />
      </div>
      <div style={{ width: 70, display: 'flex', justifyContent: 'flex-end' }}>
        {theme.footer.showEqualHousingLogo ? <EqualHousingMark /> : null}
      </div>
    </div>
  );
}

/** One Quick Move-In home: hero image with boxed promo callouts + monthly pill, then details.
 *  Every overlay sits on a solid box so it stays legible on any image. */
export function QmiCard({ card }: { card: QmiCardData }) {
  const p = card.promo;
  const isRate = p?.style === 'rate';
  const specs = [
    card.beds != null && `${card.beds} Beds`,
    card.baths != null && `${card.baths} Bath`,
    card.sqft != null && `${card.sqft.toLocaleString('en-US')} SQFT`,
  ].filter(Boolean).join(' • ');
  const monthly = card.estMonthly != null ? `From ${moneyCents(card.estMonthly)}*/month` : '';
  return (
    <div style={{ breakInside: 'avoid' }}>
      <div style={{ position: 'relative', height: 138, borderRadius: 4, overflow: 'hidden', background: '#eef0ee' }}>
        {card.imageUrl ? <img src={card.imageUrl} alt={card.address} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}

        {/* green (default) / dark (flex discount) banner across the top */}
        {p && !isRate ? (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, padding: '4px 8px', fontSize: 7.5, fontWeight: 700,
            letterSpacing: '0.03em', textTransform: 'uppercase', color: '#fff',
            background: p.style === 'flex' ? '#33402b' : 'var(--pdf-primary)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',          }}>
            {p.text}
          </div>
        ) : null}

        {/* rate promo: solid corner badge box */}
        {isRate ? (
          <div style={{
            position: 'absolute', top: 7, left: 7, background: 'var(--pdf-primary)', color: '#fff',
            fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 3,          }}>
            {p!.rateLabel}
          </div>
        ) : null}

        {/* monthly payment — always a solid white pill */}
        {monthly ? (
          <div style={{
            position: 'absolute', left: 8, bottom: 8, display: 'flex', alignItems: 'center', gap: 5,
            background: '#fff', color: 'var(--pdf-primary)', fontWeight: 700, fontSize: 8.5,
            padding: '3px 9px', borderRadius: 3,          }}>
            {isRate ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 12, height: 12, borderRadius: '50%', background: 'var(--pdf-primary)', color: '#fff', fontSize: 7 }}>%</span>
            ) : null}
            {monthly}
          </div>
        ) : null}
      </div>

      <div style={{ textAlign: 'center', marginTop: 6, lineHeight: 1.34, color: 'var(--pdf-ink)' }}>
        <div style={{ fontWeight: 700, fontSize: 12 }}>{card.community}</div>
        <div style={{ fontSize: 9.5 }}>{card.city}</div>
        {specs ? <div style={{ fontWeight: 700, fontSize: 9.5, marginTop: 1 }}>{specs}</div> : null}
        {card.availability ? <div style={{ fontSize: 9 }}>{card.availability}</div> : null}
        {card.address ? <div style={{ fontSize: 9 }}>{card.address}</div> : null}
        {card.lot ? <div style={{ fontSize: 9 }}>Lot #{card.lot}</div> : null}
        {card.price != null ? <div style={{ fontWeight: 700, fontSize: 11.5, marginTop: 1 }}>{money(card.price)}</div> : null}
      </div>
    </div>
  );
}

export function ImageGrid({ cols, items }: { cols: number; items: { label?: string; url: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},1fr)`, gap: 14 }}>
      {items.map((it, i) => (
        <div key={i} style={{ breakInside: 'avoid' }}>
          <div style={{ height: 150, background: '#eef0ee', borderRadius: 3, overflow: 'hidden' }}>
            {it.url ? <img src={it.url} alt={it.label ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
          </div>
          {it.label ? <div className="pdf-band" style={{ textAlign: 'center', padding: 6, fontSize: 11 }}>{it.label}</div> : null}
        </div>
      ))}
    </div>
  );
}
