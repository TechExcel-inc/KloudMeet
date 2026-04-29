'use client';

import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n';

interface CCSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  // This represents the user's LOCAL subtitle visibility preference
  subtitleVisible?: boolean;
}

const LANGUAGES = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: '英语' },
  { id: 'ja', label: '日语' },
  { id: 'ko', label: '韩语' },
];

export function CCSettingsDialog({ isOpen, onClose, subtitleVisible = true }: CCSettingsDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [localVisible, setLocalVisible] = useState(subtitleVisible);
  
  const [speakLanguages, setSpeakLanguages] = useState<string[]>(['zh', 'en', 'ja', 'ko']);
  const [readLanguages, setReadLanguages] = useState<string[]>(['zh', 'en', 'ja', 'ko']);
  const [defaultReadLanguage, setDefaultReadLanguage] = useState<string>('en');

  const { t } = useI18n();

  // Sub-modal state
  const [activeModal, setActiveModal] = useState<'speak' | 'read' | 'defaultRead' | null>(null);
  const [tempSelection, setTempSelection] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem('kloud-stt-settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.speakLanguages) setSpeakLanguages(parsed.speakLanguages);
        if (parsed.readLanguages) setReadLanguages(parsed.readLanguages);
        if (parsed.defaultReadLanguage) setDefaultReadLanguage(parsed.defaultReadLanguage);
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    setLocalVisible(subtitleVisible);
  }, [subtitleVisible, isOpen]);

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
    try {
      const raw = localStorage.getItem('kloud-stt-settings');
      const settings = raw ? JSON.parse(raw) : {};
      settings.subtitleVisible = localVisible;
      settings.speakLanguages = speakLanguages;
      settings.readLanguages = readLanguages;
      settings.defaultReadLanguage = defaultReadLanguage;
      // Also map it to the old properties for compatibility with existing useCaptions logic
      settings.readLanguage = defaultReadLanguage;
      settings.speakLanguage = speakLanguages.length > 0 ? speakLanguages[0] : 'zh';
      
      localStorage.setItem('kloud-stt-settings', JSON.stringify(settings));
      window.dispatchEvent(new CustomEvent('kloud-stt-settings-changed', { detail: settings }));
    } catch (e) {
      console.error('Failed to save cc settings', e);
    }
    onClose();
  };

  const openSubModal = (type: 'speak' | 'read' | 'defaultRead') => {
    setActiveModal(type);
    if (type === 'speak') setTempSelection([...speakLanguages]);
    else if (type === 'read') setTempSelection([...readLanguages]);
    else if (type === 'defaultRead') setTempSelection([defaultReadLanguage]);
  };

  const closeSubModal = () => setActiveModal(null);

  const saveSubModal = () => {
    if (activeModal === 'speak') setSpeakLanguages(tempSelection);
    else if (activeModal === 'read') setReadLanguages(tempSelection);
    else if (activeModal === 'defaultRead' && tempSelection.length > 0) setDefaultReadLanguage(tempSelection[0]);
    closeSubModal();
  };

  const toggleTempLang = (id: string, isSingle: boolean) => {
    if (isSingle) {
      setTempSelection([id]);
      return;
    }
    if (tempSelection.includes(id)) {
      setTempSelection(tempSelection.filter(l => l !== id));
    } else {
      setTempSelection([...tempSelection, id]);
    }
  };

  const getLanguageLabels = (ids: string[]) => {
    return ids.map(id => t(`stt.lang.${id}`) || LANGUAGES.find(l => l.id === id)?.label || id).join(', ');
  };

  const renderSubModal = () => {
    if (!activeModal) return null;
    let title = '';
    let isSingle = false;
    if (activeModal === 'speak') title = t('stt.ccSpeakLanguage') || 'Select language I can speak';
    if (activeModal === 'read') title = t('stt.ccReadLanguage') || 'Select language I can read';
    if (activeModal === 'defaultRead') {
      title = t('stt.ccTargetLanguage') || 'Select default read language';
      isSingle = true;
    }

    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.4)' }} onClick={closeSubModal} />
        <div style={{ position: 'relative', width: '100%', maxWidth: '440px', background: '#1a1a1a', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', color: '#ffffff' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{title}</h2>
            <button onClick={closeSubModal} style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', padding: '4px', opacity: 0.8 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div style={{ padding: '8px 24px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {LANGUAGES.map(lang => {
              const checked = tempSelection.includes(lang.id);
              return (
                <label key={lang.id} onClick={(e) => { e.preventDefault(); toggleTempLang(lang.id, isSingle); }} style={{ display: 'flex', alignItems: 'center', gap: '16px', cursor: 'pointer' }}>
                  <div style={{
                    width: '20px', height: '20px',
                    background: checked ? '#3b82f6' : 'transparent',
                    border: checked ? 'none' : '2px solid #666',
                    borderRadius: isSingle ? '50%' : '4px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {checked && !isSingle && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" width="14" height="14">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {checked && isSingle && (
                      <div style={{ width: '8px', height: '8px', background: 'white', borderRadius: '50%' }} />
                    )}
                  </div>
                  <span style={{ fontSize: '15px' }}>{t(`stt.lang.${lang.id}`) || lang.label}</span>
                </label>
              );
            })}
          </div>

          <div style={{ padding: '24px', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
            <button onClick={closeSubModal} style={{ background: 'transparent', border: 'none', color: '#ffffff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', padding: '8px 12px' }}>
              {t('stt.cancel') || '取消'}
            </button>
            <button onClick={saveSubModal} style={{ background: '#5c94ff', border: 'none', borderRadius: '4px', color: '#ffffff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', padding: '8px 20px' }}>
              {t('stt.ok') || '确定'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
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
          visibility: activeModal ? 'hidden' : 'visible', // Hide main modal visually when sub-modal is open
        }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !activeModal) onClose();
        }}
      >
        {/* Backdrop */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.4)' }} />

        {/* Modal */}
        <div
          style={{ position: 'relative', width: '100%', maxWidth: '440px', background: '#1a1a1a', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', color: '#ffffff' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 16px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{t('stt.ccSettingsTitle') || 'Closed Caption Settings'}</h2>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', padding: '4px', opacity: 0.8 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Toggle Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '15px' }}>{t('stt.showSpeechToText') || 'Show Speech to Text'}</span>
              <div style={{ position: 'relative', width: '44px', height: '24px', cursor: 'pointer' }} onClick={() => setLocalVisible(!localVisible)}>
                <div style={{ position: 'absolute', inset: 0, background: localVisible ? '#3b82f6' : '#666666', borderRadius: '12px', transition: 'background 0.2s' }} />
                <div style={{ position: 'absolute', top: '2px', left: '2px', width: '20px', height: '20px', background: '#ffffff', borderRadius: '50%', transition: 'transform 0.2s', transform: localVisible ? 'translateX(20px)' : 'translateX(0)' }} />
              </div>
            </div>

            {/* Form Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Field 1 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.ccSpeakLanguage') || 'Select language I can speak'}</label>
                  <button onClick={() => openSubModal('speak')} style={{ background: '#e5e5e5', border: 'none', borderRadius: '4px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, color: '#000', cursor: 'pointer' }}>{t('stt.selectBtn') || 'Select'}</button>
                </div>
                <div style={{ background: '#444444', padding: '12px', borderRadius: '6px', fontSize: '14px', color: '#dddddd', minHeight: '45px' }}>
                  {getLanguageLabels(speakLanguages)}
                </div>
              </div>

              {/* Field 2 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.ccReadLanguage') || 'Select language I can read'}</label>
                  <button onClick={() => openSubModal('read')} style={{ background: '#e5e5e5', border: 'none', borderRadius: '4px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, color: '#000', cursor: 'pointer' }}>{t('stt.selectBtn') || 'Select'}</button>
                </div>
                <div style={{ background: '#444444', padding: '12px', borderRadius: '6px', fontSize: '14px', color: '#dddddd', minHeight: '45px' }}>
                  {getLanguageLabels(readLanguages)}
                </div>
              </div>

              {/* Field 3 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '14px', color: '#eeeeee' }}>{t('stt.ccTargetLanguage') || 'Select default read language'}</label>
                  <button onClick={() => openSubModal('defaultRead')} style={{ background: '#e5e5e5', border: 'none', borderRadius: '4px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, color: '#000', cursor: 'pointer' }}>{t('stt.selectBtn') || 'Select'}</button>
                </div>
                <div style={{ background: '#444444', padding: '12px', borderRadius: '6px', fontSize: '14px', color: '#dddddd', minHeight: '45px' }}>
                  {getLanguageLabels([defaultReadLanguage])}
                </div>
              </div>

            </div>
          </div>

          {/* Footer */}
          <div style={{ padding: '24px', display: 'flex', justifyContent: 'flex-end', gap: '16px', marginTop: '4px' }}>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#ffffff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', padding: '8px 12px' }}>
              {t('stt.cancel') || '取消'}
            </button>
            <button onClick={handleSave} style={{ background: '#5c94ff', border: 'none', borderRadius: '4px', color: '#ffffff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', padding: '8px 20px' }}>
              {t('stt.ok') || '确定'}
            </button>
          </div>
        </div>
      </div>
      
      {renderSubModal()}
    </>
  );
}
