'use client';

import { HoaLinksEditor } from '@/components/fields/HoaLinksEditor';
import { JsonBlocksEditor } from '@/components/fields/JsonBlocksEditor';
import { PromoScopeTagPicker } from '@/components/fields/PromoScopeTagPicker';
import { CommunityFloorPlansPicker } from '@/components/fields/CommunityFloorPlansPicker';
import type { SideWidget } from '@/components/EntityEditForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function SideWidgetBlock({
  id,
  widget,
  onResult,
}: {
  id: string;
  widget: SideWidget;
  onResult?: (msg: string) => void;
}) {
  if (widget.kind === 'hoaLinks') {
    return (
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base font-medium">HOA Links</CardTitle>
        </CardHeader>
        <CardContent>
          <HoaLinksEditor id={id} initial={widget.initial} onResult={onResult} />
        </CardContent>
      </Card>
    );
  }
  if (widget.kind === 'jsonBlocks') {
    return (
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base font-medium">Content Blocks</CardTitle>
        </CardHeader>
        <CardContent>
          <JsonBlocksEditor id={id} initialCopy={widget.copy} initialVenue={widget.venue} onResult={onResult} />
        </CardContent>
      </Card>
    );
  }
  if (widget.kind === 'communityFloorPlans') {
    return (
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base font-medium">Floor Plans Offered</CardTitle>
        </CardHeader>
        <CardContent>
          <CommunityFloorPlansPicker
            communityId={id}
            initialSelected={widget.selected}
            options={widget.options}
            onResult={onResult}
          />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-base font-medium">Targeting Scope</CardTitle>
      </CardHeader>
      <CardContent>
        <PromoScopeTagPicker
          promoId={id}
          initialGlobal={widget.global}
          initialSelected={widget.selected}
          options={widget.options}
          surfaces={widget.surfaces}
          published={widget.published}
          onResult={onResult}
        />
      </CardContent>
    </Card>
  );
}

export const MAIN_SAVE_SIDE_WIDGETS = new Set<SideWidget['kind']>([
  'promoScope',
  'hoaLinks',
  'communityFloorPlans',
]);
