import type { Theme } from '../theme';
import type { CommunityData } from '../data/community';
import { Header, Footer, SectionLabel, FloorPlanCard } from './components';

export function CommunityBrochure({ theme, data }: { theme: Theme; data: CommunityData }) {
  return (
    <div style={{ padding: 0 }}>
      <Header theme={theme} title={data.name} />
      {data.groups.map((g) => (
        <div key={g.collection}>
          <SectionLabel>{g.collection}</SectionLabel>
          {g.intro ? <div style={{ fontSize: 11, marginBottom: 10 }} dangerouslySetInnerHTML={{ __html: g.intro }} /> : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {g.plans.map((p) => <FloorPlanCard key={p.id} plan={p} />)}
          </div>
        </div>
      ))}
      <Footer theme={theme} disclaimer={theme.disclaimers.community} />
    </div>
  );
}
