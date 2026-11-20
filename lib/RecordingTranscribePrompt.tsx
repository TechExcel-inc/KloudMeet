'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import { authHeaders } from '@/lib/kloudSession';
import {
  isSttActive,
  readTranscribeState,
  submitProgress,
  type TranscribeState,
} from '@/lib/recordingTranscribeState';
import styles from '@/styles/RecordingTranscribePrompt.module.css';

const POLL_MS = 3000;

type Phase = 'prompt' | 'resume' | 'collapsed' | 'running' | 'empty' | 'hidden';

export interface RecordingTranscribePromptProps {
  /** 录像 shareKey 或 id（与回放页路由一致） */
  recordingKey: string;
  /** 回放详情接口返回的任务状态 */
  initial: TranscribeState;
  /** 字幕已写入（或已存在），由父组件重新加载回放数据 */
  onDone: () => void;
  /** Start as the small pill instead of a dialog (the replay works without a transcript) */
  startCollapsed?: boolean;
  regenerate?: boolean;
  onClose?: () => void;
}

function initialPhase(state: TranscribeState, startCollapsed: boolean): Phase {
  if (startCollapsed && !isSttActive(state.status) && state.status !== 'SUCCEEDED') return 'collapsed';
  if (isSttActive(state.status) || state.status === 'FAILED') return 'resume';
  return state.status === 'SUCCEEDED' ? 'empty' : 'prompt';
}

/** 回放页无字幕时：询问是否解析字幕，确认后提交转写任务并展示进度 */
export function RecordingTranscribePrompt({
  recordingKey,
  initial,
  onDone,
  startCollapsed = false,
  regenerate = false,
  onClose,
}: RecordingTranscribePromptProps) {
  const { t } = useI18n();
  const [phase, setPhase] = React.useState<Phase>(() => regenerate ? (isSttActive(initial.status) ? 'running' : 'prompt') : initialPhase(initial, startCollapsed));
  const [state, setState] = React.useState<TranscribeState>(initial);
  const [starting, setStarting] = React.useState(false);
  const [requestError, setRequestError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const onDoneRef = React.useRef(onDone);
  const postingRef = React.useRef(false);
  const shownRef = React.useRef(0);
  const startedRef = React.useRef<number | null>(null);
  onDoneRef.current = onDone;

  const endpoint = `/api/recordings/${encodeURIComponent(recordingKey)}/transcribe`;

  const apply = React.useCallback((next: TranscribeState) => {
    setState(next);
    if (isSttActive(next.status)) {
      setPhase('running');
      return;
    }
    if (next.status === 'SUCCEEDED') {
      setPhase(regenerate ? 'hidden' : 'empty');
      onDoneRef.current();
      return;
    }
    if (!regenerate || next.status === 'FAILED') setPhase('prompt');
  }, [regenerate]);

  React.useEffect(() => {
    if (phase !== 'running') return;
    if (state.status !== 'SUBMITTING' && !postingRef.current) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [phase, state.status]);

  React.useEffect(() => {
    if (phase !== 'running') return;
    let stopped = false;
    const poll = async () => {
      if (postingRef.current) return;
      try {
        const res = await fetch(endpoint, { headers: authHeaders(), cache: 'no-store' });
        if (stopped) return;
        if (res.status === 401 || res.status === 403) {
          setRequestError(t('replay.transcribeRequestFailed'));
          setPhase('prompt');
          return;
        }
        const next = res.ok ? readTranscribeState(await res.json()) : null;
        if (next && !stopped) apply(next);
      } catch (err) {
        console.warn('[RecordingTranscribePrompt] poll failed', err);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [phase, endpoint, apply, t]);

  const handleStart = async () => {
    const started = Date.now();
    postingRef.current = true;
    startedRef.current = started;
    shownRef.current = 10;
    setNow(started);
    setStarting(true);
    setRequestError(null);
    setState({ status: 'SUBMITTING', progress: 10, error: null });
    setPhase('running');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders(regenerate ? { 'Content-Type': 'application/json' } : {}),
        body: regenerate ? JSON.stringify({ regenerate: true }) : undefined,
      });
      if (res.status === 409 && !regenerate) {
        onDoneRef.current();
        setPhase('hidden');
        return;
      }
      const next = res.ok ? readTranscribeState(await res.json()) : null;
      if (!next) {
        setRequestError(t('replay.transcribeRequestFailed'));
        setPhase('prompt');
        return;
      }
      apply(next);
    } catch (err) {
      console.warn('[RecordingTranscribePrompt] start failed', err);
      setRequestError(t('replay.transcribeRequestFailed'));
      setPhase('prompt');
    } finally {
      postingRef.current = false;
      setStarting(false);
    }
  };

  if (phase === 'hidden') return null;

  if (phase === 'collapsed') {
    return (
      <button type="button" className={styles.pill} onClick={() => setPhase(isSttActive(state.status) || state.status === 'FAILED' ? 'resume' : 'prompt')}>
        {t('replay.transcribeOpen')}
      </button>
    );
  }

  if (phase === 'empty') {
    return (
      <div className={styles.card} role="status">
        <p className={styles.cardText}>{t('replay.transcribeEmpty')}</p>
        <button type="button" className={styles.textBtn} onClick={() => setPhase('hidden')}>
          {t('replay.transcribeClose')}
        </button>
      </div>
    );
  }

  if (regenerate && phase === 'running') {
    return (
      <div className={styles.card} role="status">
        <p className={styles.cardText}>
          {state.status === 'QUEUED' ? t('replay.transcribeQueued') :
            `${t('replay.transcribeRunning')} ${Math.round(state.progress)}%`}
        </p>
      </div>
    );
  }

  if (phase === 'running' && state.status === 'QUEUED') {
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="recording-transcribe-title">
        <div className={styles.dialog}>
          <h3 id="recording-transcribe-title" className={styles.title} aria-live="polite">
            {t('replay.transcribeQueued')}
          </h3>
        </div>
      </div>
    );
  }

  if (phase === 'running') {
    const stage =
      state.status === 'ALIGNING'
        ? t('replay.transcribeStageAlign')
        : t('replay.transcribeStageRecognize');
    const serverPct = Math.max(0, Math.min(100, Math.round(state.progress)));
    const local =
      state.status === 'SUBMITTING' && startedRef.current != null
        ? submitProgress(now - startedRef.current)
        : 0;
    const pct = Math.min(100, Math.max(shownRef.current, serverPct, local));
    shownRef.current = pct;
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="recording-transcribe-title">
        <div className={styles.dialog}>
          <div className={styles.cardHead}>
            <span id="recording-transcribe-title" className={styles.cardTitle}>{t('replay.transcribeRunning')}</span>
            <span className={styles.pct}>{pct}%</span>
          </div>
          <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-labelledby="recording-transcribe-title">
            <div className={styles.bar} style={{ width: `${pct}%` }} />
          </div>
          <p className={styles.stage} aria-live="polite">{stage}</p>
        </div>
      </div>
    );
  }

  const resuming = phase === 'resume';
  const error = requestError ?? (state.status === 'FAILED' && state.error
    ? t('replay.transcribeFailed', { error: state.error })
    : null);

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="recording-transcribe-title" aria-describedby="recording-transcribe-desc">
      <div className={styles.dialog}>
        <h3 id="recording-transcribe-title" className={styles.title}>
          {regenerate ? t('replay.regenerateVoice') : resuming ? t('replay.transcribeResumeTitle') : t('replay.transcribePromptTitle')}
        </h3>
        <p id="recording-transcribe-desc" className={styles.desc}>
          {regenerate ? t('replay.regenerateVoiceHint') : resuming ? t('replay.transcribeResumeDesc') : t('replay.transcribePromptDesc')}
        </p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryBtn} onClick={() => onClose ? onClose() : setPhase('collapsed')}>
            {t('replay.transcribeLater')}
          </button>
          <button type="button" className={styles.primaryBtn} disabled={starting} onClick={() => void handleStart()}>
            {starting
              ? t('replay.transcribeStarting')
              : resuming
                ? t('replay.transcribeResume')
                : t(regenerate ? 'replay.regenerateVoice' : 'replay.transcribeStart')}
          </button>
        </div>
      </div>
    </div>
  );
}
