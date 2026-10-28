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

/** One person's caption choices, kept per browser. */
export interface CaptionSettings {
  /** Captions shown on my own screen (my voice is captioned for others either way). */
  subtitleVisible: boolean;
  /** The language the engine listens for in my voice. */
  speakLanguage: CaptionLanguage;
  /** The language other people's captions are translated into for me. */
  readLanguage: CaptionLanguage;
}

function parseStored(raw: string | null): Record<string, unknown> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Saved settings in any earlier shape; anything not chosen yet follows the interface language. */
export function parseCaptionSettings(raw: string | null, uiLanguage: CaptionLanguage): CaptionSettings {
  const saved = parseStored(raw);
  const firstSpoken = Array.isArray(saved.speakLanguages) ? saved.speakLanguages[0] : undefined;
  return {
    subtitleVisible: saved.subtitleVisible !== false,
    speakLanguage: [saved.speakLanguage, firstSpoken].find(isCaptionLanguage) ?? uiLanguage,
    readLanguage: [saved.readLanguage, saved.defaultReadLanguage].find(isCaptionLanguage) ?? uiLanguage,
  };
}

/**
 * The stored object after a change. Only the changed fields are written, so a language never
 * chosen keeps following the interface language; the older field names are kept in step.
 */
export function mergeCaptionSettings(
  stored: Record<string, unknown>,
  patch: Partial<CaptionSettings>,
): Record<string, unknown> {
  const out = { ...stored };
  if (typeof patch.subtitleVisible === 'boolean') out.subtitleVisible = patch.subtitleVisible;
  if (patch.speakLanguage) {
    out.speakLanguage = patch.speakLanguage;
    out.speakLanguages = [patch.speakLanguage];
  }
  if (patch.readLanguage) {
    out.readLanguage = patch.readLanguage;
    out.defaultReadLanguage = patch.readLanguage;
  }
  return out;
}

/** This browser's caption settings. */
export function loadCaptionSettings(uiLanguage: CaptionLanguage): CaptionSettings {
  try {
    return parseCaptionSettings(localStorage.getItem(SETTINGS_KEY), uiLanguage);
  } catch {
    return parseCaptionSettings(null, uiLanguage);
  }
}

/** Saves a change right away and tells the meeting (captions engine, toolbar, caption bar). */
export function saveCaptionSettings(patch: Partial<CaptionSettings>): void {
  try {
    const settings = mergeCaptionSettings(parseStored(localStorage.getItem(SETTINGS_KEY)), patch);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(CAPTION_SETTINGS_EVENT, { detail: settings }));
  } catch {
    /* storage unavailable: nothing to persist */
  }
}

/** The reading language saved in caption settings, else the interface language. */
export function readCaptionLanguage(uiLanguage: CaptionLanguage): CaptionLanguage {
  return loadCaptionSettings(uiLanguage).readLanguage;
}

/** Saves a new reading language (the caption bar's language menu). */
export function saveReadCaptionLanguage(lang: CaptionLanguage): void {
  saveCaptionSettings({ readLanguage: lang });
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
