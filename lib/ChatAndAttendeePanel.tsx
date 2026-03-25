import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRoomContext, useParticipants } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';

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
  presenterIdentity: string | null;
  cohostIdentities: string[];
  isHost: boolean;
  onSetPresenter?: (identity: string) => void;
  onSetCohost?: (identity: string) => void;
  onRemoveCohost?: (identity: string) => void;
}

export function AttendeePanel({
  hostIdentity,
  presenterIdentity,
  cohostIdentities,
  isHost,
  onSetPresenter,
  onSetCohost,
  onRemoveCohost,
}: AttendeePanelProps) {
  const participants = useParticipants();

  const getRole = (identity: string): string => {
    if (identity === hostIdentity) return 'Host';
    if (cohostIdentities.includes(identity)) return 'Co-host';
    if (identity === presenterIdentity) return 'Presenter';
    return 'Attendee';
  };

  const getRoleBadgeClass = (identity: string): string => {
    if (identity === hostIdentity) return 'role-host';
    if (cohostIdentities.includes(identity)) return 'role-cohost';
    if (identity === presenterIdentity) return 'role-presenter';
    return 'role-attendee';
  };

  // Sort: Host first, then co-hosts, then presenter, then attendees (by join time)
  const sorted = [...participants].sort((a, b) => {
    const roleOrder = (identity: string) => {
      if (identity === hostIdentity) return 0;
      if (cohostIdentities.includes(identity)) return 1;
      if (identity === presenterIdentity) return 2;
      return 3;
    };
    const rA = roleOrder(a.identity);
    const rB = roleOrder(b.identity);
    if (rA !== rB) return rA - rB;
    return (a.joinedAt?.getTime() || 0) - (b.joinedAt?.getTime() || 0);
  });

  return (
    <div className="kloud-attendee-panel">
      <div className="kloud-attendee-header">
        <span className="kloud-attendee-count">{participants.length} Participant{participants.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="kloud-attendee-list">
        {sorted.map((p) => {
          const role = getRole(p.identity);
          const badgeClass = getRoleBadgeClass(p.identity);
          const name = p.name || p.identity || '??';
          const initials = name.slice(0, 2).toUpperCase();
          const isLocalParticipant = p.isLocal;

          return (
            <div key={p.identity} className="kloud-attendee-row">
              <div className="kloud-attendee-avatar">
                {initials}
              </div>
              <div className="kloud-attendee-info">
                <span className="kloud-attendee-name">
                  {name}{isLocalParticipant ? ' (You)' : ''}
                </span>
                <span className={`kloud-attendee-role ${badgeClass}`}>{role}</span>
              </div>
              {/* Host can assign roles to non-host participants */}
              {isHost && !isLocalParticipant && p.identity !== hostIdentity && (
                <div className="kloud-attendee-actions">
                  {p.identity !== presenterIdentity ? (
                    <button
                      className="kloud-role-btn"
                      onClick={() => onSetPresenter?.(p.identity)}
                      title="Make Presenter"
                    >
                      🎤
                    </button>
                  ) : (
                    <button
                      className="kloud-role-btn active"
                      onClick={() => onSetPresenter?.('')}
                      title="Remove Presenter"
                    >
                      ✕
                    </button>
                  )}
                  {!cohostIdentities.includes(p.identity) ? (
                    <button
                      className="kloud-role-btn"
                      onClick={() => onSetCohost?.(p.identity)}
                      title="Make Co-host"
                    >
                      ⭐
                    </button>
                  ) : (
                    <button
                      className="kloud-role-btn active"
                      onClick={() => onRemoveCohost?.(p.identity)}
                      title="Remove Co-host"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
  }
  .kloud-attendee-header {
    padding: 4px 12px;
  }
  .kloud-attendee-count {
    color: rgba(255,255,255,0.4);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
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
  .kloud-attendee-role {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
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
  .role-attendee {
    color: rgba(255,255,255,0.4);
    background: rgba(255,255,255,0.05);
  }
  .kloud-attendee-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .kloud-role-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.05);
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }
  .kloud-role-btn:hover {
    background: rgba(255,255,255,0.15);
    border-color: rgba(255,255,255,0.2);
  }
  .kloud-role-btn.active {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }
`;
