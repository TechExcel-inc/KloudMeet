'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

import en from './locales/en.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';

/* ────────── Types ────────── */
export type Locale = 'en' | 'zh' | 'ja' | 'ko';

export interface LocaleOption {
  code: Locale;
  label: string;      // native name shown in menu
  shortCode: string;  // displayed on pill badge (e.g. "EN")
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { code: 'en', label: 'English',  shortCode: 'EN' },
  { code: 'zh', label: '中文',     shortCode: '中' },
  { code: 'ja', label: '日本語',   shortCode: 'JA' },
  { code: 'ko', label: '한국어',   shortCode: 'KO' },
];

/* ────────── Dictionary map ────────── */
const dictionaries: Record<Locale, Record<string, string>> = { en, zh, ja, ko };

/* ────────── Storage key ────────── */
const STORAGE_KEY = 'kloud-locale';

/* ────────── Detect browser language ────────── */
function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const lang = (navigator.language || '').toLowerCase();
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
}

/* ────────── Read persisted locale ────────── */
function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (stored === 'en' || stored === 'zh' || stored === 'ja' || stored === 'ko')) {
      return stored as Locale;
    }
  } catch {}
  return detectBrowserLocale();
}

/* ────────── Context ────────── */
interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Translate a key. Returns the key itself when no translation found. */
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (k) => k,
});

/* ────────── Provider ────────── */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Always start with 'en' to match SSR output and avoid hydration mismatch
  const [locale, setLocaleState] = useState<Locale>('en');
  const [mounted, setMounted] = useState(false);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
    // Also update the <html lang> attribute
    if (typeof document !== 'undefined') {
      document.documentElement.lang = l === 'zh' ? 'zh-CN' : l;
    }
  }, []);

  // On mount, apply the real locale from localStorage / browser detection
  useEffect(() => {
    const real = getInitialLocale();
    setLocaleState(real);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = real === 'zh' ? 'zh-CN' : real;
    }
    setMounted(true);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let text = dictionaries[locale]?.[key] || dictionaries['en']?.[key] || key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        });
      }
      return text;
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

/* ────────── Hook ────────── */
export function useI18n() {
  return useContext(I18nContext);
}
