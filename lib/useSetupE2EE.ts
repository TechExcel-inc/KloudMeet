import React from 'react';
import { ExternalE2EEKeyProvider } from 'livekit-client';
import { decodePassphrase } from './client-utils';

export function useSetupE2EE() {
  const e2eePassphrase =
    typeof window !== 'undefined' ? decodePassphrase(location.hash.substring(1)) : undefined;

  // Worker 必须跨渲染复用：它是 roomOptions 的依赖，每次新建会导致 Room 重建、会议反复断线
  const worker = React.useMemo<Worker | undefined>(
    () =>
      typeof window !== 'undefined' && e2eePassphrase
        ? new Worker(new URL('livekit-client/e2ee-worker', import.meta.url))
        : undefined,
    [e2eePassphrase],
  );

  return { worker, e2eePassphrase };
}
