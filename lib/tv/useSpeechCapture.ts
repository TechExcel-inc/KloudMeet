'use client';

import React from 'react';

/** Web Speech API (Chrome, Edge, Android TV browsers with Google services, Safari). */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechLang(locale: string): string {
  switch (locale) {
    case 'zh':
      return 'zh-CN';
    case 'ja':
      return 'ja-JP';
    case 'ko':
      return 'ko-KR';
    default:
      return 'en-US';
  }
}

export interface VoiceSession {
  supported: boolean;
  listening: boolean;
  /** What has been heard so far (interim) */
  interim: string;
  start(): void;
  stop(): void;
}

/**
 * Push-to-talk on the device itself: one phrase, then `onFinal` with the text.
 * `onError('unsupported' | 'denied' | 'no-speech' | 'network')` explains a failed attempt.
 */
export function useSpeechCapture(
  locale: string,
  onFinal: (text: string) => void,
  onError: (reason: 'unsupported' | 'denied' | 'no-speech' | 'network') => void,
): VoiceSession {
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [interim, setInterim] = React.useState('');
  const recRef = React.useRef<Recognition | null>(null);
  const gotFinalRef = React.useRef(false);
  const cbRef = React.useRef({ onFinal, onError });
  cbRef.current = { onFinal, onError };

  React.useEffect(() => setSupported(recognitionCtor() !== null), []);

  const stop = React.useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = React.useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      cbRef.current.onError('unsupported');
      return;
    }
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = speechLang(locale);
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    gotFinalRef.current = false;
    let latest = '';
    rec.onresult = (e) => {
      let text = '';
      let final = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) final = true;
      }
      latest = text;
      setInterim(text);
      if (final && !gotFinalRef.current) {
        gotFinalRef.current = true;
        cbRef.current.onFinal(text);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') cbRef.current.onError('denied');
      else if (e.error === 'no-speech') cbRef.current.onError('no-speech');
      else if (e.error === 'network') cbRef.current.onError('network');
    };
    rec.onend = () => {
      setListening(false);
      // Some engines end without marking the last result final
      if (!gotFinalRef.current && latest.trim()) {
        gotFinalRef.current = true;
        cbRef.current.onFinal(latest);
      }
      setInterim('');
      if (recRef.current === rec) recRef.current = null;
    };
    recRef.current = rec;
    setInterim('');
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      cbRef.current.onError('unsupported');
    }
  }, [locale]);

  React.useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, start, stop };
}
