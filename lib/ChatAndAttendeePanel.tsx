import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRoomContext, useParticipants } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { useI18n } from './i18n';
import { getInitials } from './getInitials';

// ════════════════════════════════════
// Custom Chat Panel (uses publishData directly)
// ════════════════════════════════════
export interface ChatMsg {
  senderIdentity: string;
  senderName: string;
  message: string;
  timestamp: number;
  isLocal: boolean;
}

export interface ChatPanelProps {
  messages: ChatMsg[];
  onSend: (message: string) => void;
}

export function ChatPanel({ messages, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);


  const handleSend = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    
    onSend(draft.trim());
    setDraft('');
  }, [draft, onSend]);

  return (
    <div className="kloud-chat-panel">
      <div className="kloud-chat-messages">
        {messages.length === 0 && (
          <div className="kloud-chat-empty">No messages yet. Say hello! 👋</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`kloud-chat-entry ${msg.isLocal ? 'local' : 'remote'}`}>
            <div className="kloud-chat-meta">
              <span className="kloud-chat-sender">{msg.isLocal ? 'You' : msg.senderName}</span>
              <span className="kloud-chat-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="kloud-chat-text">{msg.message}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form className="kloud-chat-form" onSubmit={handleSend}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message..."
          className="kloud-chat-input"
          disabled={false}
        />
        <button type="submit" className="kloud-chat-send" disabled={!draft.trim()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
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
  canManageRoles: boolean; // host OR co-host
  localIdentity: string;
  autoPresenterIdentity: string | null;
  onAddCopresenter?: (identity: string) => void;
  onRemoveCopresenter?: (identity: string) => void;
  onSetCohost?: (identity: string) => void;
  onRemoveCohost?: (identity: string) => void;
  onSetHost?: (identity: string) => void;
  /** Whether the local user has permission to mute/unmute all */
  canMuteAll?: boolean;
  /** Whether "Mute All" has been activated (controls button state) */
  muteAllActive?: boolean;
  onMuteAll?: () => void;
  onUnmuteAll?: () => void;
}

export function AttendeePanel({
  hostIdentity,
  copresenterIdentities,
  cohostIdentities,
  canManageRoles,
  localIdentity,
  autoPresenterIdentity,
  onAddCopresenter,
  onRemoveCopresenter,
  onSetCohost,
  onRemoveCohost,
  onSetHost,
  canMuteAll,
  muteAllActive,
  onMuteAll,
  onUnmuteAll,
}: AttendeePanelProps) {
  const { t } = useI18n();
  const participants = useParticipants();
  const [searchQuery, setSearchQuery] = useState('');
  const [showHostPicker, setShowHostPicker] = useState(false);
  const [showHostMenu, setShowHostMenu] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [confirmHostId, setConfirmHostId] = useState<string | null>(null);

  // Close host menu on outside click
  useEffect(() => {
    if (!showHostMenu) return;
    const close = () => setShowHostMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showHostMenu]);

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

  // Candidates for host transfer (non-host participants)
  const hostCandidates = participants
    .filter((p) => p.identity !== hostIdentity)
    .filter((p) => {
      if (!pickerSearch.trim()) return true;
      const name = (p.name || p.identity || '').toLowerCase();
      return name.includes(pickerSearch.toLowerCase());
    });

  const confirmParticipant = confirmHostId
    ? participants.find((p) => p.identity === confirmHostId)
    : null;

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
          const isThisCopresenter = copresenterIdentities.includes(p.identity);

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

              {/* Host row: presenter toggle + ⋯ for transfer host */}
              {isThisHost && canManageRoles && (
                <div className="kloud-attendee-actions">
                  {isLocalParticipant && (
                    <button
                      className={`kloud-role-icon-btn ${isThisCopresenter ? 'checked' : ''}`}
                      onClick={() => isThisCopresenter ? onRemoveCopresenter?.(p.identity) : onAddCopresenter?.(p.identity)}
                      title={isThisCopresenter ? 'Stop Co-Presenting' : 'Co-Present'}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                        <path d="M12 1a3 3 0 00-3 3v7a3 3 0 006 0V4a3 3 0 00-3-3z" />
                        <path d="M19 10v1a7 7 0 01-14 0v-1" />
                        <line x1="12" y1="18" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                      {isThisCopresenter && (
                        <span className="kloud-check-badge">
                          <svg viewBox="0 0 16 16" fill="none" width="10" height="10">
                            <circle cx="8" cy="8" r="8" fill="#22c55e" />
                            <path d="M4.5 8.5l2 2 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      )}
                    </button>
                  )}
                  {/* ⋯ menu on host row */}
                  <div className="kloud-more-menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      className="kloud-role-icon-btn"
                      onClick={() => setShowHostMenu(!showHostMenu)}
                      title="More options"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                        <circle cx="5" cy="12" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="19" cy="12" r="2" />
                      </svg>
                    </button>
                    {showHostMenu && (
                      <div className="kloud-more-dropdown" onMouseDown={(e) => e.stopPropagation()}>
                        <button
                          className="kloud-more-dropdown-item"
                          onClick={() => {
                            setShowHostMenu(false);
                            setPickerSearch('');
                            setShowHostPicker(true);
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                            <circle cx="8.5" cy="7" r="4" />
                            <polyline points="17 11 19 13 23 9" />
                          </svg>
                          Transfer Host
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Non-host participants: presenter & co-host toggles only (no ⋯) */}
              {canManageRoles && !isLocalParticipant && !isThisHost && (
                <div className="kloud-attendee-actions">
                  <button
                    className={`kloud-role-icon-btn ${isThisCopresenter ? 'checked' : ''}`}
                    onClick={() => isThisCopresenter ? onRemoveCopresenter?.(p.identity) : onAddCopresenter?.(p.identity)}
                    title={isThisCopresenter ? 'Remove Co-Presenter' : 'Make Co-Presenter'}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                      <path d="M12 1a3 3 0 00-3 3v7a3 3 0 006 0V4a3 3 0 00-3-3z" />
                      <path d="M19 10v1a7 7 0 01-14 0v-1" />
                      <line x1="12" y1="18" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                    {isThisCopresenter && (
                      <span className="kloud-check-badge">
                        <svg viewBox="0 0 16 16" fill="none" width="10" height="10">
                          <circle cx="8" cy="8" r="8" fill="#22c55e" />
                          <path d="M4.5 8.5l2 2 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    )}
                  </button>
                  <button
                    className={`kloud-role-icon-btn ${isThisCohost ? 'checked' : ''}`}
                    onClick={() => isThisCohost ? onRemoveCohost?.(p.identity) : onSetCohost?.(p.identity)}
                    title={isThisCohost ? 'Remove Co-host' : 'Make Co-host'}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    {isThisCohost && (
                      <span className="kloud-check-badge">
                        <svg viewBox="0 0 16 16" fill="none" width="10" height="10">
                          <circle cx="8" cy="8" r="8" fill="#22c55e" />
                          <path d="M4.5 8.5l2 2 5-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && searchQuery && (
          <div className="kloud-attendee-empty">No participants match &quot;{searchQuery}&quot;</div>
        )}
      </div>

      {/* Host Transfer Picker Popup */}
      {showHostPicker && (
        <div className="kloud-confirm-overlay" onClick={() => { setShowHostPicker(false); setConfirmHostId(null); }}>
          <div className="kloud-host-picker" onClick={(e) => e.stopPropagation()}>
            {!confirmHostId ? (
              <>
                <div className="kloud-host-picker-header">
                  <h3 className="kloud-host-picker-title">Transfer Host</h3>
                  <button className="kloud-host-picker-close" onClick={() => setShowHostPicker(false)}>✕</button>
                </div>
                <p className="kloud-host-picker-desc">Select a participant to become the new Host. You will become Co-host.</p>
                {participants.length >= 5 && (
                  <div className="kloud-host-picker-search">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      type="text"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="Search..."
                      className="kloud-host-picker-search-input"
                      autoFocus
                    />
                  </div>
                )}
                <div className="kloud-host-picker-list">
                  {hostCandidates.map((p) => {
                    const name = p.name || p.identity || '??';
                    const initials = getInitials(name);
                    const roles = getRoles(p.identity);
                    return (
                      <button
                        key={p.identity}
                        className="kloud-host-picker-item"
                        onClick={() => setConfirmHostId(p.identity)}
                      >
                        <div className="kloud-attendee-avatar">{initials}</div>
                        <div className="kloud-host-picker-item-info">
                          <span className="kloud-attendee-name">{name}</span>
                          <div className="kloud-attendee-badges">
                            {roles.map((r) => (
                              <span key={r.cls} className={`kloud-attendee-role ${r.cls}`}>{r.label}</span>
                            ))}
                          </div>
                        </div>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ flexShrink: 0, opacity: 0.4 }}>
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    );
                  })}
                  {hostCandidates.length === 0 && (
                    <div className="kloud-attendee-empty">No participants found</div>
                  )}
                </div>
              </>
            ) : confirmParticipant && (
              <>
                <div className="kloud-host-picker-header">
                  <button className="kloud-host-picker-back" onClick={() => setConfirmHostId(null)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <h3 className="kloud-host-picker-title">Confirm Transfer</h3>
                  <button className="kloud-host-picker-close" onClick={() => { setShowHostPicker(false); setConfirmHostId(null); }}>✕</button>
                </div>
                <div className="kloud-confirm-body">
                  <div className="kloud-confirm-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" width="32" height="32">
                      <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <p className="kloud-confirm-text">
                    <strong>{confirmParticipant.name || confirmParticipant.identity}</strong> will become the new Host.
                    You will be automatically demoted to Co-host.
                  </p>
                  <div className="kloud-confirm-actions">
                    <button className="kloud-confirm-cancel" onClick={() => setConfirmHostId(null)}>Cancel</button>
                    <button
                      className="kloud-confirm-proceed"
                      onClick={() => {
                        onSetHost?.(confirmHostId);
                        setConfirmHostId(null);
                        setShowHostPicker(false);
                      }}
                    >
                      Transfer Host
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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
  .kloud-chat-form {
    padding: 8px 12px;
    border-top: 1px solid rgba(255,255,255,0.08);
    display: flex;
    gap: 6px;
  }
  .kloud-chat-input {
    flex: 1;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.12);
    color: #fff;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .kloud-chat-input:focus {
    border-color: rgba(59, 130, 246, 0.5);
  }
  .kloud-chat-input::placeholder {
    color: rgba(255,255,255,0.3);
  }
  .kloud-chat-send {
    background: #3b82f6;
    border: none;
    color: #fff;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .kloud-chat-send:hover:not(:disabled) {
    background: #2563eb;
  }
  .kloud-chat-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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

  /* Action buttons */
  .kloud-attendee-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    align-items: center;
  }
  .kloud-role-icon-btn {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.05);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    color: rgba(255,255,255,0.5);
  }
  .kloud-role-icon-btn:hover {
    background: rgba(255,255,255,0.12);
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
    min-width: 140px;
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
  }
  .kloud-more-dropdown-item:hover {
    background: rgba(255,255,255,0.08);
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
`;
