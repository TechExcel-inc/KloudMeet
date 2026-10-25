'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';
import styles from '../styles/PreJoin.module.css';
import { useI18n } from './i18n';

export type RecordingOption = 'none' | 'ai_livedoc_screenshot' | 'livedoc_full' | 'screen_share';

export interface PrejoinRecordingOptionSelectProps {
  value: RecordingOption;
  onChange: (value: RecordingOption) => void;
}

export function PrejoinRecordingOptionSelect({
  value,
  onChange,
}: PrejoinRecordingOptionSelectProps) {
  const { t } = useI18n();

  return (
    <label className={styles.field}>
      <select
        className={`${styles.fieldInput} ${styles.fieldSelect}`}
        value={value}
        onChange={(event) => onChange(event.target.value as RecordingOption)}
      >
        <option value="none">{t('prejoin.recordingNone')}</option>
        <option value="ai_livedoc_screenshot">{t('prejoin.recordingAiLivedocScreenshot')}</option>
        <option value="livedoc_full">{t('prejoin.recordingLivedocFull')}</option>
        <option value="screen_share">{t('prejoin.recordingScreenShare')}</option>
      </select>
      <span className={styles.fieldLabel}>{t('prejoin.recordingOptionLabel')}</span>
      <ChevronDown size={18} className={styles.fieldChevron} aria-hidden="true" />
    </label>
  );
}
