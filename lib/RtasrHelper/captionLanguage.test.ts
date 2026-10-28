import { describe, expect, it } from 'vitest';
import {
  captionLanguageFor,
  mergeCaptionSettings,
  parseCaptionSettings,
  pickCaptionText,
  translationTargets,
} from './captionLanguage';

describe('captionLanguageFor', () => {
  it('follows the interface language', () => {
    expect(captionLanguageFor('en')).toBe('en');
    expect(captionLanguageFor('ja')).toBe('ja');
    expect(captionLanguageFor('ko')).toBe('ko');
    expect(captionLanguageFor('zh')).toBe('zh');
  });

  it('never falls back to Chinese for other or unknown locales', () => {
    expect(captionLanguageFor('en-US')).toBe('en');
    expect(captionLanguageFor('fr')).toBe('en');
    expect(captionLanguageFor('')).toBe('en');
    expect(captionLanguageFor(undefined)).toBe('en');
  });
});


describe('translationTargets', () => {
  it('translates once per reading language, never into the spoken one', () => {
    // 20 listeners reading in 3 languages → 2 translations of an English sentence.
    const readers = [...Array(12).fill('en'), ...Array(5).fill('ja'), ...Array(3).fill('ko')];
    expect(translationTargets(readers, 'en').sort()).toEqual(['ja', 'ko']);
  });

  it('ignores unknown languages', () => {
    expect(translationTargets(['fr', 'ja', ''], 'en')).toEqual(['ja']);
  });
});

describe('pickCaptionText', () => {
  const payload = {
    speakLanguage: 'en',
    translations: { ja: 'ローンチ計画を確認しましょう。' },
    defaultTargetLanguage: 'en',
    defaultTranslatedText: "Let's review the launch plan.",
  };

  it('shows the original when the listener reads the spoken language', () => {
    expect(pickCaptionText(payload, 'en')).toEqual({ kind: 'original' });
  });

  it('uses the shared translation instead of translating again', () => {
    expect(pickCaptionText(payload, 'ja')).toEqual({ kind: 'translated', text: 'ローンチ計画を確認しましょう。' });
  });

  it('reports a missing translation (listener joined before the speaker knew their language)', () => {
    expect(pickCaptionText(payload, 'ko')).toEqual({ kind: 'missing' });
  });

  it('still understands older clients that send a single default translation', () => {
    const old = { speakLanguage: 'zh', defaultTargetLanguage: 'en', defaultTranslatedText: 'Hello' };
    expect(pickCaptionText(old, 'en')).toEqual({ kind: 'translated', text: 'Hello' });
  });
});

describe('parseCaptionSettings', () => {
  it('follows the interface language until something is chosen', () => {
    expect(parseCaptionSettings(null, 'ja')).toEqual({ subtitleVisible: true, speakLanguage: 'ja', readLanguage: 'ja' });
    expect(parseCaptionSettings('not json', 'en')).toEqual({ subtitleVisible: true, speakLanguage: 'en', readLanguage: 'en' });
  });

  it('reads what the earlier dialog saved (only the first spoken language was ever used)', () => {
    const raw = JSON.stringify({ subtitleVisible: false, speakLanguages: ['ko', 'en'], defaultReadLanguage: 'zh' });
    expect(parseCaptionSettings(raw, 'en')).toEqual({ subtitleVisible: false, speakLanguage: 'ko', readLanguage: 'zh' });
  });

  it('ignores languages captions do not support', () => {
    const raw = JSON.stringify({ speakLanguage: 'fr', readLanguage: 'auto' });
    expect(parseCaptionSettings(raw, 'en')).toEqual({ subtitleVisible: true, speakLanguage: 'en', readLanguage: 'en' });
  });
});

describe('mergeCaptionSettings', () => {
  it('writes only what changed, so an unchosen language keeps following the interface', () => {
    expect(mergeCaptionSettings({}, { readLanguage: 'ja' })).toEqual({ readLanguage: 'ja', defaultReadLanguage: 'ja' });
  });

  it('keeps the older field names in step and leaves other fields alone', () => {
    const stored = { speakLanguages: ['zh', 'en'], speakLanguage: 'zh', other: 1 };
    expect(mergeCaptionSettings(stored, { speakLanguage: 'en', subtitleVisible: false })).toEqual({
      speakLanguages: ['en'],
      speakLanguage: 'en',
      subtitleVisible: false,
      other: 1,
    });
  });
});
