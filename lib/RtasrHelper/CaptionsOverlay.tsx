'use client';

/**
 * CaptionsOverlay.tsx — 会议字幕显示组件
 *
 * 布局："发言人: 字幕内容▊" — 同行 inline 显示，类似 YouTube / Google Meet 字幕。
 * 有译文时：译文在上，原文小字在下（翻译不一定准确，原文要保留）。
 * 语言标签（如 "EN → 日本語"）是按钮：点开可换阅读语言，并看到本场会议在用哪些语言。
 * isPartial=true 时显示闪烁光标（表示识别进行中）。
 */

import React from 'react';
import type { CaptionsInfo } from './useCaptions';
import { useI18n } from '../i18n';
import {
  CAPTION_LANGUAGES,
  nativeLanguageName,
  type CaptionLanguage,
} from './captionLanguage';

const TIP_KEY = 'kloud-caption-language-tip-seen';
const TIP_MS = 9000;

interface CaptionsOverlayProps {
  captionsInfo: CaptionsInfo;
  /** 可选：底部偏移（px），避免被 Toolbar 遮挡，默认 80 */
  bottomOffset?: number;
  readLanguage?: CaptionLanguage;
  roomLanguages?: CaptionLanguage[];
  onChangeLanguage?: (lang: CaptionLanguage) => void;
}

export function CaptionsOverlay({
  captionsInfo,
  bottomOffset = 80,
  readLanguage,
  roomLanguages = [],
  onChangeLanguage,
}: CaptionsOverlayProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [showTip, setShowTip] = React.useState(false);
  const visible = captionsInfo.show && !!captionsInfo.text;

  // First captions ever on this browser: point at the language tag once.
  React.useEffect(() => {
    if (!visible || !onChangeLanguage) return;
    let seen = true;
    try {
      seen = localStorage.getItem(TIP_KEY) === '1';
      if (!seen) localStorage.setItem(TIP_KEY, '1');
    } catch {
      /* storage blocked: skip the tip */
    }
    if (seen) return;
    setShowTip(true);
    const timer = setTimeout(() => setShowTip(false), TIP_MS);
    return () => clearTimeout(timer);
  }, [visible, onChangeLanguage]);

  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  if (!visible && !menuOpen) return null;

  const spoken = captionsInfo.spokenLang;
  const shown = captionsInfo.lang || spoken;
  const translated = !!captionsInfo.original && !!spoken && shown !== spoken;
  const tagText = translated
    ? `${(spoken || '').toUpperCase()} → ${nativeLanguageName(shown)}`
    : nativeLanguageName(shown || readLanguage);
  const othersReading = roomLanguages.filter((l) => l !== readLanguage);

  return (
    <>
      <style>{`
        @keyframes kloud-caption-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes kloud-cursor-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        .kloud-caption-bar {
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          z-index: 9000;
          pointer-events: none;
          animation: kloud-caption-in 0.18s ease;
          max-width: min(820px, 94vw);
          width: max-content;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .kloud-caption-bubble {
          display: flex;
          flex-direction: column;
          gap: 2px;
          background: rgba(0, 0, 0, 0.80);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.10);
          box-shadow: 0 4px 24px rgba(0,0,0,0.45);
          border-radius: 10px;
          padding: 7px 14px 9px 18px;
          line-height: 1.6;
          word-break: break-word;
          font-family: 'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        }
        .kloud-caption-main {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        .kloud-caption-line { flex: 1; min-width: 0; }
        .kloud-caption-name {
          font-size: 0.9rem;
          font-weight: 700;
          color: #5bbcff;
          white-space: nowrap;
          margin-right: 7px;
        }
        .kloud-caption-text {
          color: #f5f5f5;
          font-size: 1rem;
          font-weight: 400;
          letter-spacing: 0.01em;
        }
        .kloud-caption-original {
          color: rgba(245, 245, 245, 0.62);
          font-size: 0.82rem;
          line-height: 1.45;
        }
        .kloud-caption-cursor {
          display: inline-block;
          width: 2px;
          height: 1em;
          background: #5bbcff;
          margin-left: 2px;
          vertical-align: text-bottom;
          border-radius: 1px;
          animation: kloud-cursor-blink 0.9s step-end infinite;
        }
        .kloud-caption-tag {
          pointer-events: auto;
          flex: none;
          align-self: center;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 24px;
          padding: 0 9px;
          border: 1px solid rgba(139, 135, 255, 0.55);
          border-radius: 999px;
          background: rgba(94, 92, 230, 0.22);
          color: #d9d7ff;
          font: 700 11.5px/1 'Inter', -apple-system, sans-serif;
          cursor: pointer;
          white-space: nowrap;
        }
        .kloud-caption-tag:hover { background: rgba(94, 92, 230, 0.38); }
        .kloud-caption-tag:focus-visible { outline: 2px solid #8b87ff; outline-offset: 2px; }
        .kloud-caption-menu {
          pointer-events: auto;
          min-width: 220px;
          padding: 8px;
          border-radius: 12px;
          background: rgba(24, 22, 40, 0.97);
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: 0 16px 40px rgba(0,0,0,0.5);
          font-family: 'Inter', -apple-system, sans-serif;
          color: #eee;
        }
        .kloud-caption-menu h3 {
          margin: 4px 8px 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.55);
        }
        .kloud-caption-option {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 8px 10px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          font: 600 14px 'Inter', -apple-system, sans-serif;
          text-align: left;
          cursor: pointer;
        }
        .kloud-caption-option:hover, .kloud-caption-option:focus-visible { background: rgba(255,255,255,0.08); outline: none; }
        .kloud-caption-option[aria-checked='true'] { color: #b9b6ff; }
        .kloud-caption-room {
          margin: 6px 8px 2px;
          padding-top: 8px;
          border-top: 1px solid rgba(255,255,255,0.1);
          font-size: 12px;
          line-height: 1.5;
          color: rgba(255,255,255,0.7);
        }
        .kloud-caption-tip {
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 10px;
          max-width: 460px;
          padding: 8px 10px 8px 14px;
          border-radius: 10px;
          background: #5e5ce6;
          color: #fff;
          font: 500 13px/1.45 'Inter', -apple-system, sans-serif;
          box-shadow: 0 10px 28px rgba(0,0,0,0.35);
        }
        .kloud-caption-tip button {
          flex: none;
          height: 26px;
          padding: 0 10px;
          border: 0;
          border-radius: 999px;
          background: rgba(255,255,255,0.22);
          color: #fff;
          font: 700 12px 'Inter', -apple-system, sans-serif;
          cursor: pointer;
        }
        @media (prefers-reduced-motion: reduce) {
          .kloud-caption-bar, .kloud-caption-cursor { animation: none; }
        }
      `}</style>

      <div className="kloud-caption-bar" style={{ bottom: bottomOffset }}>
        {menuOpen && onChangeLanguage && (
          <div className="kloud-caption-menu" role="menu" aria-label={t('captions.langMenuTitle')}>
            <h3>{t('captions.langMenuTitle')}</h3>
            {CAPTION_LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                role="menuitemradio"
                aria-checked={lang === readLanguage}
                className="kloud-caption-option"
                onClick={() => {
                  onChangeLanguage(lang);
                  setMenuOpen(false);
                }}
              >
                {nativeLanguageName(lang)}
                {lang === readLanguage && <span aria-hidden="true">✓</span>}
              </button>
            ))}
            {othersReading.length > 0 && (
              <div className="kloud-caption-room">
                {t('captions.inMeeting')}: {roomLanguages.map((l) => nativeLanguageName(l)).join(' · ')}
              </div>
            )}
          </div>
        )}

        {showTip && !menuOpen && (
          <div className="kloud-caption-tip" role="note">
            <span>{t('captions.tip')}</span>
            <button type="button" onClick={() => setShowTip(false)}>{t('captions.gotIt')}</button>
          </div>
        )}

        {visible && (
          <div className="kloud-caption-bubble" aria-live="polite" aria-atomic="true" role="status">
            <div className="kloud-caption-main">
              <span className="kloud-caption-line">
                {captionsInfo.userName && <span className="kloud-caption-name">{captionsInfo.userName}:</span>}
                <span className="kloud-caption-text">
                  {captionsInfo.text}
                  {captionsInfo.isPartial && <span className="kloud-caption-cursor" aria-hidden="true" />}
                </span>
              </span>
              {onChangeLanguage && shown && (
                <button
                  type="button"
                  className="kloud-caption-tag"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={`${t('captions.changeLanguage')}: ${tagText}`}
                  onClick={() => {
                    setShowTip(false);
                    setMenuOpen((v) => !v);
                  }}
                >
                  {tagText}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                </button>
              )}
            </div>
            {translated && <span className="kloud-caption-original">{captionsInfo.original}</span>}
          </div>
        )}
      </div>
    </>
  );
}

export default CaptionsOverlay;
