// =============================================================================
// BESPOKE IMAGES — /images  (Digital Asset Manager). SERVER COMPONENT.
//
// This static segment (app/images/page.tsx) takes precedence over the dynamic
// app/[entity]/page.tsx for `/images`, so the images library gets a visual DAM grid
// instead of the generic shadcn table. The other 8 entities keep their generic list.
//
// Data path is the EXISTING server-side one: buildImagesLibrary() reads the BASE
// `images` table via getReadDb() (first-primary, read-your-writes) so the operator
// sees every asset. NO client-side data fetching — the RSC fetches, the client grid
// (ImageGrid) renders + triggers the upload/replace/delete server actions, then
// router.refresh() re-reads through this same server path.
//
// Because this bespoke segment shadows /[entity] for `images`, app/images/[id]/page.tsx
// and app/images/new/page.tsx are also provided (thin wrappers over the generic
// EntityEditForm / createEntity) so /images/<id> and /images/new do NOT 404.
// =============================================================================

import { buildImagesLibrary } from '@/lib/images-library';
import { ImageGrid } from '@/components/images/ImageGrid';

export const dynamic = 'force-dynamic';

export default async function ImagesPage() {
  const { assets, truncated } = await buildImagesLibrary();
  return <ImageGrid assets={assets} truncated={truncated} />;
}
