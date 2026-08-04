'use client';

import React from 'react';
import { getLiveDocIframe } from './chatProtocol';
import {
  isLiveDocAiInboundMessage,
  LIVE_DOC_AI_CHANNEL,
  LIVE_DOC_AI_VERSION,
  type LiveDocAiActionMessage,
  type LiveDocAiState,
  type LiveDocAiSubscribeMessage,
  type LiveDocAiUnsubscribeMessage,
} from './liveDocAiProtocol';

const SUBSCRIBE_RETRY_MS = 500;
const ACTION_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingAction {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getIframeOrigin(iframe: HTMLIFrameElement): string | null {
  try {
    return new URL(iframe.src, window.location.href).origin;
  } catch {
    return null;
  }
}

export interface LiveDocAiBridge {
  state: LiveDocAiState | null;
  connected: boolean;
  error: string;
  pendingActions: ReadonlySet<string>;
  clearError: () => void;
  sendAction: (action: string, payload?: Record<string, unknown>) => Promise<void>;
}

export function useLiveDocAiBridge(enabled: boolean): LiveDocAiBridge {
  const [state, setState] = React.useState<LiveDocAiState | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState('');
  const [pendingActions, setPendingActions] = React.useState<ReadonlySet<string>>(new Set());
  const sessionIdRef = React.useRef('');
  const lastRevisionRef = React.useRef(-1);
  const pendingRef = React.useRef(new Map<string, PendingAction>());

  React.useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setState(null);
      setError('');
      return;
    }

    const sessionId = createId('livedoc-ai');
    sessionIdRef.current = sessionId;
    lastRevisionRef.current = -1;
    setState(null);
    setConnected(false);
    setError('');
    let retryTimer: number | null = null;
    const sessionPendingActions = pendingRef.current;

    const postSubscribe = () => {
      const iframe = getLiveDocIframe();
      if (!iframe?.contentWindow) return;
      const targetOrigin = getIframeOrigin(iframe);
      if (!targetOrigin) return;
      const message: LiveDocAiSubscribeMessage = {
        type: 'Kloud-LiveDocAiSubscribe',
        channel: LIVE_DOC_AI_CHANNEL,
        version: LIVE_DOC_AI_VERSION,
        sessionId,
      };
      iframe.contentWindow.postMessage(message, targetOrigin);
    };

    const handleMessage = (event: MessageEvent) => {
      if (!isLiveDocAiInboundMessage(event.data)) return;
      const iframe = getLiveDocIframe();
      if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return;
      const expectedOrigin = getIframeOrigin(iframe);
      if (!expectedOrigin || event.origin !== expectedOrigin) return;
      if (event.data.sessionId !== sessionIdRef.current) return;

      if (event.data.type === 'Kloud-LiveDocAiSnapshot') {
        if (event.data.revision <= lastRevisionRef.current) return;
        lastRevisionRef.current = event.data.revision;
        setState(event.data.state);
        setConnected(true);
        if (retryTimer) {
          window.clearInterval(retryTimer);
          retryTimer = null;
        }
        return;
      }

      const pending = sessionPendingActions.get(event.data.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timer);
      sessionPendingActions.delete(event.data.requestId);
      setPendingActions(new Set(sessionPendingActions.keys()));
      if (event.data.ok) {
        pending.resolve();
      } else {
        const message = event.data.error || 'LiveDoc action failed';
        setError(message);
        pending.reject(new Error(message));
      }
    };

    window.addEventListener('message', handleMessage);
    postSubscribe();
    retryTimer = window.setInterval(postSubscribe, SUBSCRIBE_RETRY_MS);

    return () => {
      window.removeEventListener('message', handleMessage);
      if (retryTimer) window.clearInterval(retryTimer);
      const iframe = getLiveDocIframe();
      const targetOrigin = iframe ? getIframeOrigin(iframe) : null;
      if (iframe?.contentWindow && targetOrigin) {
        const message: LiveDocAiUnsubscribeMessage = {
          type: 'Kloud-LiveDocAiUnsubscribe',
          channel: LIVE_DOC_AI_CHANNEL,
          version: LIVE_DOC_AI_VERSION,
          sessionId,
        };
        iframe.contentWindow.postMessage(message, targetOrigin);
      }
      sessionPendingActions.forEach((pending) => {
        window.clearTimeout(pending.timer);
        pending.reject(new Error('LiveDoc AI panel closed'));
      });
      sessionPendingActions.clear();
      setPendingActions(new Set());
    };
  }, [enabled]);

  const sendAction = React.useCallback(
    (action: string, payload: Record<string, unknown> = {}): Promise<void> => {
      const iframe = getLiveDocIframe();
      const targetOrigin = iframe ? getIframeOrigin(iframe) : null;
      if (!enabled || !iframe?.contentWindow || !targetOrigin || !sessionIdRef.current) {
        const actionError = new Error('LiveDoc is not ready yet');
        setError(actionError.message);
        return Promise.reject(actionError);
      }

      const requestId = createId('livedoc-action');
      const message: LiveDocAiActionMessage = {
        type: 'Kloud-LiveDocAiAction',
        channel: LIVE_DOC_AI_CHANNEL,
        version: LIVE_DOC_AI_VERSION,
        sessionId: sessionIdRef.current,
        requestId,
        action,
        payload,
      };

      return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingRef.current.delete(requestId);
          setPendingActions(new Set(pendingRef.current.keys()));
          const timeoutError = new Error(`LiveDoc action timed out: ${action}`);
          setError(timeoutError.message);
          reject(timeoutError);
        }, ACTION_TIMEOUT_MS);
        pendingRef.current.set(requestId, { resolve, reject, timer });
        setPendingActions(new Set(pendingRef.current.keys()));
        const transfer = payload.fileBuffer instanceof ArrayBuffer ? [payload.fileBuffer] : [];
        iframe.contentWindow?.postMessage(message, targetOrigin, transfer);
      });
    },
    [enabled],
  );

  return {
    state,
    connected,
    error,
    pendingActions,
    clearError: React.useCallback(() => setError(''), []),
    sendAction,
  };
}
