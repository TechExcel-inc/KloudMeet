'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import { buildInviteLinkForClipboard } from '@/lib/KloudMeetToolbar';
import type { RecordingMode } from '@/lib/recordingControls';

interface MeetingReadyModalProps {
  /** 桌面端客户端（决定复制的邀请链接形式） */
  isDesktop: boolean;
  onClose: () => void;
}

interface RecordConsentModalProps {
  /** 当前选中的云录制模式 */
  mode: RecordingMode;
  onModeChange: (mode: RecordingMode) => void;
  onClose: () => void;
  /** 确认开始录制 */
  onStart: () => void;
}

/** 主持人首次入会后的「会议已就绪」弹窗，可复制邀请链接 */
export function MeetingReadyModal({ isDesktop, onClose }: MeetingReadyModalProps) {
  return (
    <div className="kloud-modal-overlay" onMouseDown={onClose}>
      <div className="kloud-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="kloud-modal-header">
          <h3>Your meeting&apos;s ready</h3>
          <button className="kloud-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="kloud-modal-body">
          <button className="kloud-btn-primary" onClick={() => {
            navigator.clipboard.writeText(buildInviteLinkForClipboard(isDesktop));
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M16 21v-2a4 4 0 00-4-4H5c-1.2 0-2-.8-2-2v-2c0-1.2.8-2 2-2h4a4 4 0 014 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
            Add others
          </button>
          <div style={{ margin: '16px 0', fontSize: '13px', color: '#4b5563' }}>
            Or share this meeting link with others you want in the meeting
          </div>
          <div className="kloud-meeting-link-box">
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {typeof window !== 'undefined' ? window.location.href.split('?')[0] : ''}
            </span>
            <button onClick={() => {
              navigator.clipboard.writeText(buildInviteLinkForClipboard(isDesktop));
            }} title="Copy link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 开始云录制前的同意确认，并选择录制模式 */
export function RecordConsentModal({ mode, onModeChange, onClose, onStart }: RecordConsentModalProps) {
  const { t } = useI18n();
  return (
    <div className="kloud-modal-overlay" onMouseDown={onClose}>
      <div className="kloud-modal kloud-modal-center" onMouseDown={e => e.stopPropagation()}>
        <div className="kloud-modal-body">
          {/* Icon + title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth="1.5" width="32" height="32">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" fill="#ef4444" stroke="none" />
            </svg>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#111827' }}>{t('toolbar.everyoneReady')}</h3>
          </div>
          <p style={{ fontSize: '13px', color: '#4b5563', lineHeight: 1.6, margin: '0 0 16px' }}>
            {t('toolbar.consentNotice')}
          </p>
          {/* Cloud recording mode: chosen before starting (can change while recording) */}
          <div role="radiogroup" aria-label={t('toolbar.recordingModeLabel')} style={{ margin: '0 0 20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>{t('toolbar.recordingModeLabel')}</div>
            {(['follow', 'gallery', 'speaker', 'audio'] as const).map((m) => (
              <label key={m} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 0', cursor: 'pointer', fontSize: '13px', color: '#111827' }}>
                <input
                  type="radio"
                  name="km-recording-mode"
                  checked={mode === m}
                  onChange={() => onModeChange(m)}
                  style={{ marginTop: '2px', accentColor: '#5e5ce6' }}
                />
                <span>
                  {t(`toolbar.recordingMode.${m}`)}
                  <span style={{ display: 'block', fontSize: '12px', color: '#6b7280' }}>{t(`toolbar.recordingMode.${m}Hint`)}</span>
                </span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button className="kloud-btn-text" onClick={onClose}>{t('common.cancel')}</button>
            <button className="kloud-btn-primary" onClick={onStart}>{t('toolbar.startRecording')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
