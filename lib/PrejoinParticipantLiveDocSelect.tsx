'use client';

import React from 'react';
import { useI18n } from './i18n';

export interface PrejoinParticipantLiveDocSelectProps {
  /** true：普通参会者可以看到文档 AI */
  show: boolean;
  onChange: (show: boolean) => void;
}

/** PrejoinParticipantLiveDocSelect — 主持人选择普通参会者是否看到文档 AI。 */
export function PrejoinParticipantLiveDocSelect({
  show,
  onChange,
}: PrejoinParticipantLiveDocSelectProps) {
  const { t } = useI18n();

  return (
    <label className="kloud-prejoin-participant-livedoc">
      <select
        value={show ? 'show' : 'hide'}
        onChange={(event) => onChange(event.target.value === 'show')}
      >
        <option value="show">{t('prejoin.participantLiveDocShow')}</option>
        <option value="hide">{t('prejoin.participantLiveDocHide')}</option>
      </select>
    </label>
  );
}
