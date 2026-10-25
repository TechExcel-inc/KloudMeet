'use client';

import React from 'react';
import { CircleOff, FileVideo, MonitorUp, Sparkles } from 'lucide-react';
import { PrejoinSelect } from './PrejoinSelect';
import { useI18n } from './i18n';

export type RecordingOption = 'none' | 'ai_smart' | 'livedoc_full' | 'screen_share';

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
    <PrejoinSelect
      label={t('prejoin.recordingOptionLabel')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'none', label: t('prejoin.recordingNone'), icon: CircleOff },
        { value: 'ai_smart', label: t('prejoin.recordingAiSmart'), icon: Sparkles },
        { value: 'livedoc_full', label: t('prejoin.recordingLivedocFull'), icon: FileVideo },
        { value: 'screen_share', label: t('prejoin.recordingScreenShare'), icon: MonitorUp },
      ]}
    />
  );
}
