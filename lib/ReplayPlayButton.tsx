'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '@/styles/Replay.module.css';

export interface ReplayPlayButtonProps {
  /** 从暂停处继续播放 */
  onPlay: () => void;
}

/**
 * ReplayPlayButton — 暂停时盖在播放区域正中的圆形播放钮。
 * 只在暂停时挂上；播放中由调用方不渲染。
 */
export function ReplayPlayButton({ onPlay }: ReplayPlayButtonProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={styles.centerPlay}
      onClick={onPlay}
      aria-label={t('replay.present.play')}
      title={t('replay.present.play')}
    >
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <path d="M9 7.5v9l8-4.5-8-4.5z" fill="currentColor" />
      </svg>
    </button>
  );
}
