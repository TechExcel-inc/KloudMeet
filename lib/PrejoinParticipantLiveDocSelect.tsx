'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';
import styles from '../styles/PreJoin.module.css';
import { useI18n } from './i18n';

export interface PrejoinParticipantLiveDocSelectProps {
  /** true：普通参会者可以分享文档 AI；false：只能查看 */
  show: boolean;
  onChange: (show: boolean) => void;
}

/** PrejoinParticipantLiveDocSelect — 主持人选择普通参会者能否分享文档 AI。外观与姓名输入框一致。 */
export function PrejoinParticipantLiveDocSelect({
  show,
  onChange,
}: PrejoinParticipantLiveDocSelectProps) {
  const { t } = useI18n();

  return (
    <label className={styles.field}>
      <select
        className={`${styles.fieldInput} ${styles.fieldSelect}`}
        value={show ? 'show' : 'hide'}
        onChange={(event) => onChange(event.target.value === 'show')}
      >
        <option value="show">{t('prejoin.participantLiveDocShow')}</option>
        <option value="hide">{t('prejoin.participantLiveDocHide')}</option>
      </select>
      <span className={styles.fieldLabel}>{t('prejoin.participantLiveDocLabel')}</span>
      <ChevronDown size={18} className={styles.fieldChevron} aria-hidden="true" />
    </label>
  );
}
