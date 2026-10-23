/** Languages captions can be spoken in and translated to. */
export const CAPTION_LANGUAGES = ['en', 'ja', 'ko', 'zh'] as const;
export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number];

/**
 * Default caption language for an interface locale: people speak and read captions in the
 * language their interface is in (English interface → English, never Chinese by default).
 */
export function captionLanguageFor(locale?: string | null): CaptionLanguage {
  const code = (locale || '').trim().toLowerCase().slice(0, 2);
  return (CAPTION_LANGUAGES as readonly string[]).includes(code) ? (code as CaptionLanguage) : 'en';
}
