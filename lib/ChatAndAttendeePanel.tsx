import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useRoomContext, useParticipants } from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { useI18n } from './i18n';
import { getInitials } from './getInitials';
import { ParticipantAttendeeRowMoreMenu } from './ParticipantRoleMenu';
import type { ChatMsg, ChatUploadState } from './chatProtocol';
import { isRecorderParticipant } from './recorderParticipant';

export type { ChatMsg } from './chatProtocol';

// ════════════════════════════════════
// Custom Chat Panel (uses publishData directly)
// ════════════════════════════════════
export interface ChatPanelProps {
  messages: ChatMsg[];
  onSend: (message: string) => void;
  /** Selected local file to upload into LiveDoc (picker opens in chat, keeps user gesture) */
  onAttachFile?: (file: File) => void;
  /** Open a livedoc attachment on the meeting stage */
  onOpenLivedoc?: (msg: ChatMsg) => void;
  attachBusy?: boolean;
  attachDisabled?: boolean;
  /** Send again a message the server didn't take */
  onRetrySend?: (msg: ChatMsg) => void;
  /** The local user's file share in progress or failed */
  upload?: ChatUploadState | null;
  onRetryUpload?: () => void;
  onDismissUpload?: () => void;
}

export function ChatPanel({
  messages,
  onSend,
  onAttachFile,
  onOpenLivedoc,
  attachBusy = false,
  attachDisabled = false,
  onRetrySend,
  upload = null,
  onRetryUpload,
  onDismissUpload,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [showUploadConsent, setShowUploadConsent] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, upload]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [draft]);

  const sendDraft = useCallback(() => {
    if (!draft.trim()) return;

    onSend(draft.trim());
    setDraft('');
  }, [draft, onSend]);

  const handleSend = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    sendDraft();
  }, [sendDraft]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter that confirms a Chinese / Japanese / Korean word is the input method's, not a send
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    sendDraft();
  }, [sendDraft]);

  const handleAttachClick = useCallback(() => {
    if (attachDisabled || attachBusy || !onAttachFile) return;
    // Require explicit consent before opening the file picker
    setShowUploadConsent(true);
  }, [attachDisabled, attachBusy, onAttachFile]);

  const handleUploadConsentCancel = useCallback(() => {
    setShowUploadConsent(false);
  }, []);

  const handleUploadConsentAgree = useCallback(() => {
    setShowUploadConsent(false);
    // Open picker in the Agree click handler (preserves user gesture)
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onAttachFile) return;
    onAttachFile(file);
  }, [onAttachFile]);

  return (
    <div className="kloud-chat-panel">
      <div className="kloud-chat-messages">
        {messages.length === 0 && (
          <div className="kloud-chat-empty">{t('chat.noMessages') || 'No messages yet. Say hello! 👋'}</div>
        )}
        {messages.map((msg) => {
          const isLivedoc = msg.kind === 'livedoc' && msg.attachment;
          const status = msg.attachment?.status;
          const canOpen =
            isLivedoc &&
            status === 'ready' &&
            typeof msg.attachment?.itemId === 'number' &&
            msg.attachment.itemId > 0;
          return (
            <div key={msg.clientMessageId} className={`kloud-chat-entry ${msg.isLocal ? 'local' : 'remote'}`}>
              <div className="kloud-chat-meta">
                <span className="kloud-chat-sender">{msg.isLocal ? (t('chat.you') || 'You') : msg.senderName}</span>
                <span className="kloud-chat-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              {isLivedoc ? (
                <button
                  type="button"
                  className={`kloud-chat-doc-card ${canOpen ? 'clickable' : ''}`}
                  disabled={!canOpen}
                  onClick={() => {
                    if (canOpen && onOpenLivedoc) onOpenLivedoc(msg);
                  }}
                  title={canOpen ? (t('chat.openLiveDoc') || 'Open as LiveDoc') : undefined}
                >
                  <span className="kloud-chat-doc-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </span>
                  <span className="kloud-chat-doc-body">
                    <span className="kloud-chat-doc-name">{msg.attachment?.fileName || msg.message}</span>
                    <span className="kloud-chat-doc-status">
                      {status === 'converting'
                        ? (t('chat.docConverting') || 'Converting…')
                        : status === 'uploading'
                          ? (t('chat.docUploading') || 'Uploading…')
                          : status === 'failed'
                            ? (t('chat.docFailed') || 'Upload failed')
                            : (t('chat.openLiveDoc') || 'Open as LiveDoc')}
                    </span>
                  </span>
                </button>
              ) : (
                <div className="kloud-chat-text">{msg.message}</div>
              )}
              {msg.isLocal && msg.sendFailed ? (
                <div className="kloud-chat-failed" role="status">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7.5v5.5M12 16.5h.01" />
                  </svg>
                  {t('chat.notSent')}
                  {onRetrySend ? (
                    <button type="button" className="kloud-chat-inline-btn" onClick={() => onRetrySend(msg)}>
                      {t('chat.retry')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {upload ? (
          <div className={`kloud-chat-upload ${upload.state}`} role="status" aria-live="polite">
            {upload.state === 'uploading' ? (
              <>
                <span className="kloud-chat-attach-spinner" aria-hidden="true" />
                <span className="kloud-chat-upload-text">{t('chat.uploadingFile', { name: upload.fileName })}</span>
              </>
            ) : (
              <>
                <span className="kloud-chat-upload-text">
                  <b>{t('chat.uploadFailedTitle', { name: upload.fileName })}</b>
                  <span>
                    {upload.reason === 'notReady'
                      ? t('chat.uploadFailNotReady')
                      : upload.reason === 'timeout'
                        ? t('chat.uploadFailTimeout')
                        : t('chat.uploadFailConvert')}
                  </span>
                </span>
                <span className="kloud-chat-upload-actions">
                  {onRetryUpload ? (
                    <button type="button" className="kloud-chat-inline-btn" onClick={onRetryUpload}>
                      {t('chat.retry')}
                    </button>
                  ) : null}
                  {onDismissUpload ? (
                    <button type="button" className="kloud-chat-inline-btn quiet" onClick={onDismissUpload}>
                      {t('chat.dismiss')}
                    </button>
                  ) : null}
                </span>
              </>
            )}
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>
      <form className="kloud-chat-form" onSubmit={handleSend}>
        <div className="kloud-chat-input-shell">
          {onAttachFile && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="kloud-chat-file-input"
                accept=".stl,.sldprt,.slddrw,.dwg,.zip,.key,.pages,.numbers,.mp3,.m4a,.mp4,.jpg,.jpeg,.png,.doc,.docx,.ppt,.pptx,.pdf,.xls,.xlsx,.rar,.rp,.sketch,.psd,.js,.txt,.md,.html,.ico,.xmind,.xd,.svg,.ai,.css,.json,video/mp4,image/jpeg,image/png,application/pdf"
                onChange={handleFileInputChange}
              />
              <button
                type="button"
                className="kloud-chat-attach"
                onClick={handleAttachClick}
                disabled={attachDisabled || attachBusy}
                title={t('chat.attachFile') || 'Attach file'}
                aria-label={t('chat.attachFile') || 'Attach file'}
              >
                {attachBusy ? (
                  <span className="kloud-chat-attach-spinner" />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                )}
              </button>
            </>
          )}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={4000}
            rows={1}
            placeholder={t('chat.typeMessage') || 'Type a message...'}
            className="kloud-chat-input"
          />
          <button type="submit" className="kloud-chat-send" disabled={!draft.trim()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </form>
      {showUploadConsent && (
        <div
          className="kloud-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kloud-chat-upload-consent-title"
          onMouseDown={handleUploadConsentCancel}
        >
          <div className="kloud-confirm-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="kloud-confirm-title" id="kloud-chat-upload-consent-title">
              {t('chat.uploadConsentTitle') || 'Share with attendees?'}
            </div>
            <div className="kloud-confirm-text">
              {t('chat.uploadConsentBody') ||
                'This article will be available to meeting attendees and will remain viewable after the meeting ends.'}
            </div>
            <div className="kloud-confirm-actions">
              <button type="button" className="kloud-confirm-cancel" onClick={handleUploadConsentCancel}>
                {t('chat.uploadConsentCancel') || t('common.cancel') || 'Cancel'}
              </button>
              <button type="button" className="kloud-confirm-proceed" onClick={handleUploadConsentAgree}>
                {t('chat.uploadConsentAgree') || 'Agree and upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════
// Attendee Panel (participant list with roles)
// ════════════════════════════════════
const ATTENDEE_ROLE_LABEL_KEYS: Record<string, string> = {
  'role-host': 'roleMenu.roleHost',
  'role-cohost': 'roleMenu.roleCohost',
  'role-presenter': 'roleMenu.rolePresenter',
  'role-copresenter': 'roleMenu.roleCopresenter',
  'role-attendee': 'roleMenu.roleAttendee',
};

interface AttendeePanelProps {
  hostIdentity: string | null;
  copresenterIdentities: string[];
  cohostIdentities: string[];
  localIdentity: string;
  autoPresenterIdentity: string | null;
  /** Whether the local user has permission to mute/unmute all */
  canMuteAll?: boolean;
  /** Whether "Mute All" has been activated (controls button state) */
  muteAllActive?: boolean;
  onMuteAll?: () => void;
  onUnmuteAll?: () => void;
  /** Callback to disable mic or cancel host restriction (host/co-host only; cancel does not turn mic on) */
  onMuteParticipant?: (identity: string, disable: boolean) => void;
  /** Callback to disable camera or cancel host restriction (host/co-host only; cancel does not turn camera on) */
  onDisableParticipantVideo?: (identity: string, disable: boolean) => void;
  /** Identities whose mic was disabled by the host */
  hostMutedIdentities?: string[];
  /** Identities whose camera was disabled by the host */
  hostDisabledVideoIdentities?: string[];
  /** Raised-hand queue, ordered by when each hand went up */
  raisedHands?: string[];
  /** Whether the local user may lower other people's hands (host / co-host / presenter) */
  canManageHands?: boolean;
  onLowerAllHands?: () => void;
}

export function AttendeePanel({
  hostIdentity,
  copresenterIdentities,
  cohostIdentities,
  localIdentity,
  autoPresenterIdentity,
  canMuteAll,
  muteAllActive,
  onMuteAll,
  onUnmuteAll,
  onMuteParticipant,
  onDisableParticipantVideo,
  hostMutedIdentities = [],
  hostDisabledVideoIdentities = [],
  raisedHands = [],
  canManageHands = false,
  onLowerAllHands,
}: AttendeePanelProps) {
  const { t } = useI18n();
  const room = useRoomContext();
  const allParticipants = useParticipants();
  const participants = useMemo(
    () => allParticipants.filter((p) => !isRecorderParticipant(p)),
    [allParticipants],
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuIdentity, setOpenMenuIdentity] = useState<string | null>(null);
  const [, setMediaRevision] = useState(0);

  useEffect(() => {
    const bump = () => setMediaRevision((n) => n + 1);
    const evs = [
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ] as const;
    for (const e of evs) room.on(e, bump);
    return () => {
      for (const e of evs) room.off(e, bump);
    };
  }, [room]);

  useEffect(() => {
    if (!openMenuIdentity) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.kloud-more-menu-anchor')) return;
      setOpenMenuIdentity(null);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [openMenuIdentity]);

  const getRoles = (identity: string): { label: string; cls: string }[] => {
    const roles: { label: string; cls: string }[] = [];
    if (identity === hostIdentity) roles.push({ label: 'Host', cls: 'role-host' });
    if (cohostIdentities.includes(identity) && identity !== hostIdentity) roles.push({ label: 'Co-host', cls: 'role-cohost' });
    if (identity === autoPresenterIdentity) roles.push({ label: 'Presenter', cls: 'role-presenter' });
    if (copresenterIdentities.includes(identity)) roles.push({ label: 'Co-Presenter', cls: 'role-copresenter' });
    if (roles.length === 0) roles.push({ label: 'Attendee', cls: 'role-attendee' });
    return roles;
  };

  // Sort: Host first, then co-hosts, then presenter, then attendees
  const sorted = [...participants].sort((a, b) => {
    const roleOrder = (identity: string) => {
      if (identity === hostIdentity) return 0;
      if (cohostIdentities.includes(identity)) return 1;
      if (identity === autoPresenterIdentity) return 2;
      if (copresenterIdentities.includes(identity)) return 2;
      return 3;
    };
    const rA = roleOrder(a.identity);
    const rB = roleOrder(b.identity);
    if (rA !== rB) return rA - rB;
    return (a.joinedAt?.getTime() || 0) - (b.joinedAt?.getTime() || 0);
  });

  // Filter by search
  const filtered = searchQuery.trim()
    ? sorted.filter((p) => {
        const name = (p.name || p.identity || '').toLowerCase();
        return name.includes(searchQuery.toLowerCase());
      })
    : sorted;

  // 举手总数：剔除已离会但队列里还没清掉的 identity
  const raisedHandCount = raisedHands.filter((identity) =>
    participants.some((p) => p.identity === identity),
  ).length;

  return (
    <div className="kloud-attendee-panel">
      <div className="kloud-attendee-header">
        <span className="kloud-attendee-count">{t('attendee.inMeetingCount', { n: participants.length })}</span>
        {/* Mute All / Unmute All — only for host/co-host/presenter */}
        {canMuteAll && (
          <div className="kloud-attendee-mute-actions">
            <button
              type="button"
              className={`kloud-mute-all-btn ${muteAllActive ? 'kloud-mute-all-btn--active' : ''}`}
              aria-pressed={!!muteAllActive}
              onClick={muteAllActive ? onUnmuteAll : onMuteAll}
              title={muteAllActive ? t('toolbar.unmuteAll') : t('toolbar.muteAll')}
            >
              {muteAllActive ? (
                <>
                  {/* Mic with slash — unmute icon */}
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/>
                    <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                  {t('toolbar.unmuteAll')}
                </>
              ) : (
                <>
                  {/* Mic icon — mute icon */}
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/>
                  </svg>
                  {t('toolbar.muteAll')}
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Raised hands — 只显示总数与「全部放下」；放下单个人走该行的 ⋯ 菜单 */}
      {raisedHandCount > 0 && (
        <div className="kloud-hand-queue">
          <span className="kloud-hand-queue-title">
            {t('attendee.raisedHands')} ({raisedHandCount})
          </span>
          {canManageHands && onLowerAllHands && (
            <button type="button" className="kloud-lower-all-btn" onClick={onLowerAllHands}>
              {t('attendee.lowerAllHands')}
            </button>
          )}
        </div>
      )}

      {/* Search bar — only when 5+ participants */}
      {participants.length >= 5 && (
        <div className="kloud-attendee-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('attendee.searchParticipants')}
            aria-label={t('attendee.searchParticipants')}
            className="kloud-attendee-search-input"
          />
          {searchQuery && (
            <button
              type="button"
              className="kloud-attendee-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label={t('common.close')}
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div className="kloud-attendee-list">
        {filtered.map((p) => {
          const roles = getRoles(p.identity);
          const name = p.name || p.identity || '??';
          const initials = getInitials(name);
          const isLocalParticipant = p.identity === localIdentity;
          const handOrder = raisedHands.indexOf(p.identity);

          return (
            <div key={p.identity} className="kloud-attendee-row">
              <div className="kloud-attendee-avatar">
                {initials}
              </div>
              <div className="kloud-attendee-info">
                <span className="kloud-attendee-name">
                  {name}{isLocalParticipant ? ` (${t('chat.you')})` : ''}
                </span>
                <div className="kloud-attendee-badges">
                  {roles.map((r) => (
                    <span key={r.cls} className={`kloud-attendee-role ${r.cls}`}>
                      {ATTENDEE_ROLE_LABEL_KEYS[r.cls] ? t(ATTENDEE_ROLE_LABEL_KEYS[r.cls]) : r.label}
                    </span>
                  ))}
                  {handOrder >= 0 && (
                    <span className="kloud-attendee-hand-chip" title={t('attendee.raisedHands')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="9" height="9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 013.15 0V15M6.9 7.575a1.575 1.575 0 10-3.15 0v8.175a6.75 6.75 0 006.75 6.75h2.018a5.25 5.25 0 003.712-1.538l1.732-1.732a5.25 5.25 0 001.538-3.712l.003-2.024a.668.668 0 01.198-.471 1.575 1.575 0 10-2.228-2.228 3.818 3.818 0 00-1.12 2.687M6.9 7.575V12" />
                      </svg>
                      {handOrder + 1}
                    </span>
                  )}
                </div>
              </div>

              {/* Per-participant mic / camera restriction controls (host only disables or cancels disable) */}
              <div className="kloud-participant-media-actions">
              {(() => {
                const lkParticipant = participants.find(lkp => lkp.identity === p.identity);
                const micPub = lkParticipant?.getTrackPublication(Track.Source.Microphone);
                const isMicMuted = micPub ? micPub.isMuted : true;
                const isHostMicRestricted = hostMutedIdentities.includes(p.identity);
                const canManageMic = !!(canMuteAll && !isLocalParticipant && onMuteParticipant);
                return (
                  <button
                    type="button"
                    aria-label={
                      canManageMic
                        ? (isHostMicRestricted ? 'Cancel disable (does not turn on mic)' : 'Disable microphone')
                        : (isHostMicRestricted ? 'Disabled by host' : (isMicMuted ? 'Muted' : 'Mic on'))
                    }
                    className={`kloud-participant-mic-btn${isMicMuted ? ' muted' : ' active'}${isHostMicRestricted ? ' host-restricted' : ''}${canManageMic ? ' clickable' : ''}`}
                    onClick={canManageMic ? () => onMuteParticipant(p.identity, !isHostMicRestricted) : undefined}
                    title={
                      canManageMic
                        ? (isHostMicRestricted ? 'Cancel disable (does not turn on mic)' : 'Disable microphone')
                        : (isHostMicRestricted ? 'Disabled by host' : (isMicMuted ? 'Muted' : 'Mic on'))
                    }
                    disabled={!canManageMic}
                  >
                    {isMicMuted ? (
                      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                        <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/>
                        <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                        <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/>
                      </svg>
                    )}
                  </button>
                );
              })()}

              {(() => {
                const lkParticipant = participants.find(lkp => lkp.identity === p.identity);
                const camPub = lkParticipant?.getTrackPublication(Track.Source.Camera);
                const isCamDisabled = camPub ? camPub.isMuted : true;
                const isHostVideoRestricted = hostDisabledVideoIdentities.includes(p.identity);
                const canManageCam = !!(canMuteAll && !isLocalParticipant && onDisableParticipantVideo);
                return (
                  <button
                    type="button"
                    aria-label={
                      canManageCam
                        ? (isHostVideoRestricted ? 'Cancel disable (does not turn on camera)' : 'Disable camera')
                        : (isHostVideoRestricted ? 'Disabled by host' : (isCamDisabled ? 'Camera off' : 'Camera on'))
                    }
                    className={`kloud-participant-cam-btn${isCamDisabled ? ' disabled' : ' active'}${isHostVideoRestricted ? ' host-restricted' : ''}${canManageCam ? ' clickable' : ''}`}
                    onClick={canManageCam ? () => onDisableParticipantVideo(p.identity, !isHostVideoRestricted) : undefined}
                    title={
                      canManageCam
                        ? (isHostVideoRestricted ? 'Cancel disable (does not turn on camera)' : 'Disable camera')
                        : (isHostVideoRestricted ? 'Disabled by host' : (isCamDisabled ? 'Camera off' : 'Camera on'))
                    }
                    disabled={!canManageCam}
                  >
                    {isCamDisabled ? (
                      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                        <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
                      </svg>
                    )}
                  </button>
                );
              })()}
              </div>

              <ParticipantAttendeeRowMoreMenu
                identity={p.identity}
                isOpen={openMenuIdentity === p.identity}
                onToggle={() =>
                  setOpenMenuIdentity(openMenuIdentity === p.identity ? null : p.identity)
                }
                onClose={() => setOpenMenuIdentity(null)}
              />
            </div>
          );
        })}
        {filtered.length === 0 && searchQuery && (
          <div className="kloud-attendee-empty">{t('attendee.noMatch', { query: searchQuery })}</div>
        )}
      </div>

    </div>
  );
}

// ════════════════════════════════════
// CSS Styles (injected via <style>)
// ════════════════════════════════════
export const chatAndAttendeeStyles = `
  /* ════════════════════════════════════════════════════════════
     In-meeting side panels (2026-10 redesign) — always dark.
     Chat, People & Attendees, role ⋯ menu, confirm dialogs.
     ════════════════════════════════════════════════════════════ */

  /* Chat Panel */
  .kloud-chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    color: var(--km-stage-text, #e8eaed);
    font-family: var(--km-font);
  }
  .kloud-chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.18) transparent;
  }
  .kloud-chat-empty {
    color: var(--km-stage-muted, #9aa0a6);
    font-size: 14px;
    line-height: 1.5;
    text-align: center;
    padding: 40px 12px;
  }
  .kloud-chat-entry {
    display: flex;
    flex-direction: column;
    gap: 4px;
    animation: kloud-chat-entry-in 0.2s ease-out both;
  }
  .kloud-chat-failed {
    align-self: flex-end;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #ff8a80;
    font-size: 12px;
  }
  .kloud-chat-inline-btn {
    padding: 2px 8px;
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--km-stage-text, #e8eaed);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .kloud-chat-inline-btn:hover {
    background: rgba(255, 255, 255, 0.18);
  }
  .kloud-chat-inline-btn.quiet {
    background: transparent;
    color: var(--km-stage-muted, #9aa0a6);
  }
  .kloud-chat-inline-btn:focus-visible {
    outline: 2px solid var(--km-on-dark-accent, #c9c8ff);
    outline-offset: 2px;
  }
  /* The sender's own file share in flight, or why it didn't go */
  .kloud-chat-upload {
    align-self: flex-end;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 92%;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px dashed rgba(139, 135, 255, 0.35);
    color: var(--km-stage-text, #e8eaed);
    font-size: 13px;
    line-height: 1.45;
  }
  .kloud-chat-upload.failed {
    flex-wrap: wrap;
    border: 1px solid rgba(255, 107, 107, 0.35);
    background: rgba(255, 107, 107, 0.08);
  }
  .kloud-chat-upload-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .kloud-chat-upload-text b {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .kloud-chat-upload-text span {
    color: var(--km-stage-muted, #9aa0a6);
    font-size: 12px;
  }
  .kloud-chat-upload-actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  @keyframes kloud-chat-entry-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
  }
  .kloud-chat-entry.local .kloud-chat-text {
    background: rgba(139, 135, 255, 0.2);
    border: 1px solid transparent;
    border-radius: 16px 4px 16px 16px;
    align-self: flex-end;
  }
  .kloud-chat-entry.remote .kloud-chat-text {
    background: rgba(255,255,255,0.06);
    border: 1px solid transparent;
    border-radius: 4px 16px 16px 16px;
    align-self: flex-start;
  }
  .kloud-chat-meta {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 2px;
  }
  .kloud-chat-entry.local .kloud-chat-meta {
    justify-content: flex-end;
  }
  .kloud-chat-sender {
    color: var(--km-stage-text, #e8eaed);
    font-size: 13px;
    font-weight: 700;
  }
  .kloud-chat-time {
    color: var(--km-stage-muted, #9aa0a6);
    font-size: 12px;
  }
  .kloud-chat-text {
    color: var(--km-stage-text, #e8eaed);
    font-size: 14px;
    line-height: 1.6;
    padding: 8px 12px;
    max-width: 88%;
    word-break: break-word;
  }
  .kloud-chat-doc-card {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 92%;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.06);
    color: var(--km-stage-text, #e8eaed);
    font-family: inherit;
    text-align: left;
    cursor: default;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .kloud-chat-entry.local .kloud-chat-doc-card {
    align-self: flex-end;
    background: rgba(139, 135, 255, 0.16);
    border-color: rgba(139, 135, 255, 0.24);
  }
  .kloud-chat-entry.remote .kloud-chat-doc-card {
    align-self: flex-start;
  }
  .kloud-chat-doc-card.clickable {
    cursor: pointer;
  }
  .kloud-chat-doc-card.clickable:hover {
    border-color: rgba(201, 200, 255, 0.5);
    background: rgba(139, 135, 255, 0.2);
  }
  .kloud-chat-doc-card:focus-visible {
    outline: 2px solid var(--km-on-dark-accent, #c9c8ff);
    outline-offset: 2px;
  }
  .kloud-chat-doc-card:disabled {
    opacity: 0.75;
    cursor: default;
  }
  .kloud-chat-doc-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(139, 135, 255, 0.22);
    color: var(--km-on-dark-accent, #c9c8ff);
    flex-shrink: 0;
  }
  .kloud-chat-doc-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .kloud-chat-doc-name {
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kloud-chat-doc-status {
    font-size: 12px;
    color: var(--km-on-dark-accent, #c9c8ff);
  }
  .kloud-chat-doc-card:disabled .kloud-chat-doc-status {
    color: var(--km-stage-muted, #9aa0a6);
  }
  .kloud-chat-form {
    padding: 12px 16px 16px;
    border-top: none;
    background: transparent;
  }
  .kloud-chat-input-shell {
    position: relative;
    display: flex;
    align-items: flex-end;
    min-height: 48px;
    padding: 12px 48px 12px 48px;
    background: var(--km-control, #2e3036);
    border: 1px solid transparent;
    border-radius: 24px;
    box-shadow: none;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }
  .kloud-chat-attach {
    position: absolute;
    left: 9px;
    bottom: 9px;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #bdc1c6;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s, opacity 0.15s;
  }
  .kloud-chat-file-input {
    display: none;
  }
  .kloud-chat-attach:hover:not(:disabled) {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }
  .kloud-chat-attach:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .kloud-chat-attach-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.25);
    border-top-color: var(--km-on-dark-accent, #c9c8ff);
    border-radius: 50%;
    animation: kloud-chat-spin 0.7s linear infinite;
  }
  @keyframes kloud-chat-spin {
    to { transform: rotate(360deg); }
  }
  .kloud-chat-input-shell:focus-within {
    background: var(--km-control-hover, #3a3c43);
    border-color: rgba(201, 200, 255, 0.55);
    box-shadow: 0 0 0 3px rgba(139, 135, 255, 0.16);
  }
  .kloud-chat-input {
    flex: 1;
    min-height: 22px;
    max-height: 132px;
    background: transparent;
    border: none;
    color: var(--km-stage-text, #e8eaed);
    padding: 0;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.55;
    outline: none;
    overflow-y: auto;
    resize: none;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.22) transparent;
  }
  .kloud-chat-input::placeholder {
    color: #80868b;
  }
  .kloud-chat-send {
    position: absolute;
    right: 9px;
    bottom: 9px;
    background: var(--km-on-dark-accent, #c9c8ff);
    border: none;
    color: #1f1d6b;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: none;
    transition: transform 0.15s, opacity 0.15s, background 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .kloud-chat-send:hover:not(:disabled) {
    background: #dcdbff;
    transform: translateY(-1px);
  }
  .kloud-chat-send:disabled {
    background: rgba(255,255,255,0.08);
    color: #9aa0a6;
    opacity: 1;
    cursor: not-allowed;
  }
  .kloud-chat-attach:focus-visible,
  .kloud-chat-send:focus-visible {
    outline: 2px solid var(--km-on-dark-accent, #c9c8ff);
    outline-offset: 2px;
  }

  /* Attendee Panel */
  .kloud-attendee-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    color: var(--km-stage-text, #e8eaed);
    font-family: var(--km-font);
  }
  .kloud-attendee-header {
    padding: 4px 16px 12px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  .kloud-attendee-count {
    color: var(--km-stage-muted, #9aa0a6);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .kloud-attendee-mute-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .kloud-mute-all-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid #3c4043;
    background: transparent;
    color: var(--km-on-dark-accent, #c9c8ff);
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .kloud-mute-all-btn:hover {
    background: rgba(201, 200, 255, 0.08);
    border-color: #5f6368;
    color: #fff;
  }
  .kloud-mute-all-btn--active {
    background: rgba(139, 135, 255, 0.2) !important;
    border-color: transparent !important;
    color: var(--km-on-dark-accent, #c9c8ff) !important;
  }
  .kloud-mute-all-btn--active:hover {
    background: rgba(139, 135, 255, 0.3) !important;
  }
  .kloud-attendee-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 16px;
    display: flex;
    flex-direction: column;
    gap: 0;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.18) transparent;
  }
  .kloud-attendee-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 6px 4px 6px 12px;
    border-radius: 12px;
    transition: background 0.15s;
  }
  .kloud-attendee-row:hover,
  .kloud-attendee-row:focus-within {
    background: rgba(255,255,255,0.04);
  }
  .kloud-attendee-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(139, 135, 255, 0.22);
    color: var(--km-on-dark-accent, #c9c8ff);
    font-size: 14px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    text-transform: uppercase;
  }
  .kloud-attendee-row:nth-child(6n+2) .kloud-attendee-avatar { background: #ffd0b0; color: #7a3e0a; }
  .kloud-attendee-row:nth-child(6n+3) .kloud-attendee-avatar { background: #bfe0ff; color: #0b4a75; }
  .kloud-attendee-row:nth-child(6n+4) .kloud-attendee-avatar { background: #bdebd3; color: #135b33; }
  .kloud-attendee-row:nth-child(6n+5) .kloud-attendee-avatar { background: #ffd0df; color: #7d1c45; }
  .kloud-attendee-row:nth-child(6n+6) .kloud-attendee-avatar { background: #ffe9a3; color: #6b5200; }
  .kloud-attendee-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .kloud-attendee-name {
    color: var(--km-stage-text, #e8eaed);
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kloud-attendee-badges {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .kloud-attendee-role {
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0;
    padding: 0;
    border-radius: 0;
    width: fit-content;
    background: transparent;
  }
  .kloud-attendee-role + .kloud-attendee-role::before {
    content: '·';
    margin-right: 6px;
    color: var(--km-stage-muted, #9aa0a6);
  }
  .role-host {
    color: var(--km-on-dark-accent, #c9c8ff);
    background: transparent;
  }
  .role-cohost {
    color: var(--km-on-dark-accent, #c9c8ff);
    background: transparent;
  }
  .role-presenter {
    color: #a8dab5;
    background: transparent;
  }
  .role-copresenter {
    color: #a8c7fa;
    background: transparent;
  }
  .role-attendee {
    color: var(--km-stage-muted, #9aa0a6);
    background: transparent;
  }

  /* Raised-hand summary card (count + Lower All; individual lowering lives in the row ⋯ menu) */
  .kloud-hand-queue {
    margin: 0 12px 12px;
    padding: 8px 8px 8px 16px;
    border-radius: 12px;
    border: 1px solid #3c4043;
    background: #2a2b31;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .kloud-hand-queue-title {
    color: #bdc1c6;
    font-size: 13px;
    font-weight: 700;
  }
  .kloud-lower-all-btn {
    height: 32px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid #3c4043;
    background: transparent;
    color: var(--km-on-dark-accent, #c9c8ff);
    font-family: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .kloud-lower-all-btn:hover {
    background: rgba(201, 200, 255, 0.08);
    border-color: #5f6368;
    color: #fff;
  }

  /* Raised-hand chip inside the roster row */
  .kloud-attendee-hand-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--km-on-dark-accent, #c9c8ff);
    color: #1f1d6b;
    font-size: 11px;
    font-weight: 700;
  }

  /* Per-participant mic toggle button */
  .kloud-participant-mic-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid transparent;
    background: transparent;
    flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
    opacity: 0;
    cursor: default;
  }
  /* Show mic button when hovering the row */
  .kloud-attendee-row:hover .kloud-participant-mic-btn,
  .kloud-attendee-row:focus-within .kloud-participant-mic-btn {
    opacity: 1;
  }
  .kloud-participant-mic-btn.host-restricted {
    opacity: 1;
  }
  /* Voluntary mute — gray (not host-restricted) */
  .kloud-participant-mic-btn.muted:not(.host-restricted) {
    opacity: 1;
    color: #9aa0a6;
    background: transparent;
    border-color: transparent;
  }
  /* Active (unmuted) state */
  .kloud-participant-mic-btn.active:not(.host-restricted) {
    color: #81c995;
    background: transparent;
    border-color: transparent;
  }
  /* Clickable (operator) states */
  .kloud-participant-mic-btn.clickable {
    cursor: pointer;
  }
  .kloud-participant-mic-btn.clickable.muted:not(.host-restricted) {
    background: transparent;
    border-color: transparent;
    color: #bdc1c6;
  }
  .kloud-participant-mic-btn.clickable.muted:not(.host-restricted):hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .kloud-participant-mic-btn.clickable.active:not(.host-restricted):hover {
    background: rgba(129, 201, 149, 0.12);
    color: #a8dab5;
  }
  .kloud-participant-mic-btn.host-restricted,
  .kloud-participant-mic-btn.host-restricted.muted,
  .kloud-participant-mic-btn.clickable.host-restricted,
  .kloud-participant-mic-btn.clickable.host-restricted.muted {
    opacity: 1;
    color: #f28b82 !important;
    background: rgba(242, 139, 130, 0.12);
    border-color: transparent;
  }
  .kloud-participant-mic-btn.clickable.host-restricted:hover,
  .kloud-participant-mic-btn.clickable.host-restricted.muted:hover {
    background: rgba(129, 201, 149, 0.14);
    color: #a8dab5 !important;
  }

  .kloud-participant-media-actions {
    display: flex;
    align-items: center;
    gap: 0;
    flex-shrink: 0;
  }

  .kloud-participant-cam-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid transparent;
    background: transparent;
    flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
    opacity: 0;
    cursor: default;
  }
  .kloud-attendee-row:hover .kloud-participant-cam-btn,
  .kloud-attendee-row:focus-within .kloud-participant-cam-btn {
    opacity: 1;
  }
  .kloud-participant-cam-btn.host-restricted {
    opacity: 1;
  }
  .kloud-participant-cam-btn.disabled:not(.host-restricted) {
    opacity: 1;
    color: #9aa0a6;
    background: transparent;
    border-color: transparent;
  }
  .kloud-participant-cam-btn.host-restricted,
  .kloud-participant-cam-btn.host-restricted.disabled,
  .kloud-participant-cam-btn.clickable.host-restricted,
  .kloud-participant-cam-btn.clickable.host-restricted.disabled {
    color: #f28b82 !important;
    background: rgba(242, 139, 130, 0.12);
    border-color: transparent;
    opacity: 1;
  }
  .kloud-participant-cam-btn.active:not(.host-restricted) {
    color: #81c995;
    background: transparent;
    border-color: transparent;
  }
  .kloud-participant-cam-btn.clickable {
    cursor: pointer;
  }
  .kloud-participant-cam-btn.clickable.disabled:not(.host-restricted) {
    background: transparent;
    border-color: transparent;
    color: #bdc1c6;
  }
  .kloud-participant-cam-btn.clickable.disabled:not(.host-restricted):hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .kloud-participant-cam-btn.clickable.host-restricted:hover,
  .kloud-participant-cam-btn.clickable.host-restricted.disabled:hover {
    background: rgba(129, 201, 149, 0.14);
    color: #a8dab5 !important;
  }
  .kloud-participant-cam-btn.clickable.active:not(.host-restricted):hover {
    background: rgba(129, 201, 149, 0.12);
    color: #a8dab5;
  }
  .kloud-participant-mic-btn.clickable:focus-visible,
  .kloud-participant-cam-btn.clickable:focus-visible,
  .kloud-role-icon-btn:focus-visible,
  .kloud-mute-all-btn:focus-visible,
  .kloud-lower-all-btn:focus-visible,
  .kloud-more-dropdown-item:focus-visible,
  .kloud-confirm-cancel:focus-visible,
  .kloud-confirm-proceed:focus-visible,
  .kloud-host-picker-item:focus-visible,
  .kloud-host-picker-close:focus-visible,
  .kloud-host-picker-back:focus-visible,
  .kloud-attendee-search-clear:focus-visible {
    outline: 2px solid var(--km-on-dark-accent, #c9c8ff);
    outline-offset: 2px;
    opacity: 1;
  }

  /* Action buttons */
  .kloud-attendee-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
    align-items: center;
  }
  .kloud-role-icon-btn {
    position: relative;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
    color: #bdc1c6;
    box-sizing: border-box;
  }
  .kloud-role-icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
  .kloud-role-icon-btn.checked {
    background: rgba(139, 135, 255, 0.2);
    color: var(--km-on-dark-accent, #c9c8ff);
  }
  .kloud-role-icon-btn.checked:hover {
    background: rgba(139, 135, 255, 0.3);
  }
  .kloud-check-badge {
    position: absolute;
    bottom: -3px;
    right: -3px;
    line-height: 0;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
  }

  /* More menu "⋯" */
  .kloud-more-menu-anchor {
    position: relative;
  }
  .kloud-more-dropdown {
    position: absolute;
    right: 0;
    top: 40px;
    width: max-content;
    min-width: 230px;
    background: var(--km-menu, #2b2c32);
    border: none;
    border-radius: 12px;
    padding: 8px 0;
    box-shadow: 0 8px 28px rgba(0,0,0,0.35);
    z-index: 100;
    font-family: var(--km-font);
    animation: kloud-dropdown-in 0.14s ease-out;
  }
  @keyframes kloud-dropdown-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .kloud-more-dropdown-item {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 44px;
    padding: 0 18px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--km-stage-text, #e8eaed);
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s;
    text-align: left;
    white-space: nowrap;
  }
  .kloud-more-dropdown-item:hover {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }
  .kloud-more-dropdown-item.active {
    color: var(--km-on-dark-accent, #c9c8ff);
  }
  .kloud-more-dropdown-item.active svg {
    color: var(--km-on-dark-accent, #c9c8ff);
  }
  .kloud-more-dropdown-item.danger {
    color: #f28b82;
  }
  .kloud-more-dropdown-item.danger:not(:first-child) {
    margin-top: 6px;
    box-shadow: 0 -1px 0 rgba(255,255,255,0.08);
  }
  .kloud-more-dropdown-item.danger:hover {
    background: rgba(242, 139, 130, 0.1);
    color: #f6aea9;
  }
  .kloud-more-dropdown-item.danger svg {
    color: inherit;
  }
  .kloud-more-dropdown-item svg {
    flex-shrink: 0;
    color: #bdc1c6;
  }

  /* Confirmation dialog */
  .kloud-confirm-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    border-radius: inherit;
  }
  .kloud-confirm-dialog {
    background: var(--km-menu, #2b2c32);
    border: none;
    border-radius: 16px;
    padding: 24px;
    max-width: 300px;
    text-align: center;
    color: var(--km-stage-text, #e8eaed);
    font-family: var(--km-font);
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    animation: kloud-dialog-in 0.15s ease-out;
  }
  .kloud-chat-panel .kloud-confirm-dialog {
    max-width: 320px;
    text-align: left;
  }
  @keyframes kloud-dialog-in {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  .kloud-confirm-icon {
    margin-bottom: 12px;
  }
  .kloud-confirm-title {
    color: var(--km-stage-text, #e8eaed);
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 8px;
  }
  .kloud-confirm-text {
    color: #bdc1c6;
    font-size: 13px;
    line-height: 1.55;
    margin: 0 0 20px;
  }
  .kloud-confirm-text strong {
    color: #fff;
  }
  .kloud-confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
  .kloud-chat-panel .kloud-confirm-actions {
    justify-content: flex-end;
  }
  .kloud-confirm-cancel {
    height: 36px;
    padding: 0 16px;
    border-radius: 999px;
    border: none;
    background: transparent;
    color: var(--km-on-dark-accent, #c9c8ff);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s;
  }
  .kloud-confirm-cancel:hover {
    background: rgba(201, 200, 255, 0.08);
  }
  .kloud-confirm-proceed {
    height: 36px;
    padding: 0 18px;
    border-radius: 999px;
    border: none;
    background: var(--km-on-dark-accent, #c9c8ff);
    color: #1f1d6b;
    font-family: inherit;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    box-shadow: none;
  }
  .kloud-confirm-proceed:hover {
    background: #dcdbff;
  }

  /* Search bar */
  .kloud-attendee-search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 16px 12px;
    height: 40px;
    padding: 0 14px;
    background: var(--km-control, #2e3036);
    border: 1px solid transparent;
    border-radius: 999px;
    color: #9aa0a6;
    transition: border-color 0.15s;
  }
  .kloud-attendee-search:focus-within {
    border-color: rgba(201, 200, 255, 0.55);
  }
  .kloud-attendee-search-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: var(--km-stage-text, #e8eaed);
    font-family: inherit;
    font-size: 14px;
    outline: none;
  }
  .kloud-attendee-search-input::placeholder {
    color: #80868b;
  }
  .kloud-attendee-search-clear {
    background: transparent;
    border: none;
    color: #9aa0a6;
    cursor: pointer;
    font-size: 12px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    padding: 0;
  }
  .kloud-attendee-search-clear:hover {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }
  .kloud-attendee-empty {
    color: var(--km-stage-muted, #9aa0a6);
    font-size: 13px;
    text-align: center;
    padding: 20px 8px;
  }

  /* Host Transfer Picker */
  .kloud-host-picker {
    background: var(--km-menu, #2b2c32);
    border: none;
    border-radius: 16px;
    padding: 20px;
    width: 320px;
    max-width: calc(100vw - 32px);
    max-height: 440px;
    display: flex;
    flex-direction: column;
    color: var(--km-stage-text, #e8eaed);
    font-family: var(--km-font);
    box-shadow: 0 16px 48px rgba(0,0,0,0.6);
    animation: kloud-dialog-in 0.15s ease-out;
  }
  .kloud-host-picker-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .kloud-host-picker-title {
    flex: 1;
    color: var(--km-stage-text, #e8eaed);
    font-size: 18px;
    font-weight: 600;
    margin: 0;
  }
  .kloud-host-picker-close {
    background: transparent;
    border: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: #bdc1c6;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 14px;
    flex-shrink: 0;
  }
  .kloud-host-picker-close:hover {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }
  .kloud-host-picker-back {
    background: transparent;
    border: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: #bdc1c6;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }
  .kloud-host-picker-back:hover {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }
  .kloud-host-picker-desc {
    color: #9aa0a6;
    font-size: 13px;
    line-height: 1.5;
    margin: 0 0 12px;
  }
  .kloud-host-picker-search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 14px;
    background: var(--km-control, #2e3036);
    border: 1px solid transparent;
    border-radius: 999px;
    margin-bottom: 8px;
    color: #9aa0a6;
  }
  .kloud-host-picker-search:focus-within {
    border-color: rgba(201, 200, 255, 0.55);
  }
  .kloud-host-picker-search-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: var(--km-stage-text, #e8eaed);
    font-family: inherit;
    font-size: 14px;
    outline: none;
  }
  .kloud-host-picker-search-input::placeholder {
    color: #80868b;
  }
  .kloud-host-picker-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 280px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.18) transparent;
  }
  .kloud-host-picker-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 12px;
    border: none;
    background: transparent;
    color: var(--km-stage-text, #e8eaed);
    font-family: inherit;
    cursor: pointer;
    transition: background 0.12s;
    text-align: left;
    width: 100%;
  }
  .kloud-host-picker-item:hover {
    background: rgba(255,255,255,0.06);
  }
  .kloud-host-picker-item-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .kloud-confirm-body {
    text-align: center;
    padding: 8px 0;
  }
  .kloud-host-transfer-overlay {
    position: fixed !important;
    inset: 0 !important;
    z-index: 100001 !important;
    border-radius: 0 !important;
  }
  .kloud-more-menu-portal .kloud-more-dropdown {
    position: static;
    top: auto;
    right: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    .kloud-chat-entry,
    .kloud-more-dropdown,
    .kloud-confirm-dialog,
    .kloud-host-picker {
      animation: none !important;
    }
    .kloud-chat-send:hover:not(:disabled) {
      transform: none;
    }
  }
`;
