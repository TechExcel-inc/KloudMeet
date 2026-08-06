'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useI18n } from '../i18n';

interface CCSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** 用户本地字幕显示偏好 */
  subtitleVisible?: boolean;
  /** 嵌入 STT 弹窗 Tab：只渲染表单内容，由父级控制外壳与保存 */
  embedded?: boolean;
  /** 父级在点 OK 时调用，保存个人设置且不关闭 */
  saveRef?: React.MutableRefObject<(() => void) | null>;
}

const LANGUAGES = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: '英语' },
  { id: 'ja', label: '日语' },
  { id: 'ko', label: '韩语' },
] as const;

type LangId = (typeof LANGUAGES)[number]['id'];

const TRIGGER_STYLE: React.CSSProperties = {
  width: '100%',
  minHeight: '48px',
  background: '#3a3a3a',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  borderRadius: '8px',
  padding: '12px 40px 12px 14px',
  fontSize: '14px',
  color: '#f0f0f0',
  fontFamily: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  position: 'relative',
  boxSizing: 'border-box',
};

const MENU_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 'calc(100% + 6px)',
  background: '#2a2a2a',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  borderRadius: '10px',
  boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)',
  zIndex: 20,
  overflow: 'hidden',
  padding: '6px',
  boxSizing: 'border-box',
};

const OPTION_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  width: '100%',
  minHeight: '48px',
  padding: '12px 14px',
  border: 'none',
  borderRadius: '8px',
  background: 'transparent',
  color: '#f0f0f0',
  fontSize: '15px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  boxSizing: 'border-box',
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      width="18"
      height="18"
      style={{
        position: 'absolute',
        right: '14px',
        top: '50%',
        transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
        opacity: 0.75,
        pointerEvents: 'none',
        transition: 'transform 0.15s ease',
      }}
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface LanguageDropdownProps {
  label: string;
  ids: string[];
  multiple: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (ids: string[]) => void;
  getLabel: (id: string) => string;
}

function LanguageDropdown({
  label,
  ids,
  multiple,
  open,
  onToggleOpen,
  onChange,
  getLabel,
}: LanguageDropdownProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      onToggleOpen();
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open, onToggleOpen]);

  const displayText =
    ids.length > 0 ? ids.map((id) => getLabel(id)).join(', ') : '—';

  const handlePick = (id: string) => {
    if (!multiple) {
      onChange([id]);
      onToggleOpen();
      return;
    }
    if (ids.includes(id)) {
      // 至少保留一项，避免空选
      if (ids.length <= 1) return;
      onChange(ids.filter((x) => x !== id));
      return;
    }
    onChange([...ids, id]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <span style={{ fontSize: '14px', color: '#eeeeee' }}>{label}</span>
      <div ref={rootRef} style={{ position: 'relative' }}>
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={onToggleOpen}
          style={{
            ...TRIGGER_STYLE,
            borderColor: open ? 'rgba(92, 148, 255, 0.7)' : 'rgba(255, 255, 255, 0.14)',
          }}
        >
          <span style={{ display: 'block', lineHeight: 1.4, paddingRight: '4px' }}>
            {displayText}
          </span>
          <ChevronIcon open={open} />
        </button>

        {open && (
          <div style={MENU_STYLE} role="listbox" aria-multiselectable={multiple || undefined}>
            {LANGUAGES.map((lang) => {
              const selected = ids.includes(lang.id);
              return (
                <button
                  key={lang.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => handlePick(lang.id)}
                  style={{
                    ...OPTION_STYLE,
                    background: selected ? 'rgba(59, 130, 246, 0.22)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!selected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = selected
                      ? 'rgba(59, 130, 246, 0.22)'
                      : 'transparent';
                  }}
                >
                  <span
                    style={{
                      width: '22px',
                      height: '22px',
                      flexShrink: 0,
                      borderRadius: multiple ? '6px' : '50%',
                      border: selected ? 'none' : '2px solid rgba(255,255,255,0.35)',
                      background: selected ? '#3b82f6' : 'transparent',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {selected && multiple && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" width="14" height="14">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {selected && !multiple && (
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#fff' }} />
                    )}
                  </span>
                  <span>{getLabel(lang.id)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeLangList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const ids = value.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return ids.length > 0 ? ids : fallback;
}

export function CCSettingsDialog({
  isOpen,
  onClose,
  subtitleVisible = true,
  embedded = false,
  saveRef,
}: CCSettingsDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [localVisible, setLocalVisible] = useState(subtitleVisible);
  const [speakLanguages, setSpeakLanguages] = useState<string[]>(['zh', 'en', 'ja', 'ko']);
  const [readLanguages, setReadLanguages] = useState<string[]>(['zh', 'en', 'ja', 'ko']);
  const [defaultReadLanguage, setDefaultReadLanguage] = useState('en');
  const [openMenu, setOpenMenu] = useState<'speak' | 'read' | 'defaultRead' | null>(null);

  const { t } = useI18n();

  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem('kloud-stt-settings');
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        speakLanguages?: string[];
        readLanguages?: string[];
        speakLanguage?: string;
        readLanguage?: string;
        defaultReadLanguage?: string;
      };
      setSpeakLanguages(
        normalizeLangList(
          parsed.speakLanguages,
          parsed.speakLanguage ? [parsed.speakLanguage] : ['zh', 'en', 'ja', 'ko'],
        ),
      );
      setReadLanguages(
        normalizeLangList(
          parsed.readLanguages,
          parsed.readLanguage ? [parsed.readLanguage] : ['zh', 'en', 'ja', 'ko'],
        ),
      );
      if (parsed.defaultReadLanguage) {
        setDefaultReadLanguage(parsed.defaultReadLanguage);
      } else if (parsed.readLanguage) {
        setDefaultReadLanguage(parsed.readLanguage);
      }
    } catch {
      // ignore invalid localStorage
    }
  }, []);

  useEffect(() => {
    setLocalVisible(subtitleVisible);
  }, [subtitleVisible, isOpen]);

  useEffect(() => {
    if (!isOpen) setOpenMenu(null);
  }, [isOpen]);

  useEffect(() => {
    if (embedded) return;
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, embedded]);

  const persistSettings = useCallback(() => {
    try {
      const raw = localStorage.getItem('kloud-stt-settings');
      const settings = raw ? JSON.parse(raw) : {};
      settings.subtitleVisible = localVisible;
      settings.speakLanguages = speakLanguages;
      settings.readLanguages = readLanguages;
      settings.defaultReadLanguage = defaultReadLanguage;
      settings.readLanguage = defaultReadLanguage;
      settings.speakLanguage = speakLanguages.length > 0 ? speakLanguages[0] : 'zh';

      localStorage.setItem('kloud-stt-settings', JSON.stringify(settings));
      window.dispatchEvent(new CustomEvent('kloud-stt-settings-changed', { detail: settings }));
    } catch (e) {
      console.error('Failed to save cc settings', e);
    }
  }, [localVisible, speakLanguages, readLanguages, defaultReadLanguage]);

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = persistSettings;
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, persistSettings]);

  if (!mounted || !isOpen) return null;

  const handleSave = () => {
    persistSettings();
    onClose();
  };

  const getLangLabel = (id: string) =>
    t(`stt.lang.${id}`) || LANGUAGES.find((l) => l.id === (id as LangId))?.label || id;

  const toggleMenu = (key: 'speak' | 'read' | 'defaultRead') => {
    setOpenMenu((prev) => (prev === key ? null : key));
  };

  const renderFormContent = () => (
    <div style={{ padding: embedded ? '0' : '0 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '15px' }}>{t('stt.showSpeechToText') || 'Show Speech to Text'}</span>
        <div
          style={{ position: 'relative', width: '44px', height: '24px', cursor: 'pointer' }}
          onClick={() => setLocalVisible(!localVisible)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setLocalVisible(!localVisible);
            }
          }}
          role="switch"
          aria-checked={localVisible}
          tabIndex={0}
        >
          <div style={{ position: 'absolute', inset: 0, background: localVisible ? '#3b82f6' : '#666666', borderRadius: '12px', transition: 'background 0.2s' }} />
          <div style={{ position: 'absolute', top: '2px', left: '2px', width: '20px', height: '20px', background: '#ffffff', borderRadius: '50%', transition: 'transform 0.2s', transform: localVisible ? 'translateX(20px)' : 'translateX(0)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <LanguageDropdown
          label={t('stt.ccSpeakLanguage') || 'Select language I can speak'}
          ids={speakLanguages}
          multiple
          open={openMenu === 'speak'}
          onToggleOpen={() => toggleMenu('speak')}
          onChange={setSpeakLanguages}
          getLabel={getLangLabel}
        />

        <LanguageDropdown
          label={t('stt.ccReadLanguage') || 'Select language I can read'}
          ids={readLanguages}
          multiple
          open={openMenu === 'read'}
          onToggleOpen={() => toggleMenu('read')}
          onChange={setReadLanguages}
          getLabel={getLangLabel}
        />

        <LanguageDropdown
          label={t('stt.ccTargetLanguage') || 'Select default read language'}
          ids={[defaultReadLanguage]}
          multiple={false}
          open={openMenu === 'defaultRead'}
          onToggleOpen={() => toggleMenu('defaultRead')}
          onChange={(ids) => {
            if (ids[0]) setDefaultReadLanguage(ids[0]);
          }}
          getLabel={getLangLabel}
        />
      </div>
    </div>
  );

  if (embedded) {
    return renderFormContent();
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.4)' }} />

      <div
        style={{ position: 'relative', width: '100%', maxWidth: '440px', background: '#1a1a1a', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', color: '#ffffff' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{t('stt.ccSettingsTitle') || 'Closed Caption Settings'}</h2>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', padding: '4px', opacity: 0.8 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {renderFormContent()}

        <div style={{ padding: '24px', display: 'flex', justifyContent: 'flex-end', gap: '16px', marginTop: '4px' }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#ffffff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', padding: '8px 12px' }}>
            {t('stt.cancel') || '取消'}
          </button>
          <button type="button" onClick={handleSave} style={{ background: '#5c94ff', border: 'none', borderRadius: '4px', color: '#ffffff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', padding: '8px 20px' }}>
            {t('stt.ok') || '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}
