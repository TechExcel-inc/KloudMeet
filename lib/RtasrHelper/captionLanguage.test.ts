import { describe, expect, it } from 'vitest';
import { captionLanguageFor, pickCaptionText, translationTargets } from './captionLanguage';

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
