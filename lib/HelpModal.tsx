'use client';

import React, { useState, useEffect } from 'react';
import { useI18n } from './i18n';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type HelpTab = 'quickstart' | 'shortcuts' | 'faq' | 'contact';

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<HelpTab>('quickstart');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  const tabs: { id: HelpTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'quickstart',
      label: t('help.quickstart'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      ),
    },
    {
      id: 'shortcuts',
      label: t('help.shortcuts'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: 'faq',
      label: t('help.faq'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
        </svg>
      ),
    },
    {
      id: 'contact',
      label: t('help.contact'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      ),
    },
  ];

  const shortcuts = [
    { keys: ['M'], description: t('help.shortcutMic') },
    { keys: ['V'], description: t('help.shortcutCam') },
    { keys: ['S'], description: t('help.shortcutShare') },
    { keys: ['Esc'], description: t('help.shortcutEsc') },
  ];

  const faqs = [
    { q: t('help.faq1q'), a: t('help.faq1a') },
    { q: t('help.faq2q'), a: t('help.faq2a') },
    { q: t('help.faq3q'), a: t('help.faq3a') },
    { q: t('help.faq4q'), a: t('help.faq4a') },
    { q: t('help.faq5q'), a: t('help.faq5a') },
  ];

  const quickstartItems = [
    {
      step: '01',
      title: t('help.step1title'),
      desc: t('help.step1desc'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
      ),
    },
    {
      step: '02',
      title: t('help.step2title'),
      desc: t('help.step2desc'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
      ),
    },
    {
      step: '03',
      title: t('help.step3title'),
      desc: t('help.step3desc'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      step: '04',
      title: t('help.step4title'),
      desc: t('help.step4desc'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
        </svg>
      ),
    },
    {
      step: '05',
      title: t('help.step5title'),
      desc: t('help.step5desc'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
    },
  ];

  return (
    <div
      id="help-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
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
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          animation: 'helpFadeIn 0.2s ease',
        }}
      />

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        @keyframes helpFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes helpSlideUp { from { opacity: 0; transform: translateY(20px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes helpTabIn { from { opacity: 0; transform: translateX(8px) } to { opacity: 1; transform: translateX(0) } }
        .help-tab-content { animation: helpTabIn 0.18s ease; }
        .help-faq-item { transition: all 0.2s ease; }
        .help-faq-item:hover { background: rgba(139,92,246,0.08) !important; }
        .help-shortcut-row { transition: background 0.15s ease; }
        .help-shortcut-row:hover { background: rgba(139,92,246,0.08) !important; }
        .help-step-card { transition: all 0.2s ease; }
        .help-step-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.3) !important; }
        .help-tab-btn { transition: all 0.15s ease; }
        .help-contact-link { transition: all 0.15s ease; }
        .help-contact-link:hover { background: rgba(139,92,246,0.1) !important; border-color: rgba(139,92,246,0.4) !important; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
      `}</style>

      {/* Modal */}
      <div
        id="help-modal"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '780px',
          maxHeight: '86vh',
          background: 'linear-gradient(145deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          borderRadius: '20px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(139,92,246,0.2)',
          border: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'helpSlideUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px 0',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(124,58,237,0.4)',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" width="20" height="20">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f1f0f5', letterSpacing: '-0.3px' }}>
                {t('help.title')}
              </h2>
              <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af', marginTop: '1px' }}>
                {t('help.subtitle')}
              </p>
            </div>
          </div>
          <button
            id="help-modal-close"
            onClick={onClose}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.06)',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
              fontSize: '16px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Bar */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            padding: '16px 24px 0',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className="help-tab-btn"
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '8px 8px 0 0',
                border: 'none',
                background: activeTab === tab.id ? 'rgba(139,92,246,0.15)' : 'transparent',
                color: activeTab === tab.id ? '#c4b5fd' : 'rgba(255,255,255,0.45)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: activeTab === tab.id ? 600 : 500,
                fontFamily: 'inherit',
                borderBottom: activeTab === tab.id ? '2px solid #8b5cf6' : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '20px 24px 24px',
          }}
        >
          {/* Quick Start */}
          {activeTab === 'quickstart' && (
            <div className="help-tab-content">
              <p style={{ color: '#9ca3af', fontSize: '13px', marginTop: 0, marginBottom: '16px', lineHeight: 1.6 }}>
                {t('help.quickstartDesc')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {quickstartItems.map((item) => (
                  <div
                    key={item.step}
                    className="help-step-card"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '14px',
                      padding: '14px 16px',
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(91,33,182,0.3))',
                          border: '1px solid rgba(139,92,246,0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#a78bfa',
                          flexShrink: 0,
                        }}
                      >
                        {item.icon}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            color: '#7c3aed',
                            letterSpacing: '0.05em',
                            background: 'rgba(124,58,237,0.15)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          {item.step}
                        </span>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#e5e7eb' }}>{item.title}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: '13px', color: '#9ca3af', lineHeight: 1.5 }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tips */}
              <div
                style={{
                  marginTop: '16px',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(5,150,105,0.06))',
                  border: '1px solid rgba(16,185,129,0.15)',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" width="18" height="18" style={{ flexShrink: 0, marginTop: '1px' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#10b981', marginBottom: '3px' }}>{t('help.proTip')}</div>
                  <div style={{ fontSize: '12px', color: '#6ee7b7', lineHeight: 1.5 }}>{t('help.proTipDesc')}</div>
                </div>
              </div>
            </div>
          )}

          {/* Keyboard Shortcuts */}
          {activeTab === 'shortcuts' && (
            <div className="help-tab-content">
              <p style={{ color: '#9ca3af', fontSize: '13px', marginTop: 0, marginBottom: '16px', lineHeight: 1.6 }}>
                {t('help.shortcutsDesc')}
              </p>
              <div
                style={{
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.07)',
                  overflow: 'hidden',
                }}
              >
                {shortcuts.map((s, i) => (
                  <div
                    key={i}
                    className="help-shortcut-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      background: i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent',
                      borderBottom: i < shortcuts.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                      gap: '12px',
                    }}
                  >
                    <span style={{ fontSize: '14px', color: '#d1d5db' }}>{s.description}</span>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      {s.keys.map((key, ki) => (
                        <React.Fragment key={ki}>
                          <kbd
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '3px 9px',
                              fontSize: '12px',
                              fontWeight: 600,
                              fontFamily: 'monospace',
                              color: '#c4b5fd',
                              background: 'rgba(139,92,246,0.12)',
                              border: '1px solid rgba(139,92,246,0.25)',
                              borderRadius: '6px',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                              minWidth: '28px',
                            }}
                          >
                            {key}
                          </kbd>
                          {ki < s.keys.length - 1 && (
                            <span style={{ color: '#6b7280', fontSize: '12px', alignSelf: 'center' }}>+</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  marginTop: '16px',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: 'rgba(59,130,246,0.08)',
                  border: '1px solid rgba(59,130,246,0.15)',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" width="18" height="18" style={{ flexShrink: 0, marginTop: '1px' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
                <div style={{ fontSize: '12px', color: '#93c5fd', lineHeight: 1.5 }}>
                  {t('help.shortcutsNote')}
                </div>
              </div>
            </div>
          )}

          {/* FAQ */}
          {activeTab === 'faq' && (
            <div className="help-tab-content">
              <p style={{ color: '#9ca3af', fontSize: '13px', marginTop: 0, marginBottom: '16px', lineHeight: 1.6 }}>
                {t('help.faqDesc')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {faqs.map((faq, i) => (
                  <FaqItem key={i} question={faq.q} answer={faq.a} />
                ))}
              </div>
            </div>
          )}

          {/* Contact */}
          {activeTab === 'contact' && (
            <div className="help-tab-content">
              <p style={{ color: '#9ca3af', fontSize: '13px', marginTop: 0, marginBottom: '20px', lineHeight: 1.6 }}>
                {t('help.contactDesc')}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                <a
                  href="https://github.com/TechExcel-inc/KloudMeet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="help-contact-link"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(139,92,246,0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#e5e7eb' }}>{t('help.docTitle')}</div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>{t('help.docDesc')}</div>
                  </div>
                </a>

                <a
                  href="mailto:support@kloudmeet.com"
                  className="help-contact-link"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(16,185,129,0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="1.5" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#e5e7eb' }}>{t('help.emailTitle')}</div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>{t('help.emailDesc')}</div>
                  </div>
                </a>

                <a
                  href="https://github.com/TechExcel-inc/KloudMeet/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="help-contact-link"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(245,158,11,0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#e5e7eb' }}>{t('help.issueTitle')}</div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>{t('help.issueDesc')}</div>
                  </div>
                </a>

                <div
                  className="help-contact-link"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    cursor: 'default',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(239,68,68,0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" width="20" height="20">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#e5e7eb' }}>{t('help.versionTitle')}</div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>Kloud Meet v2.0</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="help-faq-item"
      style={{
        borderRadius: '10px',
        background: open ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${open ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.06)'}`,
        overflow: 'hidden',
        transition: 'all 0.2s ease',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '13px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '14px', fontWeight: 600, color: open ? '#c4b5fd' : '#e5e7eb', lineHeight: 1.4 }}>
          {question}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke={open ? '#a78bfa' : 'rgba(255,255,255,0.4)'}
          strokeWidth="2"
          width="16"
          height="16"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease',
          }}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            padding: '0 16px 14px',
            fontSize: '13px',
            color: '#9ca3af',
            lineHeight: 1.6,
            borderTop: '1px solid rgba(139,92,246,0.1)',
            paddingTop: '12px',
          }}
        >
          {answer}
        </div>
      )}
    </div>
  );
}
