'use client';

/**
 * Development-only harness for the meeting toolbar's share tools (Annotate / Remote control),
 * without a meeting. Query: ?share=1 (someone is sharing) &role=0 (not host/presenter) &desktop=0.
 *
 * Not served in production.
 */

import React from 'react';
import { notFound, useSearchParams } from 'next/navigation';
import { KloudMeetToolbar, type ViewMode } from '@/lib/KloudMeetToolbar';

const noop = () => {};

function Harness() {
  const q = useSearchParams();
  const hasScreenShare = q.get('share') === '1';
  const canSwitchViews = q.get('role') !== '0';
  const isDesktop = q.get('desktop') !== '0';
  const [view, setView] = React.useState<ViewMode>('liveDoc');
  const [drawing, setDrawing] = React.useState(false);
  const [control, setControl] = React.useState(false);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#17171b', color: '#e8eaed', font: '14px system-ui' }}>
      <div style={{ padding: 16 }} data-testid="state">
        share={String(hasScreenShare)} role={String(canSwitchViews)} desktop={String(isDesktop)} drawing=
        {String(drawing)} control={String(control)}
      </div>
      <KloudMeetToolbar
        activeView={view}
        onViewChange={setView}
        onExit={noop}
        micEnabled
        camEnabled={false}
        onToggleMic={noop}
        onToggleCam={noop}
        onShareScreen={noop}
        screenShareActive={false}
        canShareScreen={!hasScreenShare}
        isDrawingMode={drawing}
        onToggleDrawingMode={() => hasScreenShare && setDrawing((d) => !d)}
        isRemoteControlMode={control}
        onToggleRemoteControlMode={() => hasScreenShare && setControl((c) => !c)}
        hasScreenShare={hasScreenShare}
        isDesktop={isDesktop}
        canSwitchViews={canSwitchViews}
        chatOpen={false}
        onToggleChat={noop}
        attendeeOpen={false}
        onToggleAttendee={noop}
      />
    </div>
  );
}

export default function DevToolbarPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <React.Suspense>
      <Harness />
    </React.Suspense>
  );
}
