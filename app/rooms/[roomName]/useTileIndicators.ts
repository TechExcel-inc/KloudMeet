import React from 'react';
import { RoomEvent, Track, type Room } from 'livekit-client';
import { getInitials } from '@/lib/getInitials';
import {
  KLoud_TILE_MORE_BTN_SVG,
  participantRoleMenuBridge,
  shouldShowRoleMenu,
} from '@/lib/ParticipantRoleMenu';
import { applyTileHue } from '@/lib/tileLayout';

const TILE_REFRESH_EVENTS = [
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ParticipantNameChanged,
  RoomEvent.Connected,
] as const;

/** 新瓦片挂上时补一次（只看 childList，避免改属性时和注入逻辑互相踩） */
function observeNewParticipantTiles(onAdd: () => void): () => void {
  const root = document.querySelector('.lk-room-container') ?? document.body;
  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (
          node.classList.contains('lk-participant-tile') ||
          node.querySelector('.lk-participant-tile')
        ) {
          onAdd();
          return;
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

interface TileIndicatorOptions {
  room: Room;
  hostIdentity: string | null;
  cohostIdentities: string[];
  autoPresenterIdentity: string | null;
  copresenterIdentities: string[];
  /** 本端是主持人 / 联席主持人：决定能否点别人的麦克风 / 摄像头图标 */
  isHost: boolean;
  isCohost: boolean;
  /** 以下状态只用来触发重绘；绘制时读对应 ref 的最新值 */
  muteAllActive: boolean;
  hostMutedIdentities: string[];
  hostDisabledVideoIdentities: string[];
  exemptFromMuteAllIdentities: string[];
  /** 共享开始 / 结束、侧栏折叠时瓦片会重新挂载，需要重新注入 */
  hasScreenShare: boolean;
  isWebcamSidebarCollapsed: boolean;
  muteAllActiveRef: React.MutableRefObject<boolean>;
  hostMutedIdentitiesRef: React.MutableRefObject<string[]>;
  hostDisabledVideoIdentitiesRef: React.MutableRefObject<string[]>;
  exemptFromMuteAllIdentitiesRef: React.MutableRefObject<string[]>;
  raisedHandsRef: React.MutableRefObject<string[]>;
  /** 写入立即重绘函数，供其它副作用（举手、禁麦变化等）直接调用 */
  updateCustomMicsRef: React.MutableRefObject<(() => void) | null>;
}

/**
 * useTileIndicators — 在 LiveKit 参会者瓦片上注入麦克风 / 摄像头图标、举手角标与 ⋯ 菜单
 *
 * 覆盖主网格、移动网格、LiveDoc 侧栏与共享时左侧 carousel；
 * 由 LiveKit 轨道事件驱动，新瓦片挂载时再补一次。
 */
export function useTileIndicators({
  room,
  hostIdentity,
  cohostIdentities,
  autoPresenterIdentity,
  copresenterIdentities,
  isHost,
  isCohost,
  muteAllActive,
  hostMutedIdentities,
  hostDisabledVideoIdentities,
  exemptFromMuteAllIdentities,
  hasScreenShare,
  isWebcamSidebarCollapsed,
  muteAllActiveRef,
  hostMutedIdentitiesRef,
  hostDisabledVideoIdentitiesRef,
  exemptFromMuteAllIdentitiesRef,
  raisedHandsRef,
  updateCustomMicsRef,
}: TileIndicatorOptions): void {
  // ══════════════════════════════════════════════════════════════════════
  // Custom DOM-injected Microphone Indicator (Bypassing LiveKit default)
  // Ensures the mic indicator is ALWAYS visible and supports 3 states:
  // Green (active), Gray (voluntarily muted), Red (force-muted by host)
  // ══════════════════════════════════════════════════════════════════════
  React.useEffect(() => {
    if (!room) return;

    // SVG templates for the mic icon
    const micSvg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/></svg>`;
    const micOffSvg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zm-5 9a1 1 0 01-1-1v-1.08A7.007 7.007 0 015 11H3a9.009 9.009 0 008 8.93V21a1 1 0 102 0v-1.07A9.009 9.009 0 0021 11h-2a7.007 7.007 0 01-6 6.92V19a1 1 0 01-1 1z"/><line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>`;
    const handSvg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.925m3.075.75V4.575m0 0a1.575 1.575 0 013.15 0V15M6.9 7.575a1.575 1.575 0 10-3.15 0v8.175a6.75 6.75 0 006.75 6.75h2.018a5.25 5.25 0 003.712-1.538l1.732-1.732a5.25 5.25 0 001.538-3.712l.003-2.024a.668.668 0 01.198-.471 1.575 1.575 0 10-2.228-2.228 3.818 3.818 0 00-1.12 2.687M6.9 7.575V12"/></svg>`;
    const camSvg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`;
    const camOffSvg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/><line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>`;

    const applyKloudIndicatorColor = (el: HTMLElement, color: string) => {
      el.style.setProperty('color', color, 'important');
      el.querySelectorAll('svg').forEach((svg) => {
        (svg as SVGElement).style.setProperty('fill', color, 'important');
        svg.querySelectorAll('path').forEach((path) => {
          (path as SVGElement).style.setProperty('fill', color, 'important');
        });
        svg.querySelectorAll('line').forEach((line) => {
          (line as SVGElement).style.setProperty('stroke', color, 'important');
        });
      });
    };

    const updateCustomMics = () => {
      // 主网格 + 活文档右侧栏 + 屏幕共享左侧 carousel（浮窗由 React 组件渲染麦/摄像头图标）
      const tiles = document.querySelectorAll(
        '.lk-grid-layout-wrapper .lk-participant-tile, .lk-mobile-scroll-grid .lk-participant-tile, .webcam-sidebar-panel .webcam-sidebar-tile.lk-participant-tile, .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile',
      );
      const muteAllApplied = muteAllActiveRef.current;
      const restrictedMicIdentities = hostMutedIdentitiesRef.current;
      const restrictedVideoIdentities = hostDisabledVideoIdentitiesRef.current;
      const exemptIdentities = exemptFromMuteAllIdentitiesRef.current;
      const handIdentities = raisedHandsRef.current;

      tiles.forEach((tile) => {
        const inCarousel = !!tile.closest('.lk-carousel');
        const inWebcamSidebar = !!tile.closest('.webcam-sidebar-panel');
        const inGrid =
          !!tile.closest('.lk-grid-layout-wrapper') || !!tile.closest('.lk-mobile-scroll-grid');

        // Determine participant identity from the tile's data-lk-participant or fallback to name matching
        let identity = tile.getAttribute('data-lk-participant');
        let participant = identity === room.localParticipant.identity ? room.localParticipant : (identity ? room.remoteParticipants.get(identity) : null);

        // Fallback to name matching if data attribute doesn't contain identity
        if (!participant) {
          const nameEl = tile.querySelector(
            '.lk-participant-name, .floating-grid-name, .webcam-sidebar-name',
          );
          const displayName = nameEl?.textContent?.trim();
          const matched = Array.from(room.remoteParticipants.values()).find(p => (p.name || p.identity) === displayName);
          participant = matched || (room.localParticipant.name === displayName ? room.localParticipant : null);
        }
        if (!participant) return;
        identity = participant.identity;
        const isLocal = participant.identity === room.localParticipant.identity;
        tile.setAttribute('data-lk-participant', identity);
        tile.setAttribute('data-lk-local-participant', isLocal ? 'true' : 'false');

        // 举手角标：主网格 / 移动网格 / 共享 carousel 走 DOM 注入；
        // LiveDoc 侧栏由 KloudTileHandBadge 渲染，此处跳过以免重复注入
        if (!inWebcamSidebar) {
          const existingHandBadge = tile.querySelector('.kloud-tile-hand-badge');
          if (!handIdentities.includes(identity)) {
            existingHandBadge?.remove();
          } else if (!existingHandBadge) {
            const handBadge = document.createElement('div');
            handBadge.className = 'kloud-tile-hand-badge';
            handBadge.setAttribute('data-kloud-identity', identity);
            handBadge.setAttribute('aria-hidden', 'true');
            handBadge.innerHTML = handSvg;
            tile.appendChild(handBadge);
          }
        }

        let metadata = tile.querySelector('.lk-participant-metadata');
        if (!metadata && inCarousel) {
          metadata = document.createElement('div');
          metadata.className = 'lk-participant-metadata';
          const itemContainer = document.createElement('div');
          itemContainer.className = 'lk-participant-metadata-item';
          const nameSpan = document.createElement('span');
          nameSpan.className = 'lk-participant-name';
          nameSpan.textContent = participant.name || participant.identity;
          itemContainer.appendChild(nameSpan);
          metadata.appendChild(itemContainer);
          tile.appendChild(metadata);
        }
        if (!metadata) return;

        let itemContainer = metadata.querySelector('.lk-participant-metadata-item');
        if (!itemContainer) {
          itemContainer = document.createElement('div');
          itemContainer.className = 'lk-participant-metadata-item';
          metadata.appendChild(itemContainer);
        }
        // 仅 screenshare aside（carousel）补 LiveKit 风格名字；浮窗/侧栏已有专用 name 节点，禁止重复注入
        if (inCarousel && !itemContainer.querySelector('.lk-participant-name')) {
          const nameSpan = document.createElement('span');
          nameSpan.className = 'lk-participant-name';
          nameSpan.textContent = participant.name || participant.identity;
          itemContainer.appendChild(nameSpan);
        } else if (!inCarousel) {
          const builtInName = itemContainer.querySelector('.floating-grid-name, .webcam-sidebar-name');
          if (builtInName) {
            itemContainer.querySelectorAll('.lk-participant-name').forEach((el) => el.remove());
          }
        }

        const micPub = participant.getTrackPublication(Track.Source.Microphone);
        const isMuted = !micPub?.track || micPub.isMuted;

        // Is this participant force-muted? (Hosts, co-hosts, auto-presenters are exempt)
        const targetIsHost = identity === hostIdentity;
        const targetIsCohost = cohostIdentities.includes(identity);
        const targetIsAutoPresenter = autoPresenterIdentity === identity;
        const targetIsCopresenter = copresenterIdentities.includes(identity);
        const targetIsOperator = targetIsHost || targetIsCohost || targetIsAutoPresenter || targetIsCopresenter;

        // Force muted: mute-all batch (red when actually muted); individual host ban uses data-kloud-host-restricted
        const isHostMicRestricted = restrictedMicIdentities.includes(identity) && !targetIsOperator;
        const isMuteAllForced =
          muteAllApplied && !exemptIdentities.includes(identity) && !targetIsOperator && isMuted;
        const isForceMuted = isMuteAllForced;
        tile.setAttribute('data-kloud-force-muted', isForceMuted ? 'true' : 'false');

        // Look for our custom icon container, or create it if missing
        let customMic = metadata.querySelector('.kloud-custom-mic-indicator');
        if (!customMic) {
          customMic = document.createElement('div');
          customMic.className = 'kloud-custom-mic-indicator';
          const nameAnchor =
            itemContainer.querySelector('.floating-grid-name') ||
            itemContainer.querySelector('.webcam-sidebar-name') ||
            itemContainer.querySelector('.lk-participant-name');
          if (nameAnchor) {
            itemContainer.insertBefore(customMic, nameAnchor);
          } else {
            itemContainer.insertBefore(customMic, itemContainer.firstChild);
          }
        }

        const customMicEl = customMic as HTMLElement;
        customMicEl.setAttribute('data-kloud-identity', identity);
        customMicEl.setAttribute('data-kloud-muted', isMuted ? 'true' : 'false');
        customMicEl.setAttribute('data-kloud-host-restricted', isHostMicRestricted ? 'true' : 'false');
        customMicEl.setAttribute('data-kloud-force-muted', isForceMuted ? 'true' : 'false');
        customMicEl.classList.toggle('kloud-custom-mic--force-muted', isHostMicRestricted || isForceMuted);
        customMicEl.innerHTML = isMuted ? micOffSvg : micSvg;
        if (isHostMicRestricted || isForceMuted) {
          applyKloudIndicatorColor(customMicEl, '#ff2020');
        } else if (isMuted) {
          applyKloudIndicatorColor(customMicEl, 'rgba(255, 255, 255, 0.75)');
        } else {
          applyKloudIndicatorColor(customMicEl, '#22c55e');
        }

        customMic.classList.remove('operator-interactive', 'self-interactive');
        if (isLocal) {
          if (!isHostMicRestricted && !isForceMuted) {
            customMic.classList.add('self-interactive');
            customMic.setAttribute('title', isMuted ? 'Turn on microphone' : 'Turn off microphone');
          } else {
            customMic.removeAttribute('title');
          }
        } else if (isHost || isCohost) {
          customMic.classList.add('operator-interactive');
          customMic.setAttribute(
            'title',
            isHostMicRestricted ? 'Cancel disable (does not turn on mic)' : 'Disable microphone',
          );
        } else {
          customMic.removeAttribute('title');
        }

        const camPub = participant.getTrackPublication(Track.Source.Camera);
        const isVideoDisabled = !camPub?.track || camPub.isMuted;
        const isHostVideoRestricted = restrictedVideoIdentities.includes(identity) && !targetIsOperator;

        let customCam = metadata.querySelector('.kloud-custom-cam-indicator');
        if (!customCam) {
          customCam = document.createElement('div');
          customCam.className = 'kloud-custom-cam-indicator';
          customMic.insertAdjacentElement('afterend', customCam);
        }

        const customCamEl = customCam as HTMLElement;
        customCamEl.setAttribute('data-kloud-identity', identity);
        customCamEl.setAttribute('data-kloud-video-disabled', isVideoDisabled ? 'true' : 'false');
        customCamEl.setAttribute('data-kloud-host-restricted', isHostVideoRestricted ? 'true' : 'false');
        customCamEl.classList.toggle('kloud-custom-cam--force-disabled', isHostVideoRestricted);
        customCamEl.innerHTML = isVideoDisabled ? camOffSvg : camSvg;
        if (isHostVideoRestricted) {
          applyKloudIndicatorColor(customCamEl, '#ff2020');
        } else if (isVideoDisabled) {
          applyKloudIndicatorColor(customCamEl, 'rgba(255, 255, 255, 0.75)');
        } else {
          applyKloudIndicatorColor(customCamEl, '#22c55e');
        }

        customCam.classList.remove('operator-interactive', 'self-interactive');
        if (isLocal) {
          if (!isHostVideoRestricted) {
            customCam.classList.add('self-interactive');
            customCam.setAttribute('title', isVideoDisabled ? 'Turn on camera' : 'Turn off camera');
          } else {
            customCam.removeAttribute('title');
          }
        } else if (isHost || isCohost) {
          customCam.classList.add('operator-interactive');
          customCam.setAttribute(
            'title',
            isHostVideoRestricted ? 'Cancel disable (does not turn on camera)' : 'Disable camera',
          );
        } else {
          customCam.removeAttribute('title');
        }

        const tileSource = tile.getAttribute('data-lk-source') || '';
        const isCameraTile =
          !tileSource || tileSource === 'camera' || tileSource === String(Track.Source.Camera);
        const shouldInjectDomMoreMenu =
          isCameraTile && (inCarousel || (inGrid && !inWebcamSidebar));

        if (shouldInjectDomMoreMenu) {
          const roleConfig = participantRoleMenuBridge.current?.getConfig();
          const isThisHost = identity === hostIdentity;
          // 与 React 版 ⋯ 菜单共用可见性判断，避免"能放手但看不到菜单"的分叉
          const showMoreMenu = roleConfig
            ? shouldShowRoleMenu(identity, roleConfig)
            : (isHost || isCohost) && (isThisHost || !isLocal);

          let moreWrap = tile.querySelector('.kloud-tile-more-menu-wrap') as HTMLElement | null;
          if (!showMoreMenu) {
            moreWrap?.remove();
          } else {
            if (!moreWrap) {
              moreWrap = document.createElement('div');
              moreWrap.className = 'kloud-tile-more-menu-wrap kloud-more-menu-anchor kloud-tile-more-menu-wrap--inline';
              const moreBtn = document.createElement('button');
              moreBtn.type = 'button';
              moreBtn.className = 'kloud-role-icon-btn kloud-tile-more-menu-btn';
              moreBtn.title = 'More options';
              moreBtn.innerHTML = KLoud_TILE_MORE_BTN_SVG;
              moreBtn.addEventListener('mousedown', (e) => e.stopPropagation());
              moreBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wrap = (e.currentTarget as HTMLElement).closest('.kloud-tile-more-menu-wrap') as HTMLElement | null;
                const id = wrap?.getAttribute('data-kloud-identity');
                if (wrap && id) {
                  participantRoleMenuBridge.current?.toggleMenu(id, wrap);
                }
              });
              moreWrap.appendChild(moreBtn);
            }
            if (inCarousel) {
              moreWrap.classList.remove('kloud-tile-more-menu-wrap--inline');
              if (moreWrap.parentElement !== tile) {
                tile.appendChild(moreWrap);
              }
            } else {
              moreWrap.classList.add('kloud-tile-more-menu-wrap--inline');
              const camIndicator = itemContainer.querySelector('.kloud-custom-cam-indicator');
              const nameAnchor =
                itemContainer.querySelector('.floating-grid-name') ||
                itemContainer.querySelector('.webcam-sidebar-name') ||
                itemContainer.querySelector('.lk-participant-name');
              if (camIndicator) {
                camIndicator.insertAdjacentElement('afterend', moreWrap);
              } else if (nameAnchor) {
                itemContainer.insertBefore(moreWrap, nameAnchor);
              } else if (moreWrap.parentElement !== itemContainer) {
                itemContainer.appendChild(moreWrap);
              }
            }
          }
          if (moreWrap) {
            moreWrap.setAttribute('data-kloud-identity', identity);
          }
        }
      });
    };

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateCustomMics();
      });
    };

    updateCustomMicsRef.current = updateCustomMics;
    schedule();

    for (const event of TILE_REFRESH_EVENTS) {
      room.on(event, schedule);
    }
    const stopObserve = observeNewParticipantTiles(schedule);

    return () => {
      updateCustomMicsRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      for (const event of TILE_REFRESH_EVENTS) {
        room.off(event, schedule);
      }
      stopObserve();
    };
  }, [
    room,
    muteAllActive,
    hostIdentity,
    cohostIdentities,
    autoPresenterIdentity,
    copresenterIdentities,
    hostMutedIdentities,
    hostDisabledVideoIdentities,
    exemptFromMuteAllIdentities,
    isHost,
    isCohost,
    hasScreenShare,
    isWebcamSidebarCollapsed,
    muteAllActiveRef,
    hostMutedIdentitiesRef,
    hostDisabledVideoIdentitiesRef,
    exemptFromMuteAllIdentitiesRef,
    raisedHandsRef,
    updateCustomMicsRef,
  ]);
}

/** useTileNameSync — 把登录名 / 显示名同步到瓦片占位层，摄像头关闭时显示名字而不是缩写 */
export function useTileNameSync(room: Room): void {
  // Sync login/display names into placeholder so camera-off tiles show the name (not initials)
  React.useEffect(() => {
    const syncNames = () => {
      document.querySelectorAll('.lk-participant-tile').forEach((tile) => {
        const nameEl = tile.querySelector('.lk-participant-name');
        const placeholder = tile.querySelector('.lk-participant-placeholder');
        if (!placeholder) return;

        const identity = tile.getAttribute('data-lk-participant') || '';
        const participant = identity
          ? identity === room.localParticipant.identity
            ? room.localParticipant
            : room.remoteParticipants.get(identity)
          : null;
        const name = (
          participant?.name ||
          participant?.identity ||
          nameEl?.textContent ||
          ''
        ).trim();
        if (!name) return;

        // Same soft tint for this person on every tile (grid, carousel, phone)
        applyTileHue(tile as HTMLElement, name);
        if (placeholder.getAttribute('data-lk-name') !== name) {
          placeholder.setAttribute('data-lk-name', name);
        }
        // Keep initials attribute for leftover consumers; UI uses login name via data-lk-name
        const initials = getInitials(name);
        if (placeholder.getAttribute('data-lk-initials') !== initials) {
          placeholder.setAttribute('data-lk-initials', initials);
        }
        if (nameEl && nameEl.textContent?.trim() !== name) {
          nameEl.textContent = name;
        }
      });
    };
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncNames();
      });
    };

    schedule();
    for (const event of TILE_REFRESH_EVENTS) {
      room.on(event, schedule);
    }
    const stopObserve = observeNewParticipantTiles(schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      for (const event of TILE_REFRESH_EVENTS) {
        room.off(event, schedule);
      }
      stopObserve();
    };
  }, [room]);
}
