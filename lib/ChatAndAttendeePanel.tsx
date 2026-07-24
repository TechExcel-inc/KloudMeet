import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRoomContext, useParticipants } from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { useI18n } from './i18n';
import { getInitials } from './getInitials';
import { ParticipantAttendeeRowMoreMenu } from './ParticipantRoleMenu';
import type { ChatMsg } from './chatProtocol';

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
}

export function ChatPanel({
  messages,
  onSend,
  onAttachFile,
  onOpenLivedoc,
  attachBusy = false,
  attachDisabled = false,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    sendDraft();
  }, [sendDraft]);

  const handleAttachClick = useCallback(() => {
    if (attachDisabled || attachBusy || !onAttachFile) return;
    // Must open picker synchronously in the click handler (browser user-gesture requirement)
    fileInputRef.current?.click();
  }, [attachDisabled, attachBusy, onAttachFile]);

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
            </div>
          );
        })}
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
    </div>
  );
}

// ════════════════════════════════════
// Attendee Panel (participant list with roles)
// ════════════════════════════════════
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
}: AttendeePanelProps) {
  const { t } = useI18n();
  const participants = useParticipants();
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuIdentity, setOpenMenuIdentity] = useState<string | null>(null);

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

  return (
    <div className="kloud-attendee-panel">
      <div className="kloud-attendee-header">
        <span className="kloud-attendee-count">{participants.length} Participant{participants.length !== 1 ? 's' : ''}</span>
        {/* Mute All / Unmute All — only for host/co-host/presenter */}
        {canMuteAll && (
          <div className="kloud-attendee-mute-actions">
            <button
              className={`kloud-mute-all-btn ${muteAllActive ? 'kloud-mute-all-btn--active' : ''}`}
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
            placeholder="Search participants..."
            className="kloud-attendee-search-input"
          />
          {searchQuery && (
            <button className="kloud-attendee-search-clear" onClick={() => setSearchQuery('')}>✕</button>
          )}
        </div>
      )}

      <div className="kloud-attendee-list">
        {filtered.map((p) => {
          const roles = getRoles(p.identity);
          const name = p.name || p.identity || '??';
          const initials = getInitials(name);
          const isLocalParticipant = p.identity === localIdentity;
          const isThisHost = p.identity === hostIdentity;
          const isThisCohost = cohostIdentities.includes(p.identity);
          const isThisAutoPresenter = p.identity === autoPresenterIdentity;
          // Force-muted: muteAll is active AND this participant is NOT someone who can initiate mute-all
          // (host, co-host, and auto-presenter are all exempt — they are the operators, not the subjects)
          const isOperator = isThisHost || isThisCohost || isThisAutoPresenter;
          // Also: the LOCAL user who has canMuteAll never shows the red badge for themselves
          const isForceMuted = !!(muteAllActive && !isOperator && !(isLocalParticipant && canMuteAll));

          return (
            <div key={p.identity} className="kloud-attendee-row">
              <div className="kloud-attendee-avatar">
                {initials}
              </div>
              <div className="kloud-attendee-info">
                <span className="kloud-attendee-name">
                  {name}{isLocalParticipant ? ' (You)' : ''}
                </span>
                <div className="kloud-attendee-badges">
                  {roles.map((r) => (
                    <span key={r.cls} className={`kloud-attendee-role ${r.cls}`}>{r.label}</span>
                  ))}
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

              {/* Force-muted badge: shown when muteAll is active for non-host/co-host participants */}
              {isForceMuted && (
                <div className="kloud-force-muted-badge" title="Muted by host">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/>
                    <line x1="4" y1="4" x2="20" y2="20" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                </div>
              )}

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
          <div className="kloud-attendee-empty">No participants match &quot;{searchQuery}&quot;</div>
        )}
      </div>

    </div>
  );
}

// ════════════════════════════════════
// CSS Styles (injected via <style>)
// ════════════════════════════════════
export const chatAndAttendeeStyles = `
  /* Chat Panel */
  .kloud-chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .kloud-chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .kloud-chat-empty {
    color: rgba(255,255,255,0.35);
    font-size: 13px;
    text-align: center;
    padding: 32px 0;
  }
  .kloud-chat-entry {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .kloud-chat-entry.local .kloud-chat-text {
    background: rgba(59, 130, 246, 0.3);
    border: 1px solid rgba(59, 130, 246, 0.2);
    align-self: flex-end;
  }
  .kloud-chat-entry.remote .kloud-chat-text {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.06);
    align-self: flex-start;
  }
  .kloud-chat-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 4px;
  }
  .kloud-chat-entry.local .kloud-chat-meta {
    justify-content: flex-end;
  }
  .kloud-chat-sender {
    color: rgba(255,255,255,0.6);
    font-size: 11px;
    font-weight: 600;
  }
  .kloud-chat-time {
    color: rgba(255,255,255,0.3);
    font-size: 10px;
  }
  .kloud-chat-text {
    color: #fff;
    font-size: 13px;
    line-height: 1.4;
    padding: 6px 10px;
    border-radius: 10px;
    max-width: 85%;
    word-break: break-word;
  }
  .kloud-chat-doc-card {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 90%;
    padding: 8px 10px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.08);
    color: #fff;
    text-align: left;
    cursor: default;
  }
  .kloud-chat-entry.local .kloud-chat-doc-card {
    align-self: flex-end;
    background: rgba(59, 130, 246, 0.28);
    border-color: rgba(59, 130, 246, 0.28);
  }
  .kloud-chat-entry.remote .kloud-chat-doc-card {
    align-self: flex-start;
  }
  .kloud-chat-doc-card.clickable {
    cursor: pointer;
  }
  .kloud-chat-doc-card.clickable:hover {
    border-color: rgba(96, 165, 250, 0.55);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.18);
  }
  .kloud-chat-doc-card:disabled {
    opacity: 0.75;
    cursor: default;
  }
  .kloud-chat-doc-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgba(255,255,255,0.1);
    flex-shrink: 0;
  }
  .kloud-chat-doc-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .kloud-chat-doc-name {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kloud-chat-doc-status {
    font-size: 11px;
    color: rgba(255,255,255,0.55);
  }
  .kloud-chat-form {
    padding: 10px 12px 12px;
    border-top: 1px solid rgba(255,255,255,0.08);
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.68), rgba(15, 23, 42, 0.92));
  }
  .kloud-chat-input-shell {
    position: relative;
    display: flex;
    align-items: flex-end;
    min-height: 54px;
    padding: 10px 44px 10px 40px;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.13);
    border-radius: 18px;
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.05),
      0 10px 26px rgba(0,0,0,0.18);
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }
  .kloud-chat-attach {
    position: absolute;
    left: 8px;
    bottom: 8px;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 15px;
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.85);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, opacity 0.15s;
  }
  .kloud-chat-file-input {
    display: none;
  }
  .kloud-chat-attach:hover:not(:disabled) {
    background: rgba(255,255,255,0.16);
  }
  .kloud-chat-attach:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .kloud-chat-attach-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,0.25);
    border-top-color: #fff;
    border-radius: 50%;
    animation: kloud-chat-spin 0.7s linear infinite;
  }
  @keyframes kloud-chat-spin {
    to { transform: rotate(360deg); }
  }
  .kloud-chat-input-shell:focus-within {
    background: rgba(255,255,255,0.13);
    border-color: rgba(59, 130, 246, 0.55);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.07),
      0 0 0 3px rgba(59, 130, 246, 0.14),
      0 12px 30px rgba(0,0,0,0.22);
  }
  .kloud-chat-input {
    flex: 1;
    min-height: 24px;
    max-height: 132px;
    background: transparent;
    border: none;
    color: #fff;
    padding: 0;
    font-size: 13px;
    line-height: 1.55;
    outline: none;
    overflow-y: auto;
    resize: none;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.22) transparent;
  }
  .kloud-chat-input::placeholder {
    color: rgba(255,255,255,0.36);
  }
  .kloud-chat-send {
    position: absolute;
    right: 8px;
    bottom: 8px;
    background: linear-gradient(135deg, #22c55e, #16a34a);
    border: none;
    color: #fff;
    width: 30px;
    height: 30px;
    border-radius: 15px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 18px rgba(22, 163, 74, 0.32);
    transition: transform 0.15s, opacity 0.15s, box-shadow 0.15s, background 0.15s;
    flex-shrink: 0;
  }
  .kloud-chat-send:hover:not(:disabled) {
    background: linear-gradient(135deg, #16a34a, #15803d);
    box-shadow: 0 10px 22px rgba(22, 163, 74, 0.4);
    transform: translateY(-1px);
  }
  .kloud-chat-send:disabled {
    opacity: 0.42;
    cursor: not-allowed;
    box-shadow: none;
  }

  /* Attendee Panel */
  .kloud-attendee-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
  }
  .kloud-attendee-header {
    padding: 4px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .kloud-attendee-count {
    color: rgba(255,255,255,0.4);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
  }
  .kloud-attendee-mute-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .kloud-mute-all-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.75);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .kloud-mute-all-btn:hover {
    background: rgba(255,255,255,0.13);
    border-color: rgba(255,255,255,0.22);
    color: #fff;
  }
  .kloud-mute-all-btn--active {
    background: rgba(234, 88, 12, 0.18) !important;
    border-color: rgba(234, 88, 12, 0.4) !important;
    color: #fb923c !important;
  }
  .kloud-mute-all-btn--active:hover {
    background: rgba(234, 88, 12, 0.28) !important;
  }
  .kloud-attendee-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .kloud-attendee-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 10px;
    transition: background 0.15s;
  }
  .kloud-attendee-row:hover {
    background: rgba(255,255,255,0.05);
  }
  .kloud-attendee-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .kloud-attendee-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .kloud-attendee-name {
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kloud-attendee-badges {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .kloud-attendee-role {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.2px;
    padding: 1px 6px;
    border-radius: 4px;
    width: fit-content;
  }
  .role-host {
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.15);
  }
  .role-cohost {
    color: #a78bfa;
    background: rgba(167, 139, 250, 0.15);
  }
  .role-presenter {
    color: #34d399;
    background: rgba(52, 211, 153, 0.15);
  }
  .role-copresenter {
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.15);
  }
  .role-attendee {
    color: rgba(255,255,255,0.4);
    background: rgba(255,255,255,0.05);
  }

  /* Force-muted badge (shown when host has muted all) */
  .kloud-force-muted-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #ef4444;
    flex-shrink: 0;
    animation: kloud-mic-muted-pulse 2.4s ease-in-out infinite;
  }
  @keyframes kloud-mic-muted-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.3); }
    50% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0); }
  }

  /* Per-participant mic toggle button */
  .kloud-participant-mic-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid transparent;
    background: transparent;
    flex-shrink: 0;
    transition: all 0.15s ease;
    opacity: 0;
    cursor: default;
  }
  /* Show mic button when hovering the row */
  .kloud-attendee-row:hover .kloud-participant-mic-btn {
    opacity: 1;
  }
  .kloud-participant-mic-btn.host-restricted {
    opacity: 1;
  }
  /* Voluntary mute — gray (not host-restricted) */
  .kloud-participant-mic-btn.muted:not(.host-restricted) {
    opacity: 1;
    color: rgba(255, 255, 255, 0.75);
    background: rgba(0, 0, 0, 0.45);
    border-color: rgba(255, 255, 255, 0.1);
  }
  /* Active (unmuted) state */
  .kloud-participant-mic-btn.active:not(.host-restricted) {
    color: #22c55e;
    background: rgba(0, 0, 0, 0.45);
    border-color: rgba(255, 255, 255, 0.1);
  }
  /* Clickable (operator) states */
  .kloud-participant-mic-btn.clickable {
    cursor: pointer;
  }
  .kloud-participant-mic-btn.clickable.muted:not(.host-restricted) {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.75);
  }
  .kloud-participant-mic-btn.clickable.muted:not(.host-restricted):hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.9);
    transform: scale(1.1);
  }
  .kloud-participant-mic-btn.clickable.active:not(.host-restricted):hover {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.3);
    color: #4ade80;
    transform: scale(1.1);
  }
  .kloud-participant-mic-btn.host-restricted,
  .kloud-participant-mic-btn.host-restricted.muted,
  .kloud-participant-mic-btn.clickable.host-restricted,
  .kloud-participant-mic-btn.clickable.host-restricted.muted {
    opacity: 1;
    color: #ff2020 !important;
    background: rgba(255, 32, 32, 0.12);
    border-color: rgba(255, 32, 32, 0.35);
  }
  .kloud-participant-mic-btn.clickable.host-restricted:hover,
  .kloud-participant-mic-btn.clickable.host-restricted.muted:hover {
    background: rgba(34, 197, 94, 0.14);
    border-color: rgba(34, 197, 94, 0.35);
    color: #86efac !important;
  }

  .kloud-participant-media-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .kloud-participant-cam-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid transparent;
    background: transparent;
    flex-shrink: 0;
    transition: all 0.15s ease;
    opacity: 0;
    cursor: default;
  }
  .kloud-attendee-row:hover .kloud-participant-cam-btn {
    opacity: 1;
  }
  .kloud-participant-cam-btn.host-restricted {
    opacity: 1;
  }
  .kloud-participant-cam-btn.disabled:not(.host-restricted) {
    opacity: 1;
    color: rgba(255, 255, 255, 0.75);
    background: rgba(0, 0, 0, 0.45);
    border-color: rgba(255, 255, 255, 0.1);
  }
  .kloud-participant-cam-btn.host-restricted,
  .kloud-participant-cam-btn.host-restricted.disabled,
  .kloud-participant-cam-btn.clickable.host-restricted,
  .kloud-participant-cam-btn.clickable.host-restricted.disabled {
    color: #ff2020 !important;
    background: rgba(255, 32, 32, 0.12);
    border-color: rgba(255, 32, 32, 0.35);
    opacity: 1;
  }
  .kloud-participant-cam-btn.active:not(.host-restricted) {
    color: #22c55e;
    background: rgba(0, 0, 0, 0.45);
    border-color: rgba(255, 255, 255, 0.1);
  }
  .kloud-participant-cam-btn.clickable {
    cursor: pointer;
  }
  .kloud-participant-cam-btn.clickable.disabled:not(.host-restricted) {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.75);
  }
  .kloud-participant-cam-btn.clickable.disabled:not(.host-restricted):hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.9);
    transform: scale(1.1);
  }
  .kloud-participant-cam-btn.clickable.host-restricted:hover,
  .kloud-participant-cam-btn.clickable.host-restricted.disabled:hover {
    background: rgba(34, 197, 94, 0.14);
    border-color: rgba(34, 197, 94, 0.35);
    color: #86efac !important;
  }
  .kloud-participant-cam-btn.clickable.active:not(.host-restricted):hover {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.3);
    color: #4ade80;
    transform: scale(1.1);
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
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.45);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    color: rgba(255,255,255,0.5);
    box-sizing: border-box;
  }
  .kloud-role-icon-btn:hover {
    background: rgba(0, 0, 0, 0.62);
    border-color: rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.85);
  }
  .kloud-role-icon-btn.checked {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.3);
    color: #4ade80;
  }
  .kloud-role-icon-btn.checked:hover {
    background: rgba(34, 197, 94, 0.2);
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
    top: 32px;
    width: max-content;
    min-width: max-content;
    background: rgba(15, 23, 42, 0.98);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    z-index: 100;
    animation: kloud-dropdown-in 0.12s ease-out;
  }
  @keyframes kloud-dropdown-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .kloud-more-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s;
    text-align: left;
    white-space: nowrap;
  }
  .kloud-more-dropdown-item:hover {
    background: rgba(255,255,255,0.08);
  }
  .kloud-more-dropdown-item.active {
    color: #4ade80;
  }
  .kloud-more-dropdown-item.active svg {
    color: #4ade80;
  }
  .kloud-more-dropdown-item.danger {
    color: #f87171;
  }
  .kloud-more-dropdown-item.danger:hover {
    background: rgba(239, 68, 68, 0.12);
    color: #fca5a5;
  }
  .kloud-more-dropdown-item.danger svg {
    color: inherit;
  }
  .kloud-more-dropdown-item svg {
    flex-shrink: 0;
    color: rgba(255,255,255,0.6);
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
    background: rgba(20, 25, 40, 0.98);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 14px;
    padding: 20px;
    max-width: 280px;
    text-align: center;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    animation: kloud-dialog-in 0.15s ease-out;
  }
  @keyframes kloud-dialog-in {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  .kloud-confirm-icon {
    margin-bottom: 12px;
  }
  .kloud-confirm-title {
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 8px;
  }
  .kloud-confirm-text {
    color: rgba(255,255,255,0.6);
    font-size: 12px;
    line-height: 1.5;
    margin: 0 0 16px;
  }
  .kloud-confirm-text strong {
    color: #fff;
  }
  .kloud-confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
  .kloud-confirm-cancel {
    padding: 6px 16px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.15);
    background: transparent;
    color: rgba(255,255,255,0.7);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s;
  }
  .kloud-confirm-cancel:hover {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }
  .kloud-confirm-proceed {
    padding: 6px 16px;
    border-radius: 8px;
    border: none;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
    box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
  }
  .kloud-confirm-proceed:hover {
    background: linear-gradient(135deg, #d97706, #b45309);
  }

  /* Search bar */
  .kloud-attendee-search {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 12px 8px;
    padding: 6px 10px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    color: rgba(255,255,255,0.4);
  }
  .kloud-attendee-search-input {
    flex: 1;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 12px;
    outline: none;
  }
  .kloud-attendee-search-input::placeholder {
    color: rgba(255,255,255,0.3);
  }
  .kloud-attendee-search-clear {
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    font-size: 12px;
    padding: 0 2px;
  }
  .kloud-attendee-empty {
    color: rgba(255,255,255,0.3);
    font-size: 12px;
    text-align: center;
    padding: 16px 8px;
  }

  /* Host Transfer Picker */
  .kloud-host-picker {
    background: rgba(20, 25, 40, 0.98);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 14px;
    padding: 16px;
    width: 300px;
    max-height: 420px;
    display: flex;
    flex-direction: column;
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
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    margin: 0;
  }
  .kloud-host-picker-close {
    background: rgba(255,255,255,0.08);
    border: none;
    width: 26px;
    height: 26px;
    border-radius: 13px;
    color: rgba(255,255,255,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 13px;
    flex-shrink: 0;
  }
  .kloud-host-picker-close:hover {
    background: rgba(255,255,255,0.15);
    color: #fff;
  }
  .kloud-host-picker-back {
    background: rgba(255,255,255,0.08);
    border: none;
    width: 26px;
    height: 26px;
    border-radius: 13px;
    color: rgba(255,255,255,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }
  .kloud-host-picker-back:hover {
    background: rgba(255,255,255,0.15);
    color: #fff;
  }
  .kloud-host-picker-desc {
    color: rgba(255,255,255,0.45);
    font-size: 12px;
    line-height: 1.4;
    margin: 0 0 10px;
  }
  .kloud-host-picker-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    margin-bottom: 8px;
    color: rgba(255,255,255,0.4);
  }
  .kloud-host-picker-search-input {
    flex: 1;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 12px;
    outline: none;
  }
  .kloud-host-picker-search-input::placeholder {
    color: rgba(255,255,255,0.3);
  }
  .kloud-host-picker-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 280px;
  }
  .kloud-host-picker-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 10px;
    border: none;
    background: transparent;
    color: #fff;
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
`;
