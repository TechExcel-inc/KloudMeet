'use client';

import { useI18n } from '@/lib/i18n';
import { isWritingLanguage, WRITING_LANGUAGES, type WritingLanguage } from '@/lib/replayWriting';

export function WritingLanguageSelect({ value, onChange }: {
  value: WritingLanguage;
  onChange: (language: WritingLanguage) => void;
}) {
  const { t } = useI18n();
  return (
    <select value={value} onChange={event => {
      const language = event.target.value;
      if (isWritingLanguage(language)) onChange(language);
    }}>
      {WRITING_LANGUAGES.map(language => (
        <option key={language} value={language}>{t(`replay.write.language.${language}`)}</option>
      ))}
    </select>
  );
}
