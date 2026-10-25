'use client';

import React from 'react';
import { Globe, Lock, ShieldCheck } from 'lucide-react';
import { PrejoinSelect } from './PrejoinSelect';
import { useI18n } from './i18n';

export type AccessLevel = 'public' | 'protected' | 'private';

export interface PrejoinAccessLevelSelectProps {
  value: AccessLevel;
  onChange: (value: AccessLevel) => void;
}

export function PrejoinAccessLevelSelect({ value, onChange }: PrejoinAccessLevelSelectProps) {
  const { t } = useI18n();

  return (
    <PrejoinSelect
      label={t('prejoin.accessLevelLabel')}
      value={value}
      onChange={onChange}
      options={[
        {
          value: 'public',
          label: t('prejoin.accessLevelPublic'),
          description: t('prejoin.accessLevelPublicDesc'),
          icon: Globe,
        },
        {
          value: 'protected',
          label: t('prejoin.accessLevelProtected'),
          description: t('prejoin.accessLevelProtectedDesc'),
          icon: ShieldCheck,
        },
        {
          value: 'private',
          label: t('prejoin.accessLevelPrivate'),
          description: t('prejoin.accessLevelPrivateDesc'),
          icon: Lock,
        },
      ]}
    />
  );
}
