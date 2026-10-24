'use client';

import * as React from 'react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-core';
import { sortTrackReferences } from '@livekit/components-core';
import { TrackLoop, useGridLayout, useSwipe, useVisualStableUpdate } from '@livekit/components-react';
import { filterGalleryTracks, videoFirstOrder, type GalleryPrefs } from './galleryPrefs';

/**
 * LiveKit's GridLayout plus the viewer's gallery settings: tiles per page (auto = LiveKit's
 * size-based choice, up to 25 on a wide stage; or 9 / 16 / 25 / 49), "video first" and "hide
 * people without video". Keeps LiveKit's paging behaviour — speakers are swapped onto the page
 * in view, positions stay stable — and its markup (.lk-grid-layout, .lk-pagination-control).
 */
export function KloudGridLayout({
  tracks,
  prefs,
  children,
}: {
  tracks: TrackReferenceOrPlaceholder[];
  prefs: GalleryPrefs;
  children: React.ReactNode;
}) {
  const gridRef = React.useRef<HTMLDivElement>(null);
  const shown = React.useMemo(() => filterGalleryTracks(tracks, prefs), [tracks, prefs]);
  const { layout } = useGridLayout(gridRef, shown.length);
  const perPage = prefs.tilesPerPage === 'auto' ? layout.maxTiles : prefs.tilesPerPage;

  const sortFn = React.useCallback(
    (refs: TrackReferenceOrPlaceholder[]) => {
      const sorted = sortTrackReferences(refs);
      return prefs.videoFirst ? videoFirstOrder(sorted) : sorted;
    },
    [prefs.videoFirst],
  );
  const ordered = useVisualStableUpdate(shown, perPage, { customSortFunction: sortFn });

  const pageCount = Math.max(1, Math.ceil(ordered.length / perPage));
  const [page, setPage] = React.useState(1);
  const current = Math.min(page, pageCount);
  // Stops at the first and last page, as LiveKit's own paging does
  const next = React.useCallback(() => setPage((p) => Math.min(p + 1, pageCount)), [pageCount]);
  const prev = React.useCallback(() => setPage((p) => Math.max(p - 1, 1)), []);
  useSwipe(gridRef, { onLeftSwipe: next, onRightSwipe: prev });

  const pageTracks = ordered.slice((current - 1) * perPage, current * perPage);

  return (
    <div ref={gridRef} className="lk-grid-layout" data-lk-pagination={pageCount > 1}>
      <TrackLoop tracks={pageTracks}>{children}</TrackLoop>
      {pageCount > 1 && (
        <div className="lk-pagination-control">
          <button type="button" className="lk-button" onClick={prev} aria-label="Previous page">
            <ChevronRight />
          </button>
          <span className="lk-pagination-count">{`${current} of ${pageCount}`}</span>
          <button type="button" className="lk-button" onClick={next} aria-label="Next page">
            <ChevronRight />
          </button>
        </div>
      )}
    </div>
  );
}

/** One right chevron for both buttons; LiveKit's CSS rotates the first one. */
function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
