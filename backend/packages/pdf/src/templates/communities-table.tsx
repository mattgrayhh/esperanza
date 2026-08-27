import type { Theme } from '../theme';
import type { CommunityRowData } from '../data/list';
import { EqualHousingMark } from './components';

// Sampled from the reference Communities.pdf header band (rgb 41,81,53).
const HEADER_GREEN = '#295435';

const COLUMNS: { key: keyof CommunityRowData | 'name'; label: string; width: string; first?: boolean }[] = [
  { key: 'name', label: 'Community Name', width: '19%', first: true },
  { key: 'city', label: 'Location', width: '13%' },
  { key: 'price', label: 'Price Point', width: '15.5%' },
  { key: 'sqft', label: 'SQFT', width: '13.5%' },
  { key: 'beds', label: 'Bedrooms', width: '13%' },
  { key: 'baths', label: 'Baths', width: '13%' },
  { key: 'garage', label: 'Garages', width: '13%' },
];

// Footer matching the reference: green wordmark · "Site | Phone" · equal-housing mark.
function CommunitiesFooter({ theme }: { theme: Theme }) {
  const site = theme.footer.website || 'esperanzahomes.com';
  const siteDisplay = site.charAt(0).toUpperCase() + site.slice(1);
  const digits = (theme.footer.phone || '').replace(/\D/g, '');
  const phone = digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : theme.footer.phone;
  return (
    <div style={{ marginTop: 'auto', paddingTop: 14,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ width: 170, display: 'flex', alignItems: 'center' }}>
        {theme.brand.logoWordmarkUrl
          ? <img src={theme.brand.logoWordmarkUrl} alt="Esperanza Homes" style={{ maxHeight: 52, maxWidth: '100%' }} />
          : <span style={{ fontFamily: 'var(--pdf-font-heading)', color: 'var(--pdf-primary)', fontSize: 24, fontWeight: 700 }}>Esperanza</span>}
      </div>
      <div style={{ flex: 1, textAlign: 'center', fontSize: 13, color: '#3f3f3f', letterSpacing: '0.01em' }}>
        {siteDisplay}
        <span style={{ color: '#b7b7b7', margin: '0 9px' }}>|</span>
        {phone}
      </div>
      <div style={{ width: 170, display: 'flex', justifyContent: 'flex-end' }}>
        {theme.footer.showEqualHousingLogo ? <EqualHousingMark /> : null}
      </div>
    </div>
  );
}

/** Communities list rendered as a single-sheet table — 1:1 with the legacy Communities.pdf. */
export function CommunitiesTable({ theme, communities }: { theme: Theme; communities: CommunityRowData[] }) {
  const th: React.CSSProperties = {
    background: HEADER_GREEN, color: '#fff', fontWeight: 700, fontSize: 10,
    padding: '5px 6px', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    fontSize: 9, color: '#333', padding: '2px 6px', textAlign: 'center',
    verticalAlign: 'middle', borderBottom: '1px solid #e6e6e6',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '11in', width: '8.5in',
      padding: '0.4in 0.4in 0.3in', boxSizing: 'border-box' }}>
      <h1 style={{ textAlign: 'center', fontFamily: 'var(--pdf-font-heading)', fontWeight: 400,
        fontSize: 28, color: '#1c1c1c', margin: '0 0 9px' }}>Communities</h1>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>{COLUMNS.map((c) => <col key={c.key} style={{ width: c.width }} />)}</colgroup>
        <thead>
          <tr>{COLUMNS.map((c) => (
            <th key={c.key} style={{ ...th, textAlign: c.first ? 'left' : 'center', paddingLeft: c.first ? 10 : 6 }}>{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {communities.map((c) => (
            <tr key={c.id} style={{ breakInside: 'avoid' }}>
              <td style={{ ...td, padding: '2px 6px 2px 8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 44, height: 27, flex: '0 0 auto', borderRadius: 2, overflow: 'hidden', background: '#eef0ee' }}>
                    {c.imageUrl ? <img src={c.imageUrl} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  </div>
                  <div style={{ flex: 1, textAlign: 'center', fontSize: 9, lineHeight: 1.1 }}>{c.name}</div>
                </div>
              </td>
              <td style={td}>{c.city}</td>
              <td style={td}>{c.price}</td>
              <td style={td}>{c.sqft}</td>
              <td style={td}>{c.beds}</td>
              <td style={td}>{c.baths}</td>
              <td style={td}>{c.garage}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <CommunitiesFooter theme={theme} />
    </div>
  );
}
