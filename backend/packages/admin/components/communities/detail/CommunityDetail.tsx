'use client';

import { saveEntity } from '../../../lib/actions';
import { PublishedToggle } from '../../fields/PublishedToggle';
import { CommunitySiteHeader } from './CommunitySiteHeader';
import { CommunityStatCards } from './CommunityStatCards';
import { CommunityBasicInfo } from './CommunityBasicInfo';
import { CommunityMap } from './CommunityMap';
import { RecentActivity } from './RecentActivity';
import { CommunityMediaBar } from './CommunityMediaBar';
import {
  CommunityRemainingFields,
} from './CommunityRemainingFields';
import type { CommunityDetailView } from '../../../lib/community-detail';
import {
  EditToast,
  PlacementRail,
  RecordEditBreadcrumb,
  RecordEditLayout,
  StickyActionBar,
  UnsavedLeaveToast,
  sectionId,
} from '@/components/record-edit/RecordEditShell';
import { MAIN_SAVE_SIDE_WIDGETS, SideWidgetBlock } from '@/components/record-edit/SideWidgetBlock';
import { useEditSaveFeedback } from '@/components/record-edit/useEditSaveFeedback';

export function CommunityDetail({ view }: { view: CommunityDetailView }) {
  const formId = `community-edit-${view.id}`;
  const {
    pending,
    startTransition,
    reportResult,
    barStatusText,
    barTone,
    toast,
    dismissToast,
    leavePrompt,
    saveBeforeLeave,
    discardLeave,
    stayOnPage,
  } = useEditSaveFeedback(formId);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await saveEntity('communities', view.id, formData);
      reportResult(
        res.ok
          ? res.siteRebuild?.status === 'scheduled'
            ? 'Saved — site update scheduled; usually about 2 minutes (allow up to 7).'
            : res.siteRebuild
              ? `Saved, but site update was not scheduled: ${res.siteRebuild.detail}`
              : 'Saved'
          : `Error: ${res.error}`
      );
    });
  }

  const floorPlansWidget = view.sideWidgets.find((w) => w.kind === 'communityFloorPlans');
  const inFormWidgets = view.sideWidgets.filter(
    (w) => MAIN_SAVE_SIDE_WIDGETS.has(w.kind) && w.kind !== 'communityFloorPlans',
  );

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-screen-2xl px-2 md:px-4">
        <RecordEditBreadcrumb
          collectionLabel="Communities"
          collectionHref="/communities"
          recordName={view.displayName}
        />
        <div className="mt-3">
          <StickyActionBar
            formId={formId}
            pending={pending}
            statusText={barStatusText}
            statusTone={barTone}
            title={view.displayName}
          />
        </div>
      </div>
      <EditToast message={toast?.message ?? null} tone={toast?.tone ?? 'success'} onDismiss={dismissToast} />
      <UnsavedLeaveToast
        open={leavePrompt != null}
        pending={pending}
        onSave={saveBeforeLeave}
        onDiscard={discardLeave}
        onStay={stayOnPage}
      />

      <form id={formId} action={onSubmit} className="mt-5">
        <CommunitySiteHeader id={view.id} displayName={view.displayName} media={view.media} />

        <div className="mx-auto w-full max-w-screen-2xl space-y-6 px-2 md:px-4">
          <RecordEditLayout
            main={
              <div className="space-y-6">
                <CommunityStatCards stats={view.stats} />
                <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
                  <CommunityBasicInfo fields={view.basicInfo} />
                  <div id={sectionId('Map')}>
                    <CommunityMap community={view.map.community} />
                  </div>
                </section>
                <CommunityRemainingFields
                  groups={view.remaining}
                  id={view.id}
                  floorPlans={floorPlansWidget ?? null}
                />
                {inFormWidgets.map((w, i) => (
                  <div key={i} id={sectionId(w.kind === 'hoaLinks' ? 'HOA Links' : 'Floor Plans Offered')}>
                    <SideWidgetBlock id={view.id} widget={w} onResult={reportResult} />
                  </div>
                ))}
              </div>
            }
            rail={
              <PlacementRail
                placement={view.liveSite}
                publishControl={
                  <PublishedToggle
                    entityKey="communities"
                    id={view.id}
                    gate="status"
                    initialStatus={view.status}
                    statusOptions={view.statusOptions}
                    onResult={reportResult}
                  />
                }
                media={<CommunityMediaBar id={view.id} media={view.media} />}
                trailing={<RecentActivity groups={view.activity} compact />}
              />
            }
          />
        </div>
      </form>
    </div>
  );
}
