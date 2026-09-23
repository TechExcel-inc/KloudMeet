'use client';

import * as React from 'react';
import { SpinnerIcon, Toast, useConnectionState } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';

/** 与 LiveKit ConnectionStateToast 样式一致；断开时仍显示连接中（应用层会无限重连，不展示 Disconnected）。 */
export function KloudConnectionStateToast() {
  const state = useConnectionState();
  const label =
    state === ConnectionState.Reconnecting
      ? 'Reconnecting'
      : state === ConnectionState.Connecting || state === ConnectionState.Disconnected
        ? 'Connecting'
        : null;
  if (!label) return null;
  return (
    <Toast className="lk-toast-connection-state">
      <SpinnerIcon className="lk-spinner" /> {label}
    </Toast>
  );
}
