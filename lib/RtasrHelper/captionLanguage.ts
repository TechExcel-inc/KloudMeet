/** Languages captions can be spoken in and translated to. */
export const CAPTION_LANGUAGES = ['en', 'ja', 'ko', 'zh'] as const;
export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number];

/** Each language in its own script, so a speaker of it recognises it in any interface. */
export const CAPTION_LANGUAGE_NATIVE: Record<CaptionLanguage, string> = {
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
};

const SETTINGS_KEY = 'kloud-stt-settings';
export const CAPTION_SETTINGS_EVENT = 'kloud-stt-settings-changed';

/**
 * Default caption language for an interface locale: people speak and read captions in the
 * language their interface is in (English interface → English, never Chinese by default).
 */
export function captionLanguageFor(locale?: string | null): CaptionLanguage {
  const code = (locale || '').trim().toLowerCase().slice(0, 2);
  return isCaptionLanguage(code) ? code : 'en';
}

export function isCaptionLanguage(value: unknown): value is CaptionLanguage {
  return typeof value === 'string' && (CAPTION_LANGUAGES as readonly string[]).includes(value);
}

export function nativeLanguageName(lang: string | undefined): string {
  return lang && isCaptionLanguage(lang) ? CAPTION_LANGUAGE_NATIVE[lang] : (lang || '').toUpperCase();
}

/** The reading language saved in caption settings, else the interface language. */
export function readCaptionLanguage(uiLanguage: CaptionLanguage): CaptionLanguage {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? (JSON.parse(raw) as { readLanguage?: unknown }).readLanguage : undefined;
    if (isCaptionLanguage(saved)) return saved;
  } catch {
    /* unreadable settings → interface language */
  }
  return uiLanguage;
}

/** Saves a new reading language (also the default-read and read lists the settings dialog shows). */
export function saveReadCaptionLanguage(lang: CaptionLanguage): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const settings = raw ? JSON.parse(raw) : {};
    settings.readLanguage = lang;
    settings.defaultReadLanguage = lang;
    const list: string[] = Array.isArray(settings.readLanguages) ? settings.readLanguages : [];
    settings.readLanguages = [lang, ...list.filter((l) => l !== lang)];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(CAPTION_SETTINGS_EVENT, { detail: settings }));
  } catch {
    /* storage unavailable: nothing to persist */
  }
}

/** Languages a sentence must be translated into: everyone's reading language except the spoken one. */
export function translationTargets(readLanguages: Iterable<string>, speakLanguage: string): CaptionLanguage[] {
  const out = new Set<CaptionLanguage>();
  for (const lang of readLanguages) {
    if (isCaptionLanguage(lang) && lang !== speakLanguage) out.add(lang);
  }
  return [...out];
}

export type CaptionChoice =
  | { kind: 'original' }
  | { kind: 'translated'; text: string }
  | { kind: 'missing' };

/** Picks what a listener reading `readLanguage` should see for a broadcast sentence. */
export function pickCaptionText(
  payload: {
    speakLanguage?: string;
    translations?: Record<string, string>;
    defaultTargetLanguage?: string;
    defaultTranslatedText?: string;
  },
  readLanguage: string,
): CaptionChoice {
  if (!payload.speakLanguage || payload.speakLanguage === 'auto' || payload.speakLanguage === readLanguage) {
    return { kind: 'original' };
  }
  const shared = payload.translations?.[readLanguage];
  if (shared) return { kind: 'translated', text: shared };
  // Older clients only send one default translation.
  if (payload.defaultTargetLanguage === readLanguage && payload.defaultTranslatedText) {
    return { kind: 'translated', text: payload.defaultTranslatedText };
  }
  return { kind: 'missing' };
}
