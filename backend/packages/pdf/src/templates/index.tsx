import type { Theme } from '../theme';
import type { PdfType } from '../env';
import { wrapHtml } from './render';
import { CommunityBrochure } from './community';
import type { CommunityData } from '../data/community';
import { QmiBrochure } from './qmi';
import type { QmiData } from '../data/qmi';
import { FloorPlanBrochure } from './floorplan';
import type { FloorPlanData } from '../data/floorplan';
import { ListBrochure } from './list';
import type { ListData } from '../data/list';

export function renderTemplate(type: PdfType, theme: Theme, data: unknown): string {
  switch (type) {
    case 'community':
      return wrapHtml(theme, <CommunityBrochure theme={theme} data={data as CommunityData} />);
    case 'qmi': {
      const q = data as QmiData;
      // Zero margins so the full-bleed background PNG fills the page edge-to-edge.
      // Page 2 mirrors the brand spec sheet: the floor-plan drawing alone on a white page.
      return wrapHtml(theme, (
        <>
          <QmiBrochure theme={theme} data={q} />
          {q.floorPlanImageUrl ? (
            <div style={{ breakBefore: 'page', width: '8.5in', height: '11in', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img src={q.floorPlanImageUrl} alt="Floor plan" style={{ maxWidth: '8.1in', maxHeight: '10.5in', objectFit: 'contain' }} />
            </div>
          ) : null}
        </>
      ), { top: 0, right: 0, bottom: 0, left: 0 });
    }
    case 'floorplan':
      return wrapHtml(theme, <FloorPlanBrochure theme={theme} data={data as FloorPlanData} />);
    case 'list': {
      const ld = data as ListData;
      // The QMI grid renders full-bleed over branded template artwork, and the Communities
      // table (locations) paints its own full-page layout — both use zero page margins.
      const margins = ld.kind === 'qmis' || ld.kind === 'locations' ? { top: 0, right: 0, bottom: 0, left: 0 } : undefined;
      return wrapHtml(theme, <ListBrochure theme={theme} data={ld} />, margins);
    }
    default:
      throw new Error(`template not implemented for type: ${type}`);
  }
}
