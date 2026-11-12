'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '@/styles/DesktopUpdateBanner.module.css';

interface UpdateProgress {
  percent: number;
  version?: string;
}

interface AppUpdateApi {
  getAppUpdateProgress?: () => Promise<UpdateProgress | null>;
  onAppUpdateProgress?: (callback: (payload: UpdateProgress | null) => void) => () => void;
}

function appUpdateApi(): AppUpdateApi | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as { electronAPI?: AppUpdateApi };
  return host.electronAPI ?? null;
}

function readProgress(payload: UpdateProgress | null): UpdateProgress | null {
  if (!payload || typeof payload.percent !== 'number' || Number.isNaN(payload.percent)) return null;
  return {
    percent: Math.min(100, Math.max(0, payload.percent)),
    version: typeof payload.version === 'string' ? payload.version : '',
  };
}

/** Packaged desktop builds show this while an update is downloading. */
export function DesktopUpdateBanner() {
  const { t } = useI18n();
  const [progress, setProgress] = useState<UpdateProgress | null>(null);

  useEffect(() => {
    const api = appUpdateApi();
    if (!api || !api.onAppUpdateProgress) return;
    let alive = true;
    let live = false;
    const apply = (payload: UpdateProgress | null) => {
      if (!alive) return;
      setProgress(readProgress(payload));
    };
    if (api.getAppUpdateProgress) {
      api.getAppUpdateProgress().then((payload) => {
        if (!alive || live) return;
        apply(payload);
      }).catch(() => {
        /* 主进程还没有这条通道时保持隐藏 */
      });
    }
    const stop = api.onAppUpdateProgress((payload) => {
      live = true;
      apply(payload);
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  if (!progress) return null;
  const pct = Math.round(progress.percent);
  const version = progress.version || '';
  const label = version ? t('update.downloading', { version }) : t('update.downloadingPlain');
  return (
    <div className={styles.wrap} role="status">
      <div className={styles.row}>
        <span>{label}</span>
        <span className={styles.pct}>{pct}%</span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
