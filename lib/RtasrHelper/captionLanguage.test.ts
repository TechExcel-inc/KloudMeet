import { describe, expect, it } from 'vitest';
import { captionLanguageFor } from './captionLanguage';

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
