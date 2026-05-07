'use client';

import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n';

interface STTSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  captionsEnabled?: boolean;
  onToggleCaptions?: () => void;
  canToggleCaptions?: boolean;
}

export function STTSettingsDialog({ isOpen, onClose, captionsEnabled = false, onToggleCaptions, canToggleCaptions = false }: STTSettingsDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [localEnabled, setLocalEnabled] = useState(captionsEnabled);
  const { t } = useI18n();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setLocalEnabled(captionsEnabled);
  }, [captionsEnabled, isOpen]);

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
    if (localEnabled !== captionsEnabled && onToggleCaptions) {
      onToggleCaptions();
    }
    onClose();
  };

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
          maxWidth: '440px',
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
            {t('stt.settingsTitle') || 'Speech to Text Settings'}
          </h2>
          <button
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
            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Toggle Row */}
          {canToggleCaptions && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '15px' }}>{t('stt.enableSpeechToText') || 'Enable Speech to Text'}</span>
              <div 
                style={{ position: 'relative', width: '44px', height: '24px', cursor: 'pointer' }}
                onClick={() => setLocalEnabled(!localEnabled)}
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

          {/* Form Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Field 1 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.applicableLanguage') || 'Applicable language supported'}</label>
              <div style={{
                background: '#444444',
                padding: '12px',
                borderRadius: '6px',
                fontSize: '14px',
                color: '#dddddd'
              }}>
                {t('stt.lang.zh')}, {t('stt.lang.en')}, {t('stt.lang.ja')}, {t('stt.lang.ko')}
              </div>
            </div>

            {/* Field 2 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.hostSpeakLanguage') || 'Default language attendee can speak'}</label>
              <div style={{
                background: '#444444',
                padding: '12px',
                borderRadius: '6px',
                fontSize: '14px',
                color: '#dddddd'
              }}>
                {t('stt.lang.zh')}, {t('stt.lang.en')}, {t('stt.lang.ja')}, {t('stt.lang.ko')}
              </div>
            </div>

            {/* Field 3 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.hostReadLanguage') || 'Default language attendee can read'}</label>
              <div style={{
                background: '#444444',
                padding: '12px',
                borderRadius: '6px',
                fontSize: '14px',
                color: '#dddddd'
              }}>
                {t('stt.lang.zh')}, {t('stt.lang.en')}, {t('stt.lang.ja')}, {t('stt.lang.ko')}
              </div>
            </div>

            {/* Field 4 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.hostTargetLanguage') || 'Default closed caption language (target language for translation)'}</label>
              <div style={{
                background: '#444444',
                padding: '12px',
                borderRadius: '6px',
                fontSize: '14px',
                color: '#dddddd'
              }}>
                {t('stt.lang.en')}
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '24px', display: 'flex', justifyContent: 'flex-end', gap: '16px', marginTop: '4px' }}>
          <button
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
