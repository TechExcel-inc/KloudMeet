'use client';

/**
 * Doc AI "Upload from Computer" with several files. LiveDoc takes one upload at a time (chat file
 * shares use the same pipeline), so files go one after another, and LiveDoc says how each one ended
 * (Kloud-LiveDocAiUploadResult) so the panel can name exactly the files that were not added.
 * Lives in the toolbar: closing the panel does not stop the queue.
 */

import React from 'react';
import type { LiveDocAiState, LiveDocAiUploadFailReason } from './liveDocAiProtocol';
import { createId, type LiveDocAiBridge } from './useLiveDocAiBridge';

/** LiveDoc's reasons, plus notReady: the meeting's LiveDoc never answered */
export type LiveDocUploadFailReason = LiveDocAiUploadFailReason | 'notReady';

export interface LiveDocUploadFailure {
  id: string;
  name: string;
  reason: LiveDocUploadFailReason;
  /** Too large / unsupported fail the same way again */
  retryable: boolean;
}

export interface LiveDocUploadQueue {
  /** Files waiting or uploading */
  active: boolean;
  /** The file uploading now, counted within this round (1-based), and the round's size */
  position: number;
  total: number;
  currentName: string;
  failures: LiveDocUploadFailure[];
  enqueue: (files: File[]) => void;
  retry: (id: string) => void;
  dismissFailures: () => void;
}

interface QueueItem {
  id: string;
  file: File;
}

type Outcome = { ok: true } | { ok: false; reason: LiveDocUploadFailReason };

const POLL_MS = 250;
/** Waiting for the meeting's LiveDoc to answer at all */
const CONNECT_TIMEOUT_MS = 30 * 1000;
/** Waiting for someone else's upload (a chat file, a long conversion) to finish */
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
/** LiveDoc idle this long without a result: the upload ended somewhere it could not report from */
const RESULT_GRACE_MS = 2 * 60 * 1000;
/** LiveDoc from before results: how long an upload may take to show up as active */
const LEGACY_START_MS = 4 * 1000;
/** "busy" answers in a row before the file counts as failed, and the pause before each new try */
const BUSY_RETRY_LIMIT = 20;
const BUSY_RETRY_MS = 3 * 1000;

const NOT_RETRYABLE: ReadonlySet<LiveDocUploadFailReason> = new Set(['tooLarge', 'unsupported']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isUploading(state: LiveDocAiState | null): boolean {
  return !!state?.documents.upload.active;
}

export function useLiveDocUploadQueue(
  bridge: Pick<LiveDocAiBridge, 'state' | 'connected' | 'sendAction' | 'onUploadResult'>,
): LiveDocUploadQueue {
  const [view, setView] = React.useState({
    active: false,
    position: 0,
    total: 0,
    currentName: '',
    failures: [] as LiveDocUploadFailure[],
  });

  const stateRef = React.useRef(bridge.state);
  const connectedRef = React.useRef(bridge.connected);
  const sendActionRef = React.useRef(bridge.sendAction);
  const onUploadResultRef = React.useRef(bridge.onUploadResult);
  React.useEffect(() => {
    stateRef.current = bridge.state;
    connectedRef.current = bridge.connected;
    sendActionRef.current = bridge.sendAction;
    onUploadResultRef.current = bridge.onUploadResult;
  });

  const queueRef = React.useRef<QueueItem[]>([]);
  const failuresRef = React.useRef<Array<LiveDocUploadFailure & { file: File }>>([]);
  const doneRef = React.useRef(0);
  const totalRef = React.useRef(0);
  const currentRef = React.useRef('');
  const runningRef = React.useRef(false);
  const aliveRef = React.useRef(true);
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const publish = React.useCallback(() => {
    if (!aliveRef.current) return;
    const active = queueRef.current.length > 0;
    setView({
      active,
      position: active ? Math.min(doneRef.current + 1, totalRef.current) : 0,
      total: active ? totalRef.current : 0,
      currentName: active ? currentRef.current : '',
      failures: failuresRef.current.map(({ id, name, reason, retryable }) => ({
        id,
        name,
        reason,
        retryable,
      })),
    });
  }, []);

  /** Polls until test() holds; false on timeout or once the meeting is gone */
  const waitUntil = React.useCallback(async (test: () => boolean, timeoutMs: number) => {
    const start = Date.now();
    while (aliveRef.current) {
      if (test()) return true;
      if (Date.now() - start >= timeoutMs) return false;
      await sleep(POLL_MS);
    }
    return false;
  }, []);

  const uploadOne = React.useCallback(
    async (item: QueueItem): Promise<Outcome | 'busy'> => {
      const ready = await waitUntil(
        () => connectedRef.current && stateRef.current !== null,
        CONNECT_TIMEOUT_MS,
      );
      if (!ready) return { ok: false, reason: 'notReady' };
      const idle = await waitUntil(() => !isUploading(stateRef.current), IDLE_TIMEOUT_MS);
      if (!idle) return { ok: false, reason: 'busy' };

      const reportsResults = !!stateRef.current?.documents.upload.reportsResults;
      const uploadId = createId('upload');
      let result: { status: string; reason: string } | null = null;
      const unsubscribe = onUploadResultRef.current((message) => {
        if (message.uploadId === uploadId) result = message;
      });
      try {
        const fileBuffer = await item.file.arrayBuffer();
        await sendActionRef.current('document.uploadLocal', {
          fileName: item.file.name,
          fileType: item.file.type || '',
          fileSize: item.file.size,
          fileBuffer,
          uploadId,
        });
      } catch {
        unsubscribe();
        return { ok: false, reason: 'unknown' };
      }

      try {
        if (!reportsResults) {
          // LiveDoc from before results: only "uploading" is known, so wait for it to start and end
          let seenActive = false;
          const started = Date.now();
          await waitUntil(() => {
            if (isUploading(stateRef.current)) seenActive = true;
            return seenActive
              ? !isUploading(stateRef.current)
              : Date.now() - started >= LEGACY_START_MS;
          }, IDLE_TIMEOUT_MS);
          return { ok: true };
        }

        let idleSince = 0;
        const answered = await waitUntil(() => {
          if (result) return true;
          if (isUploading(stateRef.current)) {
            idleSince = 0;
          } else if (!idleSince) {
            idleSince = Date.now();
          }
          return idleSince > 0 && Date.now() - idleSince >= RESULT_GRACE_MS;
        }, Number.POSITIVE_INFINITY);
        const final = result as { status: string; reason: string } | null;
        if (!answered || !final) return { ok: false, reason: 'unknown' };
        if (final.status === 'added' || final.status === 'duplicate') return { ok: true };
        if (final.reason === 'busy') return 'busy';
        return { ok: false, reason: (final.reason || 'unknown') as LiveDocUploadFailReason };
      } finally {
        unsubscribe();
      }
    },
    [waitUntil],
  );

  const run = React.useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    let busyAnswers = 0;
    try {
      while (aliveRef.current && queueRef.current.length > 0) {
        const item = queueRef.current[0];
        currentRef.current = item.file.name;
        publish();
        const outcome = await uploadOne(item);
        if (outcome === 'busy' && busyAnswers < BUSY_RETRY_LIMIT) {
          // Someone else's upload slipped in first: wait for it, then send this file again
          busyAnswers += 1;
          await sleep(BUSY_RETRY_MS);
          continue;
        }
        busyAnswers = 0;
        queueRef.current.shift();
        doneRef.current += 1;
        const failed: Outcome = outcome === 'busy' ? { ok: false, reason: 'busy' } : outcome;
        if (!failed.ok) {
          failuresRef.current = [
            ...failuresRef.current,
            {
              id: item.id,
              file: item.file,
              name: item.file.name,
              reason: failed.reason,
              retryable: !NOT_RETRYABLE.has(failed.reason),
            },
          ];
        }
        publish();
      }
    } finally {
      runningRef.current = false;
      if (queueRef.current.length === 0) {
        doneRef.current = 0;
        totalRef.current = 0;
        currentRef.current = '';
      }
      publish();
    }
  }, [publish, uploadOne]);

  const enqueue = React.useCallback(
    (files: File[]) => {
      const items = files
        .filter((file) => file.size > 0)
        .map((file) => ({ id: createId('upload-item'), file }));
      if (!items.length) return;
      queueRef.current = [...queueRef.current, ...items];
      totalRef.current += items.length;
      publish();
      void run();
    },
    [publish, run],
  );

  const retry = React.useCallback(
    (id: string) => {
      const failure = failuresRef.current.find((entry) => entry.id === id);
      if (!failure) return;
      failuresRef.current = failuresRef.current.filter((entry) => entry.id !== id);
      enqueue([failure.file]);
    },
    [enqueue],
  );

  const dismissFailures = React.useCallback(() => {
    failuresRef.current = [];
    publish();
  }, [publish]);

  return { ...view, enqueue, retry, dismissFailures };
}
