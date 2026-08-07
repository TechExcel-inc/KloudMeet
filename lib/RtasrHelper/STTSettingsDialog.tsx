'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { CCSettingsDialog } from './CCSettingsDialog';

export type SttSettingsTab = 'my' | 'defaults';

interface STTSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  captionsEnabled?: boolean;
  onToggleCaptions?: () => void;
  canToggleCaptions?: boolean;
  /** Host / Co-host：显示 Default Settings；其他人仅 My Settings */
  canManageDefaults?: boolean;
  /** 打开时默认 Tab */
  initialTab?: SttSettingsTab;
  subtitleVisible?: boolean;
}

export function STTSettingsDialog({
  isOpen,
  onClose,
  captionsEnabled = false,
  onToggleCaptions,
  canToggleCaptions = false,
  canManageDefaults = false,
  initialTab,
  subtitleVisible = true,
}: STTSettingsDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(captionsEnabled);
  const [activeTab, setActiveTab] = useState<SttSettingsTab>('my');
  const mySettingsSaveRef = useRef<(() => void) | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setLocalEnabled(captionsEnabled);
  }, [captionsEnabled, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (canManageDefaults && initialTab === 'defaults') {
      setActiveTab('defaults');
    } else {
      setActiveTab('my');
    }
  }, [isOpen, canManageDefaults, initialTab]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  const handleSave = () => {
    mySettingsSaveRef.current?.();
    if (canManageDefaults && localEnabled !== captionsEnabled && onToggleCaptions) {
      onToggleCaptions();
    }
    onClose();
  };

  const showDefaultsTab = canManageDefaults;
  const showMyPanel = !showDefaultsTab || activeTab === 'my';
  const showDefaultsPanel = showDefaultsTab && activeTab === 'defaults';

  const tabBtnStyle = (selected: boolean): React.CSSProperties => ({
    flex: 1,
    background: 'transparent',
    border: 'none',
    borderBottom: selected ? '2px solid #5c94ff' : '2px solid transparent',
    color: selected ? '#ffffff' : 'rgba(255, 255, 255, 0.55)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '10px 8px',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  });

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
      {/* Backdrop */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '560px',
          background: '#1a1a1a',
          borderRadius: '8px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          color: '#ffffff',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 12px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
            {t('stt.settingsTitle') || 'Speech to Text Settings'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              opacity: 0.8,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 启用语音转文字：放在两个 Tab 上方（仅 Host/Co-host） */}
        {canToggleCaptions && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 24px 16px',
            }}
          >
            <span style={{ fontSize: '15px' }}>{t('stt.enableSpeechToText') || 'Enable Speech to Text'}</span>
            <div
              style={{ position: 'relative', width: '44px', height: '24px', cursor: 'pointer' }}
              onClick={() => setLocalEnabled(!localEnabled)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setLocalEnabled(!localEnabled);
                }
              }}
              role="switch"
              aria-checked={localEnabled}
              tabIndex={0}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: localEnabled ? '#3b82f6' : '#666666',
                  borderRadius: '12px',
                  transition: 'background 0.2s',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: '2px',
                  width: '20px',
                  height: '20px',
                  background: '#ffffff',
                  borderRadius: '50%',
                  transition: 'transform 0.2s',
                  transform: localEnabled ? 'translateX(20px)' : 'translateX(0)',
                }}
              />
            </div>
          </div>
        )}

        {/* Tabs：Host/Co-host 两个；其他人仅 My Settings。默认选中 My Settings */}
        <div
          style={{
            display: 'flex',
            padding: '0 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            gap: '4px',
          }}
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'my'}
            style={tabBtnStyle(activeTab === 'my')}
            onClick={() => setActiveTab('my')}
          >
            {t('stt.tabMySettings') || 'My Settings'}
          </button>
          {showDefaultsTab && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'defaults'}
              style={tabBtnStyle(activeTab === 'defaults')}
              onClick={() => setActiveTab('defaults')}
            >
              {t('stt.tabDefaultSettings') || 'Default Settings for all attendees'}
            </button>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px 0', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 始终挂载 My Settings，避免切 Tab 丢状态；非当前 Tab 时隐藏 */}
          <div style={{ display: showMyPanel ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
            <CCSettingsDialog
              isOpen={isOpen}
              onClose={onClose}
              subtitleVisible={subtitleVisible}
              embedded
              saveRef={mySettingsSaveRef}
            />
          </div>

          {showDefaultsTab && (
            <div style={{ display: showDefaultsPanel ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
              {/* Form Fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.applicableLanguage') || 'Applicable language supported'}</label>
                  <div style={{
                    background: '#444444',
                    padding: '12px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    color: '#dddddd',
                  }}>
                    {t('stt.lang.zh')}, {t('stt.lang.en')}, {t('stt.lang.ja')}, {t('stt.lang.ko')}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.hostSpeakLanguage') || 'Default language attendee can speak'}</label>
                  <div style={{
                    background: '#444444',
                    padding: '12px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    color: '#dddddd',
                  }}>
                    {t('stt.lang.zh')}, {t('stt.lang.en')}, {t('stt.lang.ja')}, {t('stt.lang.ko')}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.hostReadLanguage') || 'Default language attendee can read'}</label>
                  <div style={{
                    background: '#444444',
                    padding: '12px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    color: '#dddddd',
                  }}>
                    {t('stt.lang.zh')}, {t('stt.lang.en')}, {t('stt.lang.ja')}, {t('stt.lang.ko')}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.hostTargetLanguage') || 'Default closed caption language (target language for translation)'}</label>
                  <div style={{
                    background: '#444444',
                    padding: '12px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    color: '#dddddd',
                  }}>
                    {t('stt.lang.en')}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '24px', display: 'flex', justifyContent: 'flex-end', gap: '16px', marginTop: '4px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '8px 12px',
            }}
          >
            {t('stt.cancel') || '取消'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              background: '#5c94ff',
              border: 'none',
              borderRadius: '4px',
              color: '#ffffff',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
              padding: '8px 20px',
            }}
          >
            {t('stt.ok') || '确定'}
          </button>
        </div>

      </div>
    </div>
  );
}
