'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useParticipants } from '@livekit/components-react';
import { getInitials } from '@/lib/getInitials';

export interface ParticipantRoleActionsConfig {
  hostIdentity: string | null;
  copresenterIdentities: string[];
  cohostIdentities: string[];
  canManageRoles: boolean;
  localIdentity: string;
  autoPresenterIdentity: string | null;
  onAddCopresenter?: (identity: string) => void;
  onRemoveCopresenter?: (identity: string) => void;
  onSetCohost?: (identity: string) => void;
  onRemoveCohost?: (identity: string) => void;
  onSetHost?: (identity: string) => void;
  onRemoveFromMeeting?: (identity: string) => void;
}

export type ParticipantRoleMenuBridge = {
  toggleMenu: (identity: string, anchor: HTMLElement) => void;
  getConfig: () => ParticipantRoleActionsConfig;
};

/** DOM 注入 carousel 按钮时调用 */
export const participantRoleMenuBridge: { current: ParticipantRoleMenuBridge | null } = {
  current: null,
};

type MenuAnchor = { identity: string; rect: DOMRect };

interface ParticipantRoleMenuContextValue extends ParticipantRoleActionsConfig {
  openMenuIdentity: string | null;
  menuAnchor: MenuAnchor | null;
  toggleMenu: (identity: string, anchorEl: HTMLElement) => void;
  closeMenu: () => void;
  openHostPicker: () => void;
}

const ParticipantRoleMenuContext = createContext<ParticipantRoleMenuContextValue | null>(null);

function useParticipantRoleMenu() {
  const ctx = useContext(ParticipantRoleMenuContext);
  if (!ctx) {
    throw new Error('ParticipantRoleMenu components must be used within ParticipantRoleMenuProvider');
  }
  return ctx;
}

function getRoles(
  identity: string,
  config: Pick<
    ParticipantRoleActionsConfig,
    'hostIdentity' | 'cohostIdentities' | 'copresenterIdentities' | 'autoPresenterIdentity'
  >,
): { label: string; cls: string }[] {
  const roles: { label: string; cls: string }[] = [];
  if (identity === config.hostIdentity) roles.push({ label: 'Host', cls: 'role-host' });
  if (config.cohostIdentities.includes(identity) && identity !== config.hostIdentity) {
    roles.push({ label: 'Co-host', cls: 'role-cohost' });
  }
  if (identity === config.autoPresenterIdentity) roles.push({ label: 'Presenter', cls: 'role-presenter' });
  if (config.copresenterIdentities.includes(identity)) {
    roles.push({ label: 'Co-Presenter', cls: 'role-copresenter' });
  }
  if (roles.length === 0) roles.push({ label: 'Attendee', cls: 'role-attendee' });
  return roles;
}

function shouldShowRoleMenu(
  identity: string,
  config: Pick<ParticipantRoleActionsConfig, 'hostIdentity' | 'localIdentity' | 'canManageRoles'>,
): boolean {
  if (!config.canManageRoles) return false;
  const isThisHost = identity === config.hostIdentity;
  const isLocal = identity === config.localIdentity;
  return isThisHost || (!isLocal && !isThisHost);
}

export function ParticipantRoleMenuProvider({
  children,
  ...config
}: ParticipantRoleActionsConfig & { children: React.ReactNode }) {
  const [openMenuIdentity, setOpenMenuIdentity] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [showHostPicker, setShowHostPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [confirmHostId, setConfirmHostId] = useState<string | null>(null);
  const participants = useParticipants();

  const closeMenu = useCallback(() => {
    setOpenMenuIdentity(null);
    setMenuAnchor(null);
  }, []);

  const toggleMenu = useCallback((identity: string, anchorEl: HTMLElement) => {
    setOpenMenuIdentity((prev) => {
      if (prev === identity) {
        setMenuAnchor(null);
        return null;
      }
      setMenuAnchor({ identity, rect: anchorEl.getBoundingClientRect() });
      return identity;
    });
  }, []);

  const openHostPicker = useCallback(() => {
    closeMenu();
    setPickerSearch('');
    setConfirmHostId(null);
    setShowHostPicker(true);
  }, [closeMenu]);

  useEffect(() => {
    if (!openMenuIdentity) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.kloud-more-menu-anchor, .kloud-tile-more-menu-btn, .kloud-more-menu-portal')) return;
      closeMenu();
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [openMenuIdentity, closeMenu]);

  useEffect(() => {
    document.querySelectorAll('.kloud-tile-more-menu-wrap').forEach((el) => {
      const id = el.getAttribute('data-kloud-identity');
      const isOpen = id === openMenuIdentity;
      el.classList.toggle('open', isOpen);
      el.querySelector('.kloud-tile-more-menu-btn')?.classList.toggle('open', isOpen);
    });
  }, [openMenuIdentity]);

  useEffect(() => {
    participantRoleMenuBridge.current = {
      toggleMenu,
      getConfig: () => config,
    };
    return () => {
      participantRoleMenuBridge.current = null;
    };
  }, [toggleMenu, config]);

  const ctxValue = useMemo<ParticipantRoleMenuContextValue>(
    () => ({
      ...config,
      openMenuIdentity,
      menuAnchor,
      toggleMenu,
      closeMenu,
      openHostPicker,
    }),
    [config, openMenuIdentity, menuAnchor, toggleMenu, closeMenu, openHostPicker],
  );

  const hostCandidates = participants
    .filter((p) => p.identity !== config.hostIdentity)
    .filter((p) => {
      if (!pickerSearch.trim()) return true;
      const name = (p.name || p.identity || '').toLowerCase();
      return name.includes(pickerSearch.toLowerCase());
    });

  const confirmParticipant = confirmHostId
    ? participants.find((p) => p.identity === confirmHostId)
    : null;

  return (
    <ParticipantRoleMenuContext.Provider value={ctxValue}>
      {children}
      {openMenuIdentity && menuAnchor && (
        <ParticipantRoleDropdownPortal
          identity={openMenuIdentity}
          anchorRect={menuAnchor.rect}
        />
      )}
      {showHostPicker && (
        <div
          className="kloud-confirm-overlay kloud-host-transfer-overlay"
          onClick={() => {
            setShowHostPicker(false);
            setConfirmHostId(null);
          }}
        >
          <div className="kloud-host-picker" onClick={(e) => e.stopPropagation()}>
            {!confirmHostId ? (
              <>
                <div className="kloud-host-picker-header">
                  <h3 className="kloud-host-picker-title">Transfer Host</h3>
                  <button className="kloud-host-picker-close" onClick={() => setShowHostPicker(false)}>
                    ✕
                  </button>
                </div>
                <p className="kloud-host-picker-desc">
                  Select a participant to become the new Host. You will become Co-host.
                </p>
                {participants.length >= 5 && (
                  <div className="kloud-host-picker-search">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
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
                    const roles = getRoles(p.identity, config);
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
                              <span key={r.cls} className={`kloud-attendee-role ${r.cls}`}>
                                {r.label}
                              </span>
                            ))}
                          </div>
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          width="16"
                          height="16"
                          style={{ flexShrink: 0, opacity: 0.4 }}
                        >
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
            ) : (
              confirmParticipant && (
                <>
                  <div className="kloud-host-picker-header">
                    <button className="kloud-host-picker-back" onClick={() => setConfirmHostId(null)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <h3 className="kloud-host-picker-title">Confirm Transfer</h3>
                    <button
                      className="kloud-host-picker-close"
                      onClick={() => {
                        setShowHostPicker(false);
                        setConfirmHostId(null);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="kloud-confirm-body">
                    <div className="kloud-confirm-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" width="32" height="32">
                        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <p className="kloud-confirm-text">
                      <strong>{confirmParticipant.name || confirmParticipant.identity}</strong> will become the new
                      Host. You will be automatically demoted to Co-host.
                    </p>
                    <div className="kloud-confirm-actions">
                      <button className="kloud-confirm-cancel" onClick={() => setConfirmHostId(null)}>
                        Cancel
                      </button>
                      <button
                        className="kloud-confirm-proceed"
                        onClick={() => {
                          config.onSetHost?.(confirmHostId);
                          setConfirmHostId(null);
                          setShowHostPicker(false);
                        }}
                      >
                        Transfer Host
                      </button>
                    </div>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      )}
    </ParticipantRoleMenuContext.Provider>
  );
}

function ParticipantRoleDropdownContent({
  identity,
  onClose,
}: {
  identity: string;
  onClose?: () => void;
}) {
  const ctx = useContext(ParticipantRoleMenuContext);
  if (!ctx) return null;

  const {
    hostIdentity,
    copresenterIdentities,
    cohostIdentities,
    localIdentity,
    canManageRoles,
    onAddCopresenter,
    onRemoveCopresenter,
    onSetCohost,
    onRemoveCohost,
    onRemoveFromMeeting,
    closeMenu: ctxCloseMenu,
    openHostPicker: ctxOpenHostPicker,
  } = ctx;

  const closeMenu = onClose ?? ctxCloseMenu;
  const openHostPicker = () => {
    closeMenu();
    ctxOpenHostPicker();
  };

  const isThisHost = identity === hostIdentity;
  const isLocalParticipant = identity === localIdentity;
  const isThisCohost = cohostIdentities.includes(identity);
  const isThisCopresenter = copresenterIdentities.includes(identity);
  const canRemoveFromMeeting =
    canManageRoles && !isThisHost && !isLocalParticipant && !!onRemoveFromMeeting;

  return (
    <div className="kloud-more-dropdown" onMouseDown={(e) => e.stopPropagation()}>
      {isThisHost && isLocalParticipant && (
        <button
          className={`kloud-more-dropdown-item${isThisCopresenter ? ' active' : ''}`}
          onClick={() => {
            if (isThisCopresenter) {
              onRemoveCopresenter?.(identity);
            } else {
              onAddCopresenter?.(identity);
            }
            closeMenu();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <path d="M12 1a3 3 0 00-3 3v7a3 3 0 006 0V4a3 3 0 00-3-3z" />
            <path d="M19 10v1a7 7 0 01-14 0v-1" />
            <line x1="12" y1="18" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          {isThisCopresenter ? 'Stop Co-Presenting' : 'Co-Present'}
        </button>
      )}
      {!isThisHost && (
        <>
          <button
            className={`kloud-more-dropdown-item${isThisCopresenter ? ' active' : ''}`}
            onClick={() => {
              if (isThisCopresenter) {
                onRemoveCopresenter?.(identity);
              } else {
                onAddCopresenter?.(identity);
              }
              closeMenu();
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
              <path d="M12 1a3 3 0 00-3 3v7a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v1a7 7 0 01-14 0v-1" />
              <line x1="12" y1="18" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            {isThisCopresenter ? 'Remove Co-Presenter' : 'Make Co-Presenter'}
          </button>
          <button
            className={`kloud-more-dropdown-item${isThisCohost ? ' active' : ''}`}
            onClick={() => {
              if (isThisCohost) {
                onRemoveCohost?.(identity);
              } else {
                onSetCohost?.(identity);
              }
              closeMenu();
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {isThisCohost ? 'Remove Co-host' : 'Make Co-host'}
          </button>
        </>
      )}
      {isThisHost && (
        <button
          className="kloud-more-dropdown-item"
          onClick={() => {
            openHostPicker();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <polyline points="17 11 19 13 23 9" />
          </svg>
          Transfer Host
        </button>
      )}
      {canRemoveFromMeeting && (
        <button
          className="kloud-more-dropdown-item danger"
          onClick={() => {
            onRemoveFromMeeting?.(identity);
            closeMenu();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
            <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="17" y1="8" x2="22" y2="13" />
            <line x1="22" y1="8" x2="17" y2="13" />
          </svg>
          Remove from meeting
        </button>
      )}
    </div>
  );
}

function ParticipantRoleDropdownPortal({
  identity,
  anchorRect,
}: {
  identity: string;
  anchorRect: DOMRect;
}) {
  // 右对齐锚点，宽度由菜单文字决定（不换行）
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    right: Math.max(8, window.innerWidth - anchorRect.right),
    left: 'auto',
    zIndex: 100000,
  };

  return (
    <div className="kloud-more-menu-portal" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <ParticipantRoleDropdownContent identity={identity} />
    </div>
  );
}

const moreBtnSvg = (
  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);

/** 浮窗 / webcam 侧边栏 / 主网格 tile ⋯ 按钮（hover 显示） */
export function ParticipantTileRoleMoreMenu({
  identity,
  placement = 'overlay',
}: {
  identity: string;
  placement?: 'overlay' | 'inline';
}) {
  const ctx = useContext(ParticipantRoleMenuContext);
  const anchorRef = React.useRef<HTMLDivElement>(null);

  if (!ctx || !shouldShowRoleMenu(identity, ctx)) return null;

  const isOpen = ctx.openMenuIdentity === identity;

  return (
    <div
      ref={anchorRef}
      className={`kloud-tile-more-menu-wrap kloud-more-menu-anchor kloud-tile-more-menu-wrap--${placement}${isOpen ? ' open' : ''}`}
      data-kloud-identity={identity}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`kloud-role-icon-btn kloud-tile-more-menu-btn${isOpen ? ' open' : ''}`}
        title="More options"
        onClick={() => {
          if (anchorRef.current) {
            ctx.toggleMenu(identity, anchorRef.current);
          }
        }}
      >
        {moreBtnSvg}
      </button>
    </div>
  );
}

export { shouldShowRoleMenu };

/** 参会列表面板每行 ⋯ 菜单（内联下拉，与原先 kloud-attendee-list 一致） */
export function ParticipantAttendeeRowMoreMenu({
  identity,
  isOpen,
  onToggle,
  onClose,
}: {
  identity: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ctx = useContext(ParticipantRoleMenuContext);
  if (!ctx || !shouldShowRoleMenu(identity, ctx)) return null;

  return (
    <div className="kloud-attendee-actions">
      <div className="kloud-more-menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="kloud-role-icon-btn" onClick={onToggle} title="More options">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
        {isOpen && <ParticipantRoleDropdownContent identity={identity} onClose={onClose} />}
      </div>
    </div>
  );
}

/** carousel DOM 注入用 SVG */
export const KLoud_TILE_MORE_BTN_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
