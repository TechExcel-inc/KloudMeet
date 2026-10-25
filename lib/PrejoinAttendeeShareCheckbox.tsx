'use client';

import React from 'react';
import styles from '../styles/PreJoin.module.css';
import { useI18n } from './i18n';

export interface PrejoinAttendeeShareCheckboxProps {
  /** true：普通参会者可以分享文档 AI；false：只能查看 */
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** PrejoinAttendeeShareCheckbox — 主持人选择普通参会者能否分享文档。 */
export function PrejoinAttendeeShareCheckbox({
  checked,
  onChange,
}: PrejoinAttendeeShareCheckboxProps) {
  const { t } = useI18n();

  return (
    <label className={styles.checkRow}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.checkText}>{t('prejoin.attendeesCanShareDocs')}</span>
    </label>
  );
}
