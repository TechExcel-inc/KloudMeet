'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import type { RemoteControlRequest } from '@/lib/RemoteControlOverlay';
import { E2EE_UNSUPPORTED, isEncryptionError } from './roomConstants';

interface ReturnHomeProps {
  /** 点击「立即返回主页」 */
  onReturnHome: () => void;
}

interface DuplicateSessionOverlayProps extends ReturnHomeProps {
  /** 在本标签页重新接管会议 */
  onRejoin: () => void;
}

interface ConnectErrorOverlayProps {
  /** 连接失败原因（E2EE 相关错误有单独文案） */
  error: string;
  /** 放弃入会并返回主页 */
  onCancel: () => void;
  /** 用新票据手动重连 */
  onRejoin: () => void;
}

interface RecordingSaveOverlayProps {
  /** saving：正在停止并保存录制；saved：已保存，即将离开 */
  phase: 'saving' | 'saved';
}

interface RemoteControlApprovalDialogProps {
  /** 请求远程控制的参会者 */
  request: RemoteControlRequest;
  onDeny: (identity: string) => void;
  onApprove: (identity: string) => void;
}

interface ShareTakeoverDialogProps {
  /** 当前共享者的显示名；为空时显示「有人」 */
  presenter?: string;
  onCancel: () => void;
  /** 确认接管：停止对方共享并开始本端共享 */
  onConfirm: () => void;
}

/** 录制暂停时录制机器人显示的占位画面，暂停期间的内容不会进入录制文件 */
export function RecorderPausedSlate() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: 'var(--km-stage, #17181c)',
        color: '#e8eaed',
        fontFamily: 'var(--km-font)',
      }}
    >
      <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M10 8v8M14 8v8" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 28, fontWeight: 600 }}>{t('toolbar.recordingPaused')}</span>
    </div>
  );
}

/** 主持人结束会议 */
export function HostEndedOverlay({ onReturnHome }: ReturnHomeProps) {
  const { t } = useI18n();
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(8, 8, 18, 0.88)',
        backdropFilter: 'blur(14px)',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '2rem 2.25rem',
          maxWidth: '420px',
          width: '90%',
          textAlign: 'center',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '12px',
            background: '#fef2f2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem',
          }}
        >
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
            <rect x="2" y="2" width="20" height="20" rx="2" fill="#ef4444" />
            <path
              d="M12 7v7M12 16.5v.5"
              stroke="#fff"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.125rem', color: '#111827' }}>
          {t('meeting.closedByHostTitle')}
        </h3>
        <p style={{ margin: '0 0 1.5rem', color: '#4b5563', lineHeight: 1.6, fontSize: '0.9375rem' }}>
          {t('meeting.closedByHostDesc')}
        </p>
        <button
          type="button"
          onClick={onReturnHome}
          style={{
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            background: '#2563eb',
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          {t('meeting.returnHomeNow')}
        </button>
      </div>
    </div>
  );
}

/** 同一账号在别处入会，本端被顶下线 */
export function DuplicateSessionOverlay({ onReturnHome, onRejoin }: DuplicateSessionOverlayProps) {
  const { t } = useI18n();
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(8, 8, 18, 0.88)',
        backdropFilter: 'blur(14px)',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '2rem 2.25rem',
          maxWidth: '420px',
          width: '90%',
          textAlign: 'center',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '12px',
            background: '#eff6ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem',
          }}
        >
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9" />
            <path d="M3 4v5h5" />
          </svg>
        </div>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.125rem', color: '#111827' }}>
          {t('meeting.duplicateSessionTitle')}
        </h3>
        <p style={{ margin: '0 0 1.5rem', color: '#4b5563', lineHeight: 1.6, fontSize: '0.9375rem' }}>
          {t('meeting.duplicateSessionDesc')}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onReturnHome}
            style={{
              padding: '0.625rem 1.25rem',
              background: '#fff',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            {t('meeting.returnHomeNow')}
          </button>
          <button
            type="button"
            onClick={onRejoin}
            style={{
              padding: '0.625rem 1.25rem',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            {t('meeting.rejoinMeeting')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 被主持人 / 联席主持人移出会议 */
export function RemovedFromMeetingOverlay({ onReturnHome }: ReturnHomeProps) {
  const { t } = useI18n();
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(8, 8, 18, 0.88)',
        backdropFilter: 'blur(14px)',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '2rem 2.25rem',
          maxWidth: '420px',
          width: '90%',
          textAlign: 'center',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '12px',
            background: '#fef2f2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem',
          }}
        >
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="17" y1="8" x2="22" y2="13" />
            <line x1="22" y1="8" x2="17" y2="13" />
          </svg>
        </div>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.125rem', color: '#111827' }}>
          {t('meeting.removedFromMeetingTitle')}
        </h3>
        <p style={{ margin: '0 0 1.5rem', color: '#4b5563', lineHeight: 1.6, fontSize: '0.9375rem' }}>
          {t('meeting.removedFromMeetingDesc')}
        </p>
        <button
          type="button"
          onClick={onReturnHome}
          style={{
            padding: '0.625rem 1.5rem',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          {t('meeting.returnHomeNow')}
        </button>
      </div>
    </div>
  );
}

/** 连接失败（含 E2EE 不支持 / 加密错误），可返回或重新加入 */
export function ConnectErrorOverlay({ error, onCancel, onRejoin }: ConnectErrorOverlayProps) {
  const { t } = useI18n();
  return (
    <div
      id="connect-error-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(8, 8, 18, 0.82)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <style>{`
        @keyframes connErrPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        @keyframes connErrIn {
          from { opacity: 0; transform: scale(0.9) translateY(12px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
      <div
        style={{
          background: 'linear-gradient(145deg, #1a1a2e, #16213e)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px',
          padding: '36px 40px',
          maxWidth: '420px',
          width: '90vw',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(239,68,68,0.12)',
          animation: 'connErrIn 0.3s ease',
          textAlign: 'center',
        }}
      >
        {/* Animated signal icon */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%',
            background: 'rgba(239,68,68,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'connErrPulse 2s ease infinite',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" width="28" height="28">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 14.212A5.25 5.25 0 0117.25 10.5M5.106 17.394A9 9 0 0117.25 10.5M1.924 20.576A13.5 13.5 0 0117.25 10.5M12 18.75h.008v.008H12v-.008z" />
            </svg>
          </div>
        </div>

        <div style={{ fontSize: '18px', fontWeight: 700, color: '#f1f5f9', marginBottom: '8px' }}>
          {isEncryptionError(error)
            ? t('meeting.encryptionErrorTitle')
            : t('meeting.connectionInvalidTitle')}
        </div>
        <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px', lineHeight: 1.6 }}>
          {error === E2EE_UNSUPPORTED
            ? t('meeting.e2eeUnsupported')
            : isEncryptionError(error)
              ? t('meeting.encryptionErrorDesc')
              : t('meeting.connectionInvalidDesc')}
        </div>

        {/* Error detail (collapsible) */}
        <details style={{ marginBottom: '24px', textAlign: 'left' }}>
          <summary style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
            {t('meeting.errorDetails')}
          </summary>
          <div style={{
            marginTop: '8px',
            padding: '10px 12px',
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.15)',
            borderRadius: '8px',
            fontSize: '11px',
            color: '#f87171',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
            lineHeight: 1.5,
          }}>
            {error}
          </div>
        </details>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '10px 20px',
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)',
              color: '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: "'Inter', sans-serif",
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onRejoin}
            style={{
              padding: '10px 24px',
              borderRadius: '10px',
              border: 'none',
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: "'Inter', sans-serif",
              transition: 'all 0.15s',
              boxShadow: '0 2px 10px rgba(59,130,246,0.3)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #2563eb, #1d4ed8)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)'; }}
          >
            {t('meeting.rejoinMeeting')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 录制中离会：保存录制的全屏进度 */
export function RecordingSaveOverlay({ phase }: RecordingSaveOverlayProps) {
  const { t } = useI18n();
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10, 10, 20, 0.88)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        fontFamily: "'Inter', sans-serif",
        gap: '20px',
        animation: 'recordSaveOverlayIn 0.25s ease',
      }}
    >
      <style>{`
        @keyframes recordSaveOverlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes recordSaveSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes recordSaveCheckIn {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {phase === 'saving' ? (
        <>
          {/* Spinner */}
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            border: '4px solid rgba(255,255,255,0.12)',
            borderTopColor: '#a78bfa',
            animation: 'recordSaveSpin 0.9s linear infinite',
          }} />
          {/* Recording dot pulse */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: '#ef4444',
            }} />
            <span style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: 600 }}>
              {t('toolbar.savingRecording')}
            </span>
          </div>
          <span style={{ color: '#9ca3af', fontSize: '13px' }}>
            {t('toolbar.leavingMeeting')}
          </span>
        </>
      ) : (
        /* Saved state */
        <div style={{ animation: 'recordSaveCheckIn 0.3s ease', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 28px rgba(34,197,94,0.4)',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" width="36" height="36">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span style={{ color: '#e2e8f0', fontSize: '17px', fontWeight: 700 }}>
            {t('toolbar.recordingSaved')}
          </span>
          <span style={{ color: '#9ca3af', fontSize: '13px' }}>
            {t('toolbar.leavingMeeting')}
          </span>
        </div>
      )}
    </div>
  );
}

/** 共享方收到远程控制请求时的确认框 */
export function RemoteControlApprovalDialog({ request, onDeny, onApprove }: RemoteControlApprovalDialogProps) {
  return (
    <div
      id="rc-approval-dialog"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        }}
        onClick={() => onDeny(request.requesterIdentity)}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          background: 'linear-gradient(145deg, #1e1e2e, #252538)',
          borderRadius: '16px',
          padding: '28px 32px',
          minWidth: '340px',
          maxWidth: '420px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(139,92,246,0.15)',
          border: '1px solid rgba(255,255,255,0.08)',
          fontFamily: "'Inter', sans-serif",
          animation: 'rcPermDialogIn 0.25s ease',
        }}
      >
        <style>{`
          @keyframes rcPermDialogIn {
            from { opacity: 0; transform: scale(0.92) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          @keyframes rcPermPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(139,92,246,0.4); }
            50% { box-shadow: 0 0 0 8px rgba(139,92,246,0); }
          }
        `}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'rcPermPulse 2s ease infinite',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" width="22" height="22">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#f1f1f4' }}>
              Remote Control Request
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
              Screen sharing permission
            </div>
          </div>
        </div>
        <div style={{ fontSize: '14px', color: '#d1d5db', lineHeight: 1.6, marginBottom: '24px' }}>
          <strong style={{ color: '#c4b5fd' }}>{request.requesterName || request.requesterIdentity}</strong>{' '}
          is requesting to control your shared screen.
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => onDeny(request.requesterIdentity)}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)',
              color: '#d1d5db',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
              fontFamily: "'Inter', sans-serif",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239,68,68,0.15)';
              e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)';
              e.currentTarget.style.color = '#fca5a5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
              e.currentTarget.style.color = '#d1d5db';
            }}
          >
            Decline
          </button>
          <button
            onClick={() => onApprove(request.requesterIdentity)}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
              fontFamily: "'Inter', sans-serif",
              boxShadow: '0 2px 10px rgba(124,58,237,0.3)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #6d28d9, #4c1d95)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, #7c3aed, #5b21b6)';
            }}
          >
            Allow Control
          </button>
        </div>
      </div>
    </div>
  );
}

/** 别人正在共享时，确认是否接管屏幕共享 */
export function ShareTakeoverDialog({ presenter, onCancel, onConfirm }: ShareTakeoverDialogProps) {
  const { t } = useI18n();
  return (
    <div
      id="share-takeover-dialog"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
        }}
        onClick={onCancel}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          background: 'linear-gradient(145deg, #1e1e2e, #252538)',
          borderRadius: '16px',
          padding: '28px 32px',
          minWidth: '360px',
          maxWidth: '440px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(251,146,60,0.18)',
          border: '1px solid rgba(255,255,255,0.08)',
          fontFamily: "'Inter', sans-serif",
          animation: 'shareDialogIn 0.25s ease',
        }}
      >
        <style>{`
          @keyframes shareDialogIn {
            from { opacity: 0; transform: scale(0.92) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          @keyframes shareDialogPulse {
            0%, 100% { box-shadow: 0 0 0 0 rgba(251,146,60,0.4); }
            50% { box-shadow: 0 0 0 8px rgba(251,146,60,0); }
          }
        `}</style>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #f97316, #ea580c)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              animation: 'shareDialogPulse 2.2s ease infinite',
            }}
          >
            {/* Monitor / Share icon */}
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" width="22" height="22">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path strokeLinecap="round" d="M8 21h8M12 17v4" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 9l-3-3-3 3M12 6v6" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#f1f1f4' }}>
              {t('toolbar.shareConflictTitle')}
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
              {t('toolbar.shareConflictSubtitle')}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ fontSize: '14px', color: '#d1d5db', lineHeight: 1.65, marginBottom: '24px' }}>
          {(() => {
            const presenterName =
              presenter ||
              t('toolbar.shareConflictSomeone');
            return (
              <>
                <strong style={{ color: '#fb923c' }}>{presenterName}</strong>
                {' '}
                {t('toolbar.shareConflictBody')}
              </>
            );
          })()}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)',
              color: '#d1d5db',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
              fontFamily: "'Inter', sans-serif",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, #f97316, #ea580c)',
              color: '#fff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
              fontFamily: "'Inter', sans-serif",
              boxShadow: '0 2px 10px rgba(249,115,22,0.35)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #ea580c, #c2410c)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(135deg, #f97316, #ea580c)'; }}
          >
            {t('toolbar.shareConflictConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
