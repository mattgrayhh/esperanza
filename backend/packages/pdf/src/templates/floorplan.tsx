import type { Theme } from '../theme';
import type { FloorPlanData } from '../data/floorplan';
import { CoverBand, Footer, SectionLabel, ImageGrid } from './components';

export function FloorPlanBrochure({ theme, data }: { theme: Theme; data: FloorPlanData }) {
  return (
    <div>
      <CoverBand theme={theme} title={data.name} subtitle={data.subtitle} />
      <div style={{ height: 240, margin: '16px 0', background: '#dde', borderRadius: 4, overflow: 'hidden' }}>
        {data.coverImageUrl ? <img src={data.coverImageUrl} alt={data.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
      </div>
      {data.description ? <p style={{ fontSize: 11, textAlign: 'center' }}>{data.description}</p> : null}
      <Footer theme={theme} disclaimer={theme.disclaimers.floorplan} />

      {data.elevations.length ? (
        <div className="page-break">
          <CoverBand theme={theme} title={data.name} subtitle={data.subtitle} />
          <SectionLabel>Elevation Options</SectionLabel>
          <ImageGrid cols={2} items={data.elevations} />
          <Footer theme={theme} disclaimer={theme.disclaimers.floorplan} />
        </div>
      ) : null}

      {data.planImages.length ? (
        <div className="page-break">
          <CoverBand theme={theme} title={data.name} subtitle={data.subtitle} />
          <SectionLabel>Floor Plan</SectionLabel>
          <ImageGrid cols={1} items={data.planImages.map((url) => ({ url }))} />
          <Footer theme={theme} disclaimer={theme.disclaimers.floorplan} />
        </div>
      ) : null}

      {data.structuralImages.length ? (
        <div className="page-break">
          <CoverBand theme={theme} title={data.name} subtitle={data.subtitle} />
          <SectionLabel>Structural Options</SectionLabel>
          <ImageGrid cols={3} items={data.structuralImages.map((url) => ({ url }))} />
          <Footer theme={theme} disclaimer={theme.disclaimers.floorplan} />
        </div>
      ) : null}
    </div>
  );
}
