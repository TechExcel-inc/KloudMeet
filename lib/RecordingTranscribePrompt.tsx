'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import { authHeaders } from '@/lib/kloudSession';
import {
  isSttActive,
  readTranscribeState,
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
}

function initialPhase(state: TranscribeState): Phase {
  if (isSttActive(state.status) || state.status === 'FAILED') return 'resume';
  return state.status === 'SUCCEEDED' ? 'empty' : 'prompt';
}

/** 回放页无字幕时：询问是否解析字幕，确认后提交阿里云任务并展示进度 */
export function RecordingTranscribePrompt({ recordingKey, initial, onDone }: RecordingTranscribePromptProps) {
  const { t } = useI18n();
  const [phase, setPhase] = React.useState<Phase>(() => initialPhase(initial));
  const [state, setState] = React.useState<TranscribeState>(initial);
  const [starting, setStarting] = React.useState(false);
  const [requestError, setRequestError] = React.useState<string | null>(null);
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;

  const endpoint = `/api/recordings/${encodeURIComponent(recordingKey)}/transcribe`;

  const apply = React.useCallback((next: TranscribeState) => {
    setState(next);
    if (isSttActive(next.status)) {
      setPhase('running');
      return;
    }
    if (next.status === 'SUCCEEDED') {
      setPhase('empty');
      onDoneRef.current();
      return;
    }
    setPhase('prompt');
  }, []);

  React.useEffect(() => {
    if (phase !== 'running') return;
    let stopped = false;
    const poll = async () => {
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
    setStarting(true);
    setRequestError(null);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: authHeaders() });
      if (res.status === 409) {
        onDoneRef.current();
        setPhase('hidden');
        return;
      }
      const next = res.ok ? readTranscribeState(await res.json()) : null;
      if (!next) {
        setRequestError(t('replay.transcribeRequestFailed'));
        return;
      }
      apply(next);
    } catch (err) {
      console.warn('[RecordingTranscribePrompt] start failed', err);
      setRequestError(t('replay.transcribeRequestFailed'));
    } finally {
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

  if (phase === 'running' && (state.status === 'QUEUED' || state.status === 'SUBMITTING')) {
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true">
        <div className={styles.dialog}>
          <h3 className={styles.title}>
            {state.status === 'QUEUED' ? t('replay.transcribeQueued') : t('replay.transcribeStageSubmit')}
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
    const pct = Math.max(0, Math.min(100, Math.round(state.progress)));
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true">
        <div className={styles.dialog}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>{t('replay.transcribeRunning')}</span>
            <span className={styles.pct}>{pct}%</span>
          </div>
          <div className={styles.track}>
            <div className={styles.bar} style={{ width: `${pct}%` }} />
          </div>
          <p className={styles.stage}>{stage}</p>
        </div>
      </div>
    );
  }

  const resuming = phase === 'resume';
  const error = requestError ?? (state.status === 'FAILED' && state.error
    ? t('replay.transcribeFailed', { error: state.error })
    : null);

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <h3 className={styles.title}>
          {resuming ? t('replay.transcribeResumeTitle') : t('replay.transcribePromptTitle')}
        </h3>
        <p className={styles.desc}>
          {resuming ? t('replay.transcribeResumeDesc') : t('replay.transcribePromptDesc')}
        </p>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryBtn} onClick={() => setPhase('collapsed')}>
            {t('replay.transcribeLater')}
          </button>
          <button type="button" className={styles.primaryBtn} disabled={starting} onClick={() => void handleStart()}>
            {starting
              ? t('replay.transcribeStarting')
              : resuming
                ? t('replay.transcribeResume')
                : t('replay.transcribeStart')}
          </button>
        </div>
      </div>
    </div>
  );
}
