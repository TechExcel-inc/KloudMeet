'use client';

import React from 'react';
import { Globe, Lock, ShieldCheck } from 'lucide-react';
import { PrejoinSelect } from './PrejoinSelect';
import { useI18n } from './i18n';

export type AccessLevel = 'public' | 'protected' | 'private';

export interface PrejoinAccessLevelSelectProps {
  value: AccessLevel;
  onChange: (value: AccessLevel) => void;
  /** The host's company ("Acme members …"); without one, Private can't be chosen. */
  companyName: string | null;
}

/** Host's pre-join choice of who may join and watch the recording (rules: lib/meetingAccess.ts). */
export function PrejoinAccessLevelSelect({ value, onChange, companyName }: PrejoinAccessLevelSelectProps) {
  const { t } = useI18n();
  const company = companyName ?? '';

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
          summary: t('prejoin.accessLevelPublicSummary'),
          icon: Globe,
        },
        {
          value: 'protected',
          label: t('prejoin.accessLevelProtected'),
          description: company
            ? t('prejoin.accessLevelProtectedDesc', { company })
            : t('prejoin.accessLevelProtectedDescNoCompany'),
          summary: company
            ? t('prejoin.accessLevelProtectedSummary', { company })
            : t('prejoin.accessLevelProtectedSummaryNoCompany'),
          icon: ShieldCheck,
        },
        {
          value: 'private',
          label: t('prejoin.accessLevelPrivate'),
          description: t('prejoin.accessLevelPrivateDesc', { company }),
          summary: t('prejoin.accessLevelPrivateSummary', { company }),
          disabled: !company,
          disabledNote: t('prejoin.accessLevelPrivateNeedsCompany'),
          icon: Lock,
        },
      ]}
    />
  );
}
