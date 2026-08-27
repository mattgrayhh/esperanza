'use client';
import { useEffect, useRef } from 'react';
import {
  loadLeaflet,
  renderSingleCommunityMap,
  COMMUNITY_MAP_CSS,
  type MapCommunity,
} from '@esperanza/community-map';

export function CommunityMap({ community }: { community: MapCommunity | null }) {
  const elRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!community || !elRef.current) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    loadLeaflet().then(() => {
      if (cancelled || !elRef.current) return;
      cleanup = renderSingleCommunityMap(elRef.current, { community, openPopup: true });
    });
    return () => { cancelled = true; cleanup?.(); };
  }, [community]);

  if (!community) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Add latitude/longitude to preview the community on the map.
      </div>
    );
  }
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: COMMUNITY_MAP_CSS }} />
      <div ref={elRef} className="qmi-map" style={{ height: 320, width: '100%', borderRadius: 8, overflow: 'hidden' }} />
    </>
  );
}
