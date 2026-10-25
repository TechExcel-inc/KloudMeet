'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';
import styles from '../styles/PreJoin.module.css';
import { useI18n } from './i18n';

export type AccessLevel = 'public' | 'protected' | 'private';

export interface PrejoinAccessLevelSelectProps {
  value: AccessLevel;
  onChange: (value: AccessLevel) => void;
}

export function PrejoinAccessLevelSelect({ value, onChange }: PrejoinAccessLevelSelectProps) {
  const { t } = useI18n();

  return (
    <label className={styles.field}>
      <select
        className={`${styles.fieldInput} ${styles.fieldSelect}`}
        value={value}
        onChange={(event) => onChange(event.target.value as AccessLevel)}
      >
        <option value="public">{t('prejoin.accessLevelPublic')}</option>
        <option value="protected">{t('prejoin.accessLevelProtected')}</option>
        <option value="private">{t('prejoin.accessLevelPrivate')}</option>
      </select>
      <span className={styles.fieldLabel}>{t('prejoin.accessLevelLabel')}</span>
      <ChevronDown size={18} className={styles.fieldChevron} aria-hidden="true" />
    </label>
  );
}
