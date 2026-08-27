import type { Theme } from '../theme';
import type { ListData, QmiCardData, PlanSection } from '../data/list';
import type { PlanCardData } from './components';
import { CoverBand, Footer, FloorPlanCard, QmiCard, QmiListHeader, BrandFooter, ProductPlanCard, PlanSectionTitle } from './components';
import { CommunitiesTable } from './communities-table';

const PER_PAGE = 9;
const PLANS_PER_PAGE = 12;        // marketing "Floor Plan List" grid is 3 × 4
const TITLES = { locations: 'Locations', qmis: 'Quick Move-In Homes', plans: 'Floor Plans' } as const;

function paginate<T>(items: T[], perPage = PER_PAGE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  if (pages.length === 0) pages.push([]);
  return pages;
}

// One full-bleed Letter page painted with the branded template artwork; cards sit in the
// empty middle region (insets clear the baked-in header band and footer).
function QmiGridPage({ bg, cards }: { bg?: string; cards: QmiCardData[] }) {
  return (
    <div style={{
      position: 'relative', width: '8.5in', height: '11in', overflow: 'hidden',
      backgroundImage: bg ? `url("${bg}")` : undefined, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat',
    }}>
      <div style={{ position: 'absolute', top: '1.5in', left: '0.45in', right: '0.45in', bottom: '1.05in' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 14, rowGap: 12 }}>
          {cards.map((c) => <QmiCard key={c.id} card={c} />)}
        </div>
      </div>
    </div>
  );
}

export function ListBrochure({ theme, data }: { theme: Theme; data: ListData }) {
  // Quick Move-In Homes — cards laid over the branded template one-pager.
  if (data.kind === 'qmis') {
    const pages = paginate(data.qmis);
    return (
      <div>
        {pages.map((cards, pi) => (
          <div key={pi} style={pi < pages.length - 1 ? { breakAfter: 'page' } : undefined}>
            <QmiGridPage bg={data.templateBgUrl} cards={cards} />
          </div>
        ))}
      </div>
    );
  }

  // locations — the Communities table (single sheet, 1:1 with the legacy Communities.pdf).
  if (data.kind === 'locations') {
    return <CommunitiesTable theme={theme} communities={data.communities} />;
  }

  // Floor Plans — the marketing "Floor Plan List": product-type sections, each starting on a
  // fresh page, 3 × 4 grid, branded header band + brand footer (no prices).
  if (data.kind === 'plans' && data.sections) {
    // Flatten sections into pages; a section never shares a page with another section.
    const pageList: { title: string; cards: PlanCardData[] }[] = [];
    for (const section of data.sections as PlanSection[]) {
      for (const chunk of paginate(section.cards, PLANS_PER_PAGE)) {
        pageList.push({ title: section.title, cards: chunk });
      }
    }
    if (pageList.length === 0) pageList.push({ title: '', cards: [] });
    return (
      <div>
        {pageList.map((pg, pi) => (
          <div key={pi} style={{ display: 'flex', flexDirection: 'column', minHeight: '9.85in', ...(pi < pageList.length - 1 ? { breakAfter: 'page' } : {}) }}>
            <QmiListHeader theme={theme} title={data.listBandTitle || 'Floor Plan List'} />
            <PlanSectionTitle>{pg.title}</PlanSectionTitle>
            <div style={{ flex: 1 }}>
              {/* Flex-wrap + centered so a partial final row centers like the marketing PDF. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '4%', rowGap: 16, marginTop: 14 }}>
                {pg.cards.map((c) => (
                  <div key={c.id} style={{ width: '30%' }}><ProductPlanCard plan={c} /></div>
                ))}
              </div>
            </div>
            <BrandFooter theme={theme} disclaimer={theme.disclaimers.list} />
          </div>
        ))}
      </div>
    );
  }

  // plans (no sections) / fallback — existing card styling.
  const pages = paginate(data.cards);
  return (
    <div>
      {pages.map((cards, pi) => (
        <div key={pi} className={pi < pages.length - 1 ? 'page-break' : undefined}>
          <CoverBand theme={theme} title={data.cityName || 'Esperanza Homes'} subtitle={TITLES[data.kind]} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 14 }}>
            {cards.map((c) => <FloorPlanCard key={c.id} plan={c} />)}
          </div>
          <Footer theme={theme} disclaimer={theme.disclaimers.list} />
        </div>
      ))}
    </div>
  );
}
