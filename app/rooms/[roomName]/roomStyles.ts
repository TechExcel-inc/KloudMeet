import { chatAndAttendeeStyles } from '@/lib/ChatAndAttendeePanel';

/** 有人共享屏幕时的舞台布局（共享画面居中，参会者轮播在左侧） */
export const SCREEN_SHARE_LAYOUT_CSS = `
              /* Clean, Native-Friendly Screenshare Layout Overrides */
              
              /* 1. Reset base containment so we can fill the window safely */
              .sky-meet-video-wrapper .lk-video-conference, 
              .sky-meet-video-wrapper .lk-room-container { padding: 0 !important; }
              .sky-meet-video-wrapper .lk-video-conference-inner { 
                padding: 0 !important; 
                margin: 0 !important; 
                display: flex !important; 
                flex-direction: row-reverse !important; /* Forces Carousel cleanly to the LEFT side natively */
                width: 100% !important;
                height: 100vh !important;
              }
              
              /* 2. Screenshare Wrapper cleanly gets all remaining width */
              .sky-meet-video-wrapper .lk-focus-layout-wrapper,
              .sky-meet-video-wrapper .lk-focus-layout {
                flex: 1 !important; 
                display: flex !important;
                width: 100% !important;
                height: 100% !important;
                min-width: 0 !important; 
                background: var(--km-stage) !important;
                align-items: center !important;
                justify-content: center !important;
              }
              .sky-meet-video-wrapper .lk-focus-layout .lk-participant-tile {
                width: 100% !important;
                height: 100% !important;
                display: flex !important;
              }
              .sky-meet-video-wrapper .lk-focus-layout .lk-participant-tile .lk-video-container {
                width: 100% !important;
                height: 100% !important;
              }
              .sky-meet-video-wrapper .lk-focus-layout .lk-participant-tile video {
                width: 100% !important;
                height: 100% !important;
                object-fit: contain !important;
                pointer-events: none !important; /* CRITICAL: Blocks Firefox/Chrome from spawning native Picture-in-Picture hover overlays! */
              }

              /* 3. Screenshare aside（lk-carousel）与浮窗左侧 3 个大格（hero）同款样式 */
              .sky-meet-video-wrapper .lk-carousel { 
                --screenshare-aside-tile: 132px;
                display: flex !important;
                flex-direction: column !important;
                justify-content: flex-start !important;
                align-items: center !important;
                width: calc(var(--screenshare-aside-tile) + 16px) !important; 
                min-width: calc(var(--screenshare-aside-tile) + 16px) !important; 
                max-width: calc(var(--screenshare-aside-tile) + 16px) !important;
                height: 100% !important;
                margin: 0 !important;
                flex-shrink: 0 !important; 
                background: var(--km-stage) !important;
                gap: 8px !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
                border-right: 1px solid var(--km-stage-border) !important;
                padding: 8px !important;
                box-sizing: border-box !important;
              }
              
              /* This pure CSS toggle prevents the catastrophic Layout Thrashing bug */
              .sky-meet-video-wrapper.sidebar-collapsed .lk-carousel {
                display: none !important;
              }
              .sky-meet-video-wrapper.recorder-bot-view .lk-carousel {
                display: none !important;
              }

              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile {
                position: relative !important;
                display: block !important;
                flex: 0 0 auto !important;
                width: var(--screenshare-aside-tile) !important;
                max-width: var(--screenshare-aside-tile) !important;
                height: auto !important;
                min-height: 0 !important;
                aspect-ratio: 1 / 1 !important;
                border-radius: 12px !important;
                box-shadow: none !important;
                overflow: hidden !important;
                background: var(--km-tile) !important;
                gap: 0 !important;
                padding: 0 !important;
                pointer-events: auto !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-video-container,
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-media-container {
                position: relative !important;
                width: 100% !important;
                height: 100% !important;
                aspect-ratio: 1 / 1 !important;
                border-radius: 12px !important;
                overflow: hidden !important;
                background: var(--km-tile) !important;
                pointer-events: none !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile video {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
                pointer-events: none !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-placeholder {
                background: var(--km-tile) !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile:hover .lk-video-container,
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile:hover .lk-participant-media-container {
                box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.18) !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-metadata {
                position: absolute !important;
                inset: auto auto 4px 4px !important;
                left: 4px !important;
                right: auto !important;
                bottom: 4px !important;
                top: auto !important;
                width: auto !important;
                max-width: calc(100% - 8px) !important;
                justify-content: flex-start !important;
                z-index: 4 !important;
                pointer-events: none !important;
                background: transparent !important;
                padding: 0 !important;
                margin: 0 !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-metadata-item {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                gap: 6px !important;
                max-width: 100% !important;
                min-width: 0 !important;
                padding: 0 !important;
                line-height: 1 !important;
                border-radius: 0 !important;
                background: transparent !important;
                backdrop-filter: none !important;
                pointer-events: none !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-metadata-item .kloud-custom-mic-indicator,
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-metadata-item .kloud-custom-cam-indicator {
                pointer-events: auto !important;
                width: 28px !important;
                height: 28px !important;
                min-width: 28px !important;
                min-height: 28px !important;
              }
              .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile .lk-participant-name {
                display: none !important;
              }
              /* Camera-off carousel: round initials avatar by default, name pill on hover/select (globals.css) */
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-carousel > .lk-participant-tile > button,
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-carousel > .lk-participant-tile .lk-button,
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-carousel > .lk-participant-tile .lk-focus-toggle-button {
                display: none !important;
                pointer-events: none !important;
              }

              /* 4. Hide all redundant LiveKit controls (Maximize, PiP, etc.) from the screenshare tile entirely */
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-focus-layout > .lk-participant-tile button,
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-focus-layout > .lk-participant-tile .lk-button,
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-focus-layout > .lk-participant-tile .lk-focus-toggle-button,
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-focus-layout > .lk-participant-tile [class*="button"],
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-focus-layout > .lk-participant-tile [class*="action"],
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-focus-layout > .lk-participant-tile [class*="lk-pip"],
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-focus-layout > .lk-participant-tile [class*="focus-toggle"],
              .sky-meet-video-wrapper .lk-video-conference[data-kloud-webcam-layout="screenshare"] .lk-focus-layout > .lk-participant-tile [class*="lk-participant-metadata"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
              }

              /* 5. Mobile Responsiveness */
              @media (max-width: 768px) {
                .main-meeting-area {
                  flex-direction: column !important; /* Stack vertically */
                }
                .sky-meet-video-wrapper .lk-video-conference-inner {
                  flex-direction: column !important; /* Stack webcams nicely */
                }
                .sky-meet-video-wrapper .lk-carousel {
                  width: 100% !important;
                  max-width: 100% !important;
                  min-width: 0 !important;
                  height: auto !important;
                  min-height: 0 !important;
                  flex-direction: column !important;
                  flex-wrap: nowrap !important;
                  justify-content: flex-start !important;
                  align-items: center !important;
                  overflow-x: hidden !important;
                  overflow-y: auto !important;
                  -webkit-overflow-scrolling: touch;
                  overscroll-behavior-x: none;
                  touch-action: pan-y;
                  border-right: none !important;
                  border-bottom: 1px solid var(--km-stage-border) !important;
                  padding: 8px !important;
                  gap: 8px !important;
                }
                .sky-meet-video-wrapper .lk-carousel {
                  --screenshare-aside-tile: 100px;
                  width: calc(var(--screenshare-aside-tile) + 16px) !important;
                  max-width: calc(var(--screenshare-aside-tile) + 16px) !important;
                  min-width: calc(var(--screenshare-aside-tile) + 16px) !important;
                }
                .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile {
                  width: var(--screenshare-aside-tile) !important;
                  max-width: var(--screenshare-aside-tile) !important;
                  height: auto !important;
                  aspect-ratio: 1 / 1 !important;
                }
              }

              /* 6. Presenter Sharing: hide webcam sidebar, show floating panel */
              .sky-meet-video-wrapper.presenter-sharing .lk-carousel {
                 display: none !important;
              }
              /* Mirror-block: 隐藏视频区内容但保留布局，LiveDoc 由外层遮罩显示 */
              .sky-meet-video-wrapper.mirror-blocked {
                 visibility: hidden !important;
              }
              /* .screenshare-overlay-badge moved to static block for simpler transitions */

`;

/** Webcam 视图选择 Spotlight 且无人共享时的布局 */
export const WEBCAM_SPOTLIGHT_CSS = `
              /* Webcam Spotlight: reuse focus + carousel layout */
              .sky-meet-video-wrapper.webcam-spotlight .lk-video-conference,
              .sky-meet-video-wrapper.webcam-spotlight .lk-room-container { padding: 0 !important; }
              .sky-meet-video-wrapper.webcam-spotlight .lk-video-conference-inner {
                padding: 0 !important;
                margin: 0 !important;
                display: flex !important;
                flex-direction: row-reverse !important;
                width: 100% !important;
                height: 100% !important;
                min-height: 0 !important;
              }
              .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout-wrapper,
              .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout {
                flex: 1 !important;
                display: flex !important;
                width: 100% !important;
                height: 100% !important;
                min-width: 0 !important;
                background: var(--km-stage) !important;
                align-items: center !important;
                justify-content: center !important;
              }
              .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout {
                padding: 16px 16px 16px 8px !important;
              }
              .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout .lk-participant-tile {
                width: 100% !important;
                height: 100% !important;
                border-radius: 16px !important;
                --lk-border-radius: 16px;
              }
              .sky-meet-video-wrapper.webcam-spotlight .lk-carousel {
                --spotlight-aside-tile: 120px;
                width: calc(var(--spotlight-aside-tile) + 24px) !important;
                min-width: calc(var(--spotlight-aside-tile) + 24px) !important;
                max-width: calc(var(--spotlight-aside-tile) + 24px) !important;
                height: 100% !important;
                overflow-y: auto !important;
                padding: 16px 8px 16px 16px !important;
                gap: 8px !important;
                box-sizing: border-box !important;
                border-right: none !important;
                background: var(--km-stage) !important;
              }
              .sky-meet-video-wrapper.webcam-spotlight .lk-carousel > .lk-participant-tile {
                width: var(--spotlight-aside-tile) !important;
                max-width: var(--spotlight-aside-tile) !important;
                height: auto !important;
                aspect-ratio: 1 / 1 !important;
              }
              .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout > .lk-participant-tile .lk-focus-toggle-button,
              .sky-meet-video-wrapper.webcam-spotlight .lk-carousel > .lk-participant-tile .lk-focus-toggle-button {
                display: none !important;
              }
`;

/** 会议舞台常驻样式：参会者瓦片、工具栏浮层、聊天与参会者面板、移动端布局 */
export const ROOM_STAGE_CSS = `

            /* ═══ Always-available styles (floating panel, chat overlay) ═══ */

            /* Screenshare Overlays */
            .screenshare-overlay-container {
               position: absolute;
               bottom: 80px; /* Above toolbar */
               left: 20px;
               width: auto;
               pointer-events: none;
               display: flex;
               justify-content: flex-start;
               align-items: flex-end;
               z-index: 100;
            }
            .screenshare-overlay-badge {
               pointer-events: auto;
               background: rgba(15, 23, 42, 0.4);
               color: rgba(255, 255, 255, 0.7);
               padding: 6px;
               border-radius: 8px;
               font-size: 13px;
               font-weight: 500;
               backdrop-filter: blur(12px);
               border: 1px solid rgba(255,255,255,0.08);
               box-shadow: 0 2px 8px rgba(0,0,0,0.2);
               transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
               display: flex;
               align-items: center;
               gap: 0;
               cursor: default;
               max-width: 32px;
               overflow: hidden;
               white-space: nowrap;
            }
            .screenshare-overlay-badge svg {
               flex-shrink: 0;
               width: 18px;
               height: 18px;
               opacity: 0.8;
               margin: 0 1px;
               transition: all 0.3s ease;
            }
            .screenshare-overlay-badge .badge-text {
               opacity: 0;
               width: 0;
               overflow: hidden;
               transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .screenshare-overlay-container:hover .screenshare-overlay-badge,
            .screenshare-overlay-badge:hover,
            .screenshare-overlay-badge:active {
               background: rgba(15, 23, 42, 0.85);
               color: #fff;
               padding: 6px 14px;
               max-width: 300px;
               gap: 8px;
               border-color: rgba(255,255,255,0.15);
               box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            }
            .screenshare-overlay-badge:hover svg,
            .screenshare-overlay-badge:active svg {
               opacity: 1;
               margin: 0;
            }
            .screenshare-overlay-badge:hover .badge-text,
            .screenshare-overlay-badge:active .badge-text {
               opacity: 1;
               width: auto;
            }
            @media (max-width: 768px) {
               .screenshare-overlay-container { bottom: auto; top: 72px; left: 10px; }
               .sky-meet-video-wrapper.hide-mirror-video { width: 100% !important; min-width: 0 !important; flex: 0 0 120px !important; }
            }

            .floating-webcam-panel {
               background: rgba(32, 33, 38, 0.96);
               backdrop-filter: blur(16px);
               border: 1px solid rgba(255,255,255,0.1);
               border-radius: 999px;
               padding: 5px 6px 5px 8px;
               box-shadow: 0 12px 32px rgba(0,0,0,0.5);
               color: var(--km-stage-text);
               font-family: var(--km-font);
               touch-action: none;
               -webkit-user-select: none;
               opacity: 1;
               pointer-events: auto;
               transition: opacity 0.35s ease;
            }
            .floating-webcam-panel.expanded {
               border-radius: 16px;
               padding: 8px 10px 10px;
               width: fit-content;
               max-width: min(420px, calc(100vw - 24px));
               min-width: 0;
               box-sizing: border-box;
               overflow: visible;
            }
            @media (max-width: 768px) {
               .floating-webcam-panel.expanded {
                  max-width: min(280px, calc(100vw - 24px));
                  /* 头栏≈36 + 面板/网格 padding≈36 + 3×hero(168×9/16) + 2×gap(8)，保证左侧三大格完整可视 */
                  max-height: calc(36px + 36px + 3 * 168px * 9 / 16 + 2 * 8px);
                  overflow: auto;
               }
            }
            .floating-collapsed-row {
               display: flex;
               align-items: center;
               gap: 6px;
            }
            .floating-stacked-avatars {
               display: flex;
               align-items: center;
            }
            .floating-collapsed-cam {
               display: inline-flex;
               align-items: center;
               justify-content: center;
               width: 22px;
               height: 22px;
               margin: 0 2px 0 4px;
               color: #bdc1c6;
               flex-shrink: 0;
            }
            .floating-collapsed-cam svg {
               width: 18px;
               height: 18px;
            }
            .floating-stacked-avatars .floating-avatar,
            .floating-stacked-avatars .floating-avatar-shell {
               margin-left: -8px;
               transition: transform 0.15s ease;
            }
            .floating-stacked-avatars .floating-avatar:first-child,
            .floating-stacked-avatars .floating-avatar-shell:first-child {
               margin-left: 0;
            }
            .floating-stacked-avatars .floating-avatar:hover,
            .floating-stacked-avatars .floating-avatar-shell:hover {
               transform: scale(1.15);
            }
            .floating-stacked-avatars .floating-avatar:not(.overflow-badge),
            .floating-stacked-avatars .floating-avatar-shell {
               cursor: pointer;
            }
            .floating-stacked-avatars .floating-avatar.selected,
            .floating-stacked-avatars .floating-avatar-shell.selected .floating-avatar {
               border-color: var(--km-on-dark-accent);
               box-shadow: 0 0 0 2px rgba(201, 200, 255, 0.45);
            }
            /* Collapsed pill: per-position tint so overlapping avatars read as separate people */
            .floating-stacked-avatars > :nth-child(5n+2) .floating-avatar,
            .floating-stacked-avatars > .floating-avatar:nth-child(5n+2):not(.overflow-badge) { background: #ffd0b0; color: #7a3e0a; }
            .floating-stacked-avatars > :nth-child(5n+3) .floating-avatar,
            .floating-stacked-avatars > .floating-avatar:nth-child(5n+3):not(.overflow-badge) { background: #bfe0ff; color: #0b4a75; }
            .floating-stacked-avatars > :nth-child(5n+4) .floating-avatar,
            .floating-stacked-avatars > .floating-avatar:nth-child(5n+4):not(.overflow-badge) { background: #bdebd3; color: #135b33; }
            .floating-stacked-avatars > :nth-child(5n+5) .floating-avatar,
            .floating-stacked-avatars > .floating-avatar:nth-child(5n+5):not(.overflow-badge) { background: #ffd0df; color: #7d1c45; }
            .floating-collapsed-count {
               padding: 0 2px 0 4px;
               color: #bdc1c6;
               font-size: 12px;
               font-weight: 700;
               font-variant-numeric: tabular-nums;
               white-space: nowrap;
            }
            .floating-webcam-panel:not(.expanded):has(.floating-collapsed-preview) {
               border-radius: 16px;
            }
            .floating-collapsed-preview {
               margin-top: 6px;
               padding-top: 6px;
               border-top: 1px solid rgba(255,255,255,0.08);
               width: var(--floating-hero-col-w, 168px);
               cursor: default;
            }
            .floating-webcam-panel:not(.expanded):has(.floating-collapsed-preview) {
               padding-bottom: 8px;
            }
            .floating-avatar-shell.lk-participant-tile {
               width: 30px;
               height: 30px;
               flex-shrink: 0;
               border-radius: 50%;
               --lk-border-radius: 50%;
               padding: 0 !important;
               display: flex !important;
               align-items: center;
               justify-content: center;
               gap: 0 !important;
               flex-direction: row !important;
            }
            /* 折叠头像说话边框：浅紫环（与 tile 说话描边同色系） */
            .floating-avatar-shell.lk-participant-tile[data-lk-speaking="true"]:not([data-lk-source="screen_share"])::after {
               border-color: var(--km-speaking);
            }
            .floating-avatar-shell .floating-avatar {
               border: none !important;
               width: 100%;
               height: 100%;
            }
            .floating-avatar {
               width: 30px;
               height: 30px;
               border-radius: 50%;
               background: #3b3a63;
               color: var(--km-on-dark-accent);
               font-size: 11px;
               font-weight: 800;
               display: flex;
               align-items: center;
               justify-content: center;
               border: 2px solid var(--km-panel);
               flex-shrink: 0;
               position: relative;
            }
            .floating-avatar.overflow-badge {
               background: var(--km-control);
               font-size: 10px;
               color: #bdc1c6;
               border-color: var(--km-panel);
            }
            .floating-stacked-avatars .floating-share-avatar {
               margin-left: -8px;
               width: 30px;
               height: 30px;
               border-radius: 50%;
               overflow: hidden;
               flex-shrink: 0;
               background: #0b0c0e;
               border: 2px solid var(--km-panel);
               box-sizing: border-box;
               cursor: pointer;
            }
            .floating-stacked-avatars .floating-share-avatar:hover {
               transform: scale(1.15);
            }
            .floating-stacked-avatars .floating-share-avatar.selected {
               border-color: var(--km-on-dark-accent);
               box-shadow: 0 0 0 2px rgba(201, 200, 255, 0.45);
            }
            .floating-stacked-avatars .floating-share-avatar div,
            .floating-stacked-avatars .floating-share-avatar video {
               width: 100%;
               height: 100%;
            }
            .floating-stacked-avatars .floating-share-avatar video {
               object-fit: cover;
               display: block;
            }
            .floating-collapsed-preview--share {
               aspect-ratio: 1 / 1;
               border-radius: 12px;
               overflow: hidden;
               background: #0b0c0e;
            }
            .floating-collapsed-preview--share div,
            .floating-collapsed-preview--share video {
               width: 100%;
               height: 100%;
            }
            .floating-collapsed-preview--share video {
               object-fit: cover;
               display: block;
            }
            .floating-chevron-btn {
               background: rgba(255,255,255,0.08);
               border: none;
               color: var(--km-stage-text);
               width: 28px;
               height: 28px;
               border-radius: 50%;
               cursor: pointer;
               display: flex;
               align-items: center;
               justify-content: center;
               transition: all 0.15s ease;
               flex-shrink: 0;
            }
            .floating-chevron-btn:hover {
               background: rgba(255,255,255,0.16);
               color: #fff;
            }
            .floating-chevron-btn:focus-visible,
            .webcam-collapse-toggle:focus-visible,
            .webcam-sidebar-icon-btn:focus-visible,
            .chat-overlay-close:focus-visible {
               outline: 2px solid var(--km-on-dark-accent);
               outline-offset: 2px;
            }
            .floating-expanded-header {
               display: flex;
               align-items: center;
               justify-content: space-between;
               margin-bottom: 8px;
            }
            .floating-expanded-title {
               padding-left: 2px;
               color: #bdc1c6;
               font-size: 12px;
               font-weight: 700;
            }
            .floating-expanded-grid-wrap {
               margin-top: 2px;
               width: fit-content;
               max-width: 100%;
            }
            .floating-expanded-grid {
               display: flex;
               flex-direction: row;
               align-items: stretch;
               width: fit-content;
               max-width: 100%;
               gap: 8px;
               background: transparent;
               border-radius: 12px;
               padding: 0;
               border: none;
               overflow: visible;
               --floating-hero-col-w: 168px;
               --floating-rest-tile: calc(var(--floating-hero-col-w) / 3 + 10px);
            }
            .floating-expanded-grid:has(.floating-compact-slot:hover) {
               align-items: flex-start;
            }
            .floating-expanded-grid--heroes-only {
               gap: 0;
            }
            .floating-webcam-panel.expanded:has(.floating-expanded-grid--heroes-only) {
               min-width: 188px;
               max-width: 188px;
            }
            .floating-expanded-hero-column {
               display: flex;
               flex-direction: column;
               justify-content: center;
               gap: 8px;
               width: var(--floating-hero-col-w, 168px);
               flex-shrink: 0;
               align-self: stretch;
               min-height: 0;
            }
            .floating-expanded-rest-wrap {
               flex: 0 0 auto;
               width: fit-content;
               min-width: calc(var(--floating-rest-tile) * var(--floating-rest-visible-cols, 1) + 8px * (var(--floating-rest-visible-cols, 1) - 1));
               max-width: calc(var(--floating-rest-tile) * 3 + 16px);
               display: flex;
               flex-direction: column;
               position: relative;
               z-index: 2;
               box-sizing: border-box;
               min-height: 0;
               align-self: stretch;
               overflow: visible;
               transition: min-width 0.22s cubic-bezier(0.22, 1, 0.36, 1), max-width 0.22s cubic-bezier(0.22, 1, 0.36, 1);
            }
            .floating-expanded-rest-wrap:has(.floating-compact-slot:hover) {
               max-width: calc(var(--floating-rest-tile) * 3 + 16px + var(--floating-rest-tile));
            }
            .floating-expanded-rest-scroll {
               flex: 1 1 auto;
               min-height: 0;
               display: flex;
               flex-direction: row;
               flex-wrap: nowrap;
               align-items: stretch;
               gap: 8px;
               overflow-x: auto;
               overflow-y: visible;
               scrollbar-width: thin;
               -webkit-overflow-scrolling: touch;
               width: fit-content;
            }
            .floating-expanded-rest-col {
               display: flex;
               flex-direction: column;
               justify-content: center;
               gap: 6px;
               flex: 0 0 var(--floating-rest-tile);
               width: var(--floating-rest-tile);
               min-width: 0;
               min-height: 0;
               align-self: stretch;
               overflow: visible;
               transition: width 0.22s cubic-bezier(0.22, 1, 0.36, 1), flex-basis 0.22s cubic-bezier(0.22, 1, 0.36, 1);
            }
            .floating-expanded-rest-col:has(.floating-compact-slot:hover) {
               flex: 0 0 calc(var(--floating-rest-tile) * 2);
               width: calc(var(--floating-rest-tile) * 2);
            }
            /* 右侧小格：悬停时槽位真实宽高 2 倍，撑开列 / 浮窗外层容器 */
            .floating-expanded-rest-scroll .floating-compact-slot {
              position: relative;
              width: var(--floating-rest-tile);
              height: calc(var(--floating-rest-tile) * 9 / 16);
              flex-shrink: 0;
              z-index: 1;
              transition: width 0.22s cubic-bezier(0.22, 1, 0.36, 1), height 0.22s cubic-bezier(0.22, 1, 0.36, 1), z-index 0s linear 0.22s;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover {
              width: calc(var(--floating-rest-tile) * 2);
              height: calc(var(--floating-rest-tile) * 2 * 9 / 16);
              z-index: 30;
              transition: width 0.22s cubic-bezier(0.22, 1, 0.36, 1), height 0.22s cubic-bezier(0.22, 1, 0.36, 1), z-index 0s;
            }
            .floating-expanded-rest-scroll .floating-compact-slot .floating-grid-tile--compact {
              width: 100%;
              height: 100%;
              position: relative;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .floating-grid-tile--compact .floating-grid-avatar {
              font-size: calc(var(--floating-rest-tile) * 0.68);
            }
            .floating-expanded-rest-hnav {
               display: flex;
               flex-direction: row;
               justify-content: flex-end;
               align-items: center;
               gap: 8px;
               flex-shrink: 0;
               padding-top: 6px;
               min-height: 30px;
            }
            .floating-expanded-rest-hnav-btn {
               display: inline-flex;
               align-items: center;
               justify-content: center;
               width: 34px;
               height: 28px;
               border-radius: 999px;
               border: 1px solid rgba(255,255,255,0.12);
               background: rgba(255,255,255,0.06);
               color: var(--km-stage-text);
               cursor: pointer;
               transition: background 0.15s ease, opacity 0.15s ease;
            }
            .floating-expanded-rest-hnav-btn:hover:not(:disabled) {
               background: rgba(255,255,255,0.14);
            }
            .floating-expanded-rest-hnav-btn:disabled {
               opacity: 0.3;
               cursor: default;
            }
            .floating-expanded-rest-hnav-btn--primary:not(:disabled) {
               border-color: rgba(201, 200, 255, 0.45);
               color: var(--km-on-dark-accent);
            }
            /* Same 16:9 as the stage's video tiles */
            .floating-grid-tile--hero .floating-grid-video {
               width: 100%;
               height: auto;
               aspect-ratio: 16 / 9;
               border-radius: 10px;
            }
            .floating-grid-tile--hero .floating-grid-avatar {
               font-size: 22px;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .floating-grid-video,
            .floating-expanded-rest-scroll .floating-compact-slot .floating-grid-video {
               width: 100%;
               height: 100%;
               aspect-ratio: auto;
               min-height: 0;
               min-width: 0;
               border-radius: 8px;
               transition: border-radius 0.22s ease;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .floating-grid-video {
               border-radius: 12px;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .floating-grid-avatar {
               font-size: calc(var(--floating-rest-tile) * 0.34);
            }
            .floating-grid-tile--hero .floating-grid-name {
               font-size: 10px;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .floating-grid-name {
               font-size: 9px;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .floating-grid-name-row {
               padding: 2px 5px;
               gap: 0.75rem;
               background: transparent;
               backdrop-filter: none;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .floating-grid-tile--compact .floating-grid-name-row {
               background: transparent;
               backdrop-filter: none;
            }
            /*
             * 浮窗 mic/cam：
             * - 大画面（hero）：始终显示
             * - 右侧小头像（compact）：默认隐藏，悬停放大时再显示
             */
            .floating-webcam-panel .floating-grid-tile--hero .kloud-custom-mic-indicator,
            .floating-webcam-panel .floating-grid-tile--hero .kloud-custom-cam-indicator {
              opacity: 1 !important;
              width: 20px !important;
              min-width: 20px !important;
              height: 20px !important;
              min-height: 20px !important;
              padding: 3px !important;
              overflow: visible;
              pointer-events: auto;
            }
            .floating-webcam-panel .floating-grid-tile--compact .kloud-custom-mic-indicator,
            .floating-webcam-panel .floating-grid-tile--compact .kloud-custom-cam-indicator,
            .floating-webcam-panel .floating-compact-slot .kloud-custom-mic-indicator,
            .floating-webcam-panel .floating-compact-slot .kloud-custom-cam-indicator {
              opacity: 0;
              width: 0 !important;
              min-width: 0 !important;
              height: 0 !important;
              min-height: 0 !important;
              padding: 0 !important;
              margin: 0 !important;
              overflow: hidden;
              pointer-events: none;
              transition: opacity 0.18s ease, width 0.18s ease, min-width 0.18s ease, height 0.18s ease;
            }
            .floating-webcam-panel .floating-compact-slot:hover .kloud-custom-mic-indicator,
            .floating-webcam-panel .floating-compact-slot:hover .kloud-custom-cam-indicator,
            .floating-webcam-panel .floating-grid-tile--compact:hover .kloud-custom-mic-indicator,
            .floating-webcam-panel .floating-grid-tile--compact:hover .kloud-custom-cam-indicator {
              opacity: 1;
              width: 20px !important;
              min-width: 20px !important;
              height: 20px !important;
              min-height: 20px !important;
              padding: 3px !important;
              overflow: visible;
              pointer-events: auto;
            }
            .floating-grid-tile {
               display: block;
               position: relative;
            }
            .floating-grid-tile.lk-participant-tile {
               gap: 0 !important;
               flex-direction: row !important;
               align-items: stretch !important;
               background: transparent !important;
            }
            .floating-grid-video {
               width: 64px;
               height: 64px;
               border-radius: 10px;
               overflow: hidden;
               background: var(--km-tile);
               position: relative;
               display: block;
            }
            .floating-webcam-panel .webcam-floating-participant-metadata {
               position: absolute !important;
               inset: auto auto 4px 4px !important;
               left: 4px !important;
               right: auto !important;
               bottom: 4px !important;
               top: auto !important;
               width: auto !important;
               max-width: calc(100% - 8px);
               justify-content: flex-start !important;
               z-index: 4;
               pointer-events: none;
            }
            .floating-webcam-panel .floating-grid-name-row {
               pointer-events: none;
            }
            .floating-webcam-panel .kloud-custom-mic-indicator {
               pointer-events: auto;
            }
            .floating-webcam-panel .kloud-custom-cam-indicator {
               pointer-events: auto;
            }
            .floating-webcam-panel .kloud-custom-mic-indicator,
            .floating-webcam-panel .kloud-custom-cam-indicator {
               margin: 0 !important;
            }
            /* 活文档浮窗：mic / cam / ⋯ 统一 chip 尺寸，避免一大一小 */
            .floating-webcam-panel .kloud-custom-mic-indicator,
            .floating-webcam-panel .kloud-custom-cam-indicator,
            .floating-webcam-panel .kloud-custom-mic-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"],
            .floating-webcam-panel .kloud-custom-mic-indicator.kloud-custom-mic--force-muted,
            .floating-webcam-panel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled {
              width: 20px !important;
              min-width: 20px !important;
              height: 20px !important;
              min-height: 20px !important;
              padding: 3px !important;
              margin: 0 !important;
              box-sizing: border-box !important;
              border-radius: 50% !important;
            }
            .floating-webcam-panel .kloud-custom-mic-indicator svg,
            .floating-webcam-panel .kloud-custom-cam-indicator svg {
              width: 14px !important;
              height: 14px !important;
              max-width: 14px !important;
              max-height: 14px !important;
            }
            .floating-webcam-panel .kloud-tile-more-menu-wrap .kloud-role-icon-btn {
              width: 20px !important;
              height: 20px !important;
              min-width: 20px !important;
              min-height: 20px !important;
              padding: 0 !important;
              box-sizing: border-box !important;
            }
            .floating-webcam-panel .kloud-tile-more-menu-wrap .kloud-role-icon-btn svg {
              width: 14px !important;
              height: 14px !important;
            }
            .floating-grid-name-row {
               display: inline-flex;
               align-items: center;
               justify-content: flex-start;
               gap: 1.25rem;
               max-width: 100%;
               min-width: 0;
               padding: 0;
               line-height: 1;
               border-radius: 0;
               background: transparent;
               backdrop-filter: none;
            }
            .floating-grid-name-row .lk-track-muted-indicator-microphone {
               flex-shrink: 0;
               width: 0.75rem;
               height: 0.75rem;
            }
            .floating-grid-video video {
               width: 100%;
               height: 100%;
               object-fit: cover;
            }
            /* Camera off: the stage tile's look — this person's soft tint (--km-tile-hue) */
            .floating-grid-avatar {
               width: 100%;
               height: 100%;
               background-color: hsl(var(--km-tile-hue, 230) 12% 19%);
               background-image: radial-gradient(
                 120% 110% at 50% 0%,
                 hsl(var(--km-tile-hue, 230) 24% 27%) 0%,
                 hsl(var(--km-tile-hue, 230) 14% 21%) 55%,
                 hsl(var(--km-tile-hue, 230) 10% 17%) 100%
               );
               color: rgba(255, 255, 255, 0.96);
               font-size: 16px;
               font-weight: 500;
               display: flex;
               align-items: center;
               justify-content: center;
               container-type: size;
            }
            .floating-grid-avatar-initials,
            .floating-grid-avatar-fullname {
               max-width: 100%;
               padding: 0 6px;
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
               text-align: center;
            }
            .floating-grid-avatar-fullname {
               display: none;
               font-size: 14px;
               font-weight: 600;
               line-height: 1.2;
               color: var(--km-stage-text);
            }
            /* Camera off: the initials alone, large and white, as on the stage (no disc) */
            .floating-grid-avatar-initials {
               display: block;
               padding: 0;
               color: rgba(255, 255, 255, 0.96);
               font-size: clamp(11px, 34cqh, 30px);
               font-weight: 500;
               letter-spacing: 0.08em;
               line-height: 1;
               text-transform: uppercase;
               transform: translateY(-8%);
            }
            /* Small tiles have no name label, so hovering swaps the initials for the name.
               Large tiles always show the name bottom-left and keep the initials. */
            .floating-grid-tile--compact.lk-participant-tile:hover .floating-grid-avatar-initials,
            .floating-grid-tile--compact.lk-participant-tile:focus-within .floating-grid-avatar-initials {
               display: none;
            }
            .floating-grid-tile--compact.lk-participant-tile:hover .floating-grid-avatar-fullname,
            .floating-grid-tile--compact.lk-participant-tile:focus-within .floating-grid-avatar-fullname {
               display: block;
            }
            /* Large tiles: the name beside the mic, always (over video too) */
            .floating-grid-label {
               min-width: 0;
               max-width: calc(var(--floating-hero-col-w, 168px) - 64px);
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
               color: rgba(255, 255, 255, 0.92);
               font-size: 11px;
               font-weight: 500;
               line-height: 20px;
               text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
            }
            .floating-grid-tile--hero .floating-grid-name-row {
               gap: 4px;
            }
            .floating-grid-tile--hero .floating-grid-avatar-fullname {
               font-size: 14px;
            }
            .floating-expanded-rest-scroll .floating-grid-tile--compact .floating-grid-avatar-fullname {
               font-size: calc(var(--floating-rest-tile) * 0.18);
            }
            /* Hover / speaking outlines sit on a layer above the video or initials (an inset
               shadow on the box itself is hidden under the content that fills it) */
            .floating-grid-video::after {
               content: '';
               position: absolute;
               inset: 0;
               z-index: 3;
               border-radius: inherit;
               pointer-events: none;
               box-shadow: inset 0 0 0 2px transparent;
               transition: box-shadow 0.35s ease;
            }
            .floating-grid-tile.lk-participant-tile:hover .floating-grid-video::after {
               box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.18);
            }
            /* Floating tiles: speaking outline drawn on the media box (tile itself is transparent) */
            .floating-webcam-panel .floating-grid-tile.lk-participant-tile::after {
               display: none;
            }
            .floating-webcam-panel .floating-grid-tile[data-lk-speaking="true"] .floating-grid-video::after {
               box-shadow: inset 0 0 0 2px var(--km-speaking), inset 0 0 18px rgba(34, 197, 94, 0.18);
            }
            .floating-webcam-panel .floating-grid-name {
               display: none !important;
            }
            .floating-grid-name {
               color: rgba(255,255,255,0.92);
               font-size: 9px;
               font-weight: 500;
               min-width: 0;
               max-width: 0;
               opacity: 0;
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
               text-align: left;
               transition: max-width 0.18s ease, opacity 0.18s ease;
            }
            .floating-grid-tile.lk-participant-tile:hover .floating-grid-name {
               opacity: 1;
               max-width: 72px;
            }
            .floating-grid-tile.lk-participant-tile.floating-grid-tile--hero:hover .floating-grid-name {
               max-width: 120px;
            }
            .floating-expanded-rest-scroll .floating-compact-slot:hover .floating-grid-name {
               max-width: calc(var(--floating-rest-tile) * 2 - 8px);
            }

            /* ── Webcam sidebar (LiveDoc + postMessage) — docked on the LEFT of the document ─── */
            .webcam-sidebar-panel {
               order: -1;
               width: 176px;
               flex-shrink: 0;
               background: var(--km-stage);
               border-right: 1px solid var(--km-stage-border);
               display: flex;
               flex-direction: column;
               overflow-y: auto;
               overflow-x: hidden;
               color: var(--km-stage-text);
               font-family: var(--km-font);
               scrollbar-width: thin;
               scrollbar-color: rgba(255,255,255,0.18) transparent;
            }
            .webcam-sidebar-tiles {
               display: flex;
               flex-direction: column;
               gap: 8px;
               padding: 8px 8px 16px 16px;
            }
            .webcam-sidebar-tile {
               border-radius: 12px;
               overflow: hidden;
               background: var(--km-tile);
               animation: km-tile-in 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
            }
            .webcam-sidebar-tile.lk-participant-tile {
               gap: 0 !important;
               flex-direction: column !important;
            }
            /* Mic / cam / ⋯ float as round badges in the top-right corner of the tile */
            .webcam-sidebar-panel .webcam-sidebar-participant-metadata {
               position: absolute !important;
               inset: 8px 8px auto auto !important;
               left: auto !important;
               right: 8px !important;
               bottom: auto !important;
               top: 8px !important;
               width: auto;
               flex-direction: row;
               align-items: center;
               justify-content: flex-end;
               gap: 0;
               z-index: 4;
               pointer-events: none;
            }
            .webcam-sidebar-panel .webcam-sidebar-participant-metadata .webcam-sidebar-meta {
               width: auto;
               gap: 4px !important;
               flex-direction: row-reverse;
            }
            .webcam-sidebar-panel .webcam-sidebar-participant-metadata .webcam-sidebar-meta > * {
               pointer-events: auto;
            }
            .webcam-sidebar-tile-name {
               position: absolute;
               left: 10px;
               right: 10px;
               bottom: 8px;
               z-index: 3;
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
               color: #fff;
               font-size: 13px;
               font-weight: 600;
               line-height: 1.2;
               text-shadow: 0 1px 3px rgba(0,0,0,0.6);
               pointer-events: none;
            }
            .webcam-sidebar-meta.lk-participant-metadata-item {
               min-width: 0;
               flex-wrap: nowrap;
            }
            .webcam-sidebar-meta .lk-track-muted-indicator-microphone {
               flex-shrink: 0;
            }
            .webcam-sidebar-video {
               width: 100%;
               aspect-ratio: 4 / 3;
               position: relative;
               background: var(--km-tile);
            }
            .webcam-sidebar-video video {
               width: 100%;
               height: 100%;
               object-fit: cover;
            }
            .webcam-sidebar-avatar {
               width: 100%;
               height: 100%;
               background: var(--km-tile);
               color: var(--km-on-dark-accent);
               font-size: 22px;
               font-weight: 700;
               display: flex;
               align-items: center;
               justify-content: center;
               padding: 0 8px;
               box-sizing: border-box;
               overflow: hidden;
               text-align: center;
            }
            .webcam-sidebar-avatar-initials,
            .webcam-sidebar-avatar-fullname {
               max-width: 100%;
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
            }
            .webcam-sidebar-avatar-fullname {
               display: none;
               font-size: 14px;
               font-weight: 600;
               color: var(--km-stage-text);
            }
            .webcam-sidebar-avatar-initials {
               display: flex;
               align-items: center;
               justify-content: center;
               width: 56px;
               height: 56px;
               flex: none;
               border-radius: 50%;
               background: rgba(139, 135, 255, 0.22);
               color: var(--km-on-dark-accent);
               text-transform: uppercase;
            }
            .webcam-sidebar-tile[data-lk-speaking="true"] .webcam-sidebar-avatar-initials {
               box-shadow: 0 0 0 0 rgba(139, 135, 255, 0.55);
               animation: km-sidebar-voice 1.4s ease-out infinite;
            }
            @keyframes km-sidebar-voice {
               0% { box-shadow: 0 0 0 0 rgba(139, 135, 255, 0.55); }
               100% { box-shadow: 0 0 0 14px rgba(139, 135, 255, 0); }
            }
            .webcam-sidebar-tile:hover .webcam-sidebar-avatar-initials,
            .webcam-sidebar-tile:focus-within .webcam-sidebar-avatar-initials {
               display: none;
            }
            .webcam-sidebar-tile:hover .webcam-sidebar-avatar-fullname,
            .webcam-sidebar-tile:focus-within .webcam-sidebar-avatar-fullname {
               display: block;
            }
            .webcam-sidebar-meta {
               display: flex;
               align-items: center;
               gap: 1.25rem;
               padding: 0;
               background: transparent;
               color: rgba(255,255,255,0.8);
               font-size: 11px;
               font-weight: 500;
            }
            .webcam-sidebar-panel .webcam-sidebar-meta .kloud-custom-mic-indicator,
            .webcam-sidebar-panel .webcam-sidebar-meta .kloud-custom-cam-indicator {
               pointer-events: auto;
               flex-shrink: 0;
            }
            .webcam-sidebar-name {
               overflow: hidden;
               text-overflow: ellipsis;
               white-space: nowrap;
            }
            .webcam-sidebar-header {
               display: flex;
               align-items: center;
               justify-content: space-between;
               padding: 12px 8px 4px 16px;
               flex-shrink: 0;
            }
            .webcam-sidebar-icon-btn {
               background: none;
               border: none;
               color: #bdc1c6;
               cursor: pointer;
               padding: 7px;
               border-radius: 50%;
               display: flex;
               align-items: center;
               justify-content: center;
               transition: background 0.15s, color 0.15s;
            }
            .webcam-sidebar-icon-btn:hover {
               background: rgba(255,255,255,0.08);
               color: #fff;
            }
            .webcam-sidebar-dropdown {
               position: absolute;
               top: 100%;
               left: 0;
               margin-top: 4px;
               background: var(--km-menu);
               border: none;
               border-radius: 12px;
               padding: 8px 0;
               min-width: 160px;
               box-shadow: 0 8px 28px rgba(0,0,0,0.35);
               z-index: 100;
            }
            .webcam-sidebar-dropdown-item {
               display: flex;
               align-items: center;
               gap: 12px;
               width: 100%;
               min-height: 40px;
               background: none;
               border: none;
               color: var(--km-stage-text);
               font-family: var(--km-font);
               font-size: 14px;
               font-weight: 500;
               padding: 0 16px;
               border-radius: 0;
               cursor: pointer;
               transition: background 0.15s;
            }
            .webcam-sidebar-dropdown-item:hover {
               background: rgba(255,255,255,0.08);
               color: #fff;
            }
            .webcam-sidebar-dropdown-item.active {
               background: rgba(139, 135, 255, 0.2);
               color: var(--km-on-dark-accent);
            }
            .webcam-sidebar-icon-btn.file-btn {
               background: rgba(139, 135, 255, 0.2);
               color: var(--km-on-dark-accent);
            }
            .webcam-sidebar-icon-btn.file-btn:hover {
               background: rgba(139, 135, 255, 0.3);
               color: #fff;
            }

            /* 8. Chat / People overlay panel (phone) — dark docked panel, Meet-style header */
            .chat-overlay-panel {
               position: absolute;
               bottom: 70px;
               right: 16px;
               width: 360px;
               height: 420px;
               background: var(--km-panel);
               color: var(--km-stage-text);
               font-family: var(--km-font);
               border: 1px solid rgba(255,255,255,0.06);
               border-radius: 16px;
               box-shadow: 0 12px 40px rgba(0,0,0,0.5);
               z-index: 300;
               display: flex;
               flex-direction: column;
               overflow: hidden;
               animation: km-panel-in 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) both;
            }
            @keyframes km-panel-in {
               from { opacity: 0; transform: translateY(8px); }
               to { opacity: 1; transform: none; }
            }
            .chat-overlay-header {
               display: flex;
               align-items: center;
               justify-content: space-between;
               padding: 12px 8px 6px 20px;
               color: var(--km-stage-text);
               font-size: 18px;
               font-weight: 600;
            }
            .chat-overlay-close {
               background: transparent;
               border: none;
               color: #bdc1c6;
               width: 40px;
               height: 40px;
               border-radius: 50%;
               cursor: pointer;
               font-size: 16px;
               display: flex;
               align-items: center;
               justify-content: center;
               transition: background 0.15s ease, color 0.15s ease;
            }
            .chat-overlay-close:hover {
               background: rgba(255,255,255,0.08);
               color: #fff;
            }
            .chat-overlay-body {
               flex: 1;
               overflow: hidden;
               display: flex;
               flex-direction: column;
            }
            .chat-overlay-body .lk-chat {
               height: 100% !important;
               background: transparent !important;
               border: none !important;
            }
            .chat-overlay-body .lk-chat-messages {
               flex: 1;
               overflow-y: auto;
               padding: 8px;
            }
            .chat-overlay-body .lk-chat-form {
               padding: 8px;
               border-top: 1px solid rgba(255,255,255,0.08);
            }
            .chat-overlay-body .lk-chat-form input {
               background: rgba(255,255,255,0.08) !important;
               border: 1px solid rgba(255,255,255,0.12) !important;
               color: #fff !important;
               border-radius: 8px !important;
            }
            @media (max-width: 768px) {
               .chat-overlay-panel {
                  width: calc(100% - 32px);
                  left: 16px;
                  right: 16px;
                  height: 50vh;
                  bottom: calc(var(--kloud-mobile-toolbar-height, 68px) + 8px);
               }
            }

            ${chatAndAttendeeStyles}

            /* Participant tile ⋯ 角色菜单（hover 显示） */
            .kloud-tile-more-menu-wrap {
              position: absolute;
              top: 4px;
              right: 4px;
              z-index: 6;
              opacity: 0;
              pointer-events: none;
              transition: opacity 0.15s ease;
            }
            .floating-grid-tile:hover > .kloud-tile-more-menu-wrap:not(.kloud-tile-more-menu-wrap--inline),
            .webcam-sidebar-tile:hover > .kloud-tile-more-menu-wrap:not(.kloud-tile-more-menu-wrap--inline),
            .webcam-sidebar-tile:hover .kloud-tile-more-menu-wrap--inline,
            .lk-grid-layout-wrapper .lk-participant-tile:hover .kloud-tile-more-menu-wrap--inline,
            .lk-mobile-scroll-grid .lk-participant-tile:hover .kloud-tile-more-menu-wrap--inline,
            .lk-grid-layout-wrapper .lk-participant-tile:hover > .kloud-tile-more-menu-wrap:not(.kloud-tile-more-menu-wrap--inline),
            .lk-mobile-scroll-grid .lk-participant-tile:hover > .kloud-tile-more-menu-wrap:not(.kloud-tile-more-menu-wrap--inline),
            .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile:hover > .kloud-tile-more-menu-wrap {
              opacity: 1;
              pointer-events: auto;
            }
            .kloud-tile-more-menu-wrap:has(.kloud-tile-more-menu-btn.open),
            .kloud-tile-more-menu-wrap.open {
              opacity: 1;
              pointer-events: auto;
            }
            .webcam-sidebar-tile {
              position: relative;
            }
            .lk-grid-layout-wrapper .lk-participant-tile,
            .lk-mobile-scroll-grid .lk-participant-tile {
              position: relative !important;
            }
            .kloud-tile-more-menu-wrap--inline {
              position: static;
              top: auto;
              right: auto;
              flex-shrink: 0;
            }
            /* 画中画窗口很窄，⋯ 下拉整体收紧且不能超出窗口宽度 */
            [data-kloud-pip] .kloud-more-dropdown {
              min-width: 0;
              max-width: calc(100vw - 16px);
              padding: 3px;
              border-radius: 8px;
            }
            [data-kloud-pip] .kloud-more-dropdown-item {
              white-space: normal;
              text-align: left;
              gap: 6px;
              padding: 5px 7px;
              font-size: 11px;
              line-height: 1.25;
              border-radius: 5px;
            }
            [data-kloud-pip] .kloud-more-dropdown-item svg {
              width: 13px;
              height: 13px;
            }
            /* Grid / phone tiles show the name bottom-left (globals.css); sidebar & floating use their own labels */
            .webcam-sidebar-panel .webcam-sidebar-name,
            .floating-webcam-panel .floating-grid-name {
              display: none !important;
            }
            .lk-grid-layout-wrapper .lk-participant-metadata-item,
            .lk-mobile-scroll-grid .lk-participant-metadata-item {
              display: inline-flex !important;
              align-items: center !important;
              flex-wrap: nowrap !important;
              gap: 6px !important;
              max-width: 100% !important;
              min-width: 0 !important;
              padding: 0 !important;
              background: transparent !important;
              border-radius: 0 !important;
            }
            .lk-grid-layout-wrapper .lk-participant-metadata-item .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn,
            .lk-mobile-scroll-grid .lk-participant-metadata-item .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn {
              width: 28px;
              height: 28px;
            }
            .lk-grid-layout-wrapper .lk-participant-metadata-item .kloud-custom-mic-indicator,
            .lk-grid-layout-wrapper .lk-participant-metadata-item .kloud-custom-cam-indicator,
            .lk-mobile-scroll-grid .lk-participant-metadata-item .kloud-custom-mic-indicator,
            .lk-mobile-scroll-grid .lk-participant-metadata-item .kloud-custom-cam-indicator {
              width: 28px !important;
              height: 28px !important;
              min-width: 28px !important;
              min-height: 28px !important;
            }
            /* 触摸设备无 hover：Host 在 Webcam 网格仍能看到 ⋯ */
            @media (hover: none) {
              .lk-mobile-scroll-grid .kloud-tile-more-menu-wrap--inline,
              .lk-grid-layout-wrapper .kloud-tile-more-menu-wrap--inline {
                opacity: 1;
                pointer-events: auto;
              }
            }
            .webcam-sidebar-meta .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn {
              width: 28px;
              height: 28px;
            }
            .kloud-tile-more-menu-wrap .kloud-role-icon-btn {
              width: 20px;
              height: 20px;
              padding: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              background: rgba(32, 33, 36, 0.75);
              backdrop-filter: blur(4px);
              border: none;
              border-radius: 50%;
              box-sizing: border-box;
              color: #fff;
              cursor: pointer;
            }
            .kloud-tile-more-menu-wrap .kloud-role-icon-btn:hover,
            .kloud-tile-more-menu-wrap .kloud-role-icon-btn.open {
              background: rgba(60, 64, 67, 0.92);
              color: #fff;
            }
            .kloud-tile-more-menu-wrap .kloud-role-icon-btn:focus-visible {
              outline: 2px solid var(--km-on-dark-accent);
              outline-offset: 1px;
            }
            .sky-meet-video-wrapper .lk-carousel > .lk-participant-tile > .kloud-tile-more-menu-wrap .kloud-tile-more-menu-btn,
            .lk-grid-layout-wrapper .lk-participant-tile > .kloud-tile-more-menu-wrap .kloud-tile-more-menu-btn,
            .lk-mobile-scroll-grid .lk-participant-tile > .kloud-tile-more-menu-wrap .kloud-tile-more-menu-btn {
              pointer-events: auto;
            }

            /* ══════════════════════════════════════════════════════
               Tile control chips — mic / cam / more 各自独立
               ══════════════════════════════════════════════════════ */
            .lk-room-container .kloud-custom-mic-indicator,
            .lk-room-container .kloud-custom-cam-indicator {
              background: rgba(32, 33, 36, 0.75);
              backdrop-filter: blur(4px);
              border: none;
              border-radius: 50% !important;
              box-sizing: border-box;
              margin: 0 !important;
            }
            .lk-room-container .lk-participant-metadata-item .lk-participant-name,
            .lk-room-container .lk-participant-metadata-item .webcam-sidebar-name,
            .lk-room-container .floating-grid-name-row .floating-grid-name {
              padding: 0;
              background: transparent;
              backdrop-filter: none;
              border: none;
              box-sizing: border-box;
            }

            /* ══════════════════════════════════════════════════════
               Custom Microphone Indicator DOM Injection
               Replaces LiveKit's missing "mic on" DOM states
               ══════════════════════════════════════════════════════ */

            /* Completely hide LiveKit's default mic/camera muted indicators */
            .lk-grid-layout-wrapper .lk-track-muted-indicator-microphone,
            .lk-mobile-scroll-grid .lk-track-muted-indicator-microphone,
            .webcam-sidebar-panel .lk-track-muted-indicator-microphone,
            .floating-webcam-panel .lk-track-muted-indicator-microphone,
            .sky-meet-video-wrapper .lk-carousel .lk-track-muted-indicator-microphone,
            .lk-grid-layout-wrapper .lk-track-muted-indicator-camera,
            .lk-mobile-scroll-grid .lk-track-muted-indicator-camera,
            .webcam-sidebar-panel .lk-track-muted-indicator-camera,
            .floating-webcam-panel .lk-track-muted-indicator-camera,
            .sky-meet-video-wrapper .lk-carousel .lk-track-muted-indicator-camera {
              display: none !important;
            }

            /* Mic/cam indicator colors — green active, gray voluntary off, red host-restricted / mute-all */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-muted="false"],
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-muted="false"],
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-muted="false"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-muted="false"],
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator[data-kloud-video-disabled="false"],
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator[data-kloud-video-disabled="false"],
            .webcam-sidebar-panel .kloud-custom-cam-indicator[data-kloud-video-disabled="false"],
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-video-disabled="false"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-video-disabled="false"] {
              color: #22c55e !important;
            }

            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-muted="true"]:not([data-kloud-host-restricted="true"]):not([data-kloud-force-muted="true"]),
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-muted="true"]:not([data-kloud-host-restricted="true"]):not([data-kloud-force-muted="true"]),
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-muted="true"]:not([data-kloud-host-restricted="true"]):not([data-kloud-force-muted="true"]),
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-muted="true"]:not([data-kloud-host-restricted="true"]):not([data-kloud-force-muted="true"]),
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator[data-kloud-video-disabled="true"]:not([data-kloud-host-restricted="true"]),
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator[data-kloud-video-disabled="true"]:not([data-kloud-host-restricted="true"]),
            .webcam-sidebar-panel .kloud-custom-cam-indicator[data-kloud-video-disabled="true"]:not([data-kloud-host-restricted="true"]),
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-video-disabled="true"]:not([data-kloud-host-restricted="true"]),
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-video-disabled="true"]:not([data-kloud-host-restricted="true"]) {
              color: rgba(255, 255, 255, 0.75) !important;
            }

            /* Our custom injected microphone indicator styling */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator,
            .webcam-sidebar-panel .kloud-custom-mic-indicator,
            .floating-webcam-panel .kloud-custom-mic-indicator,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator {
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
              width: 1.15rem;
              height: 1.15rem;
              flex-shrink: 0;
              transition: all 0.2s ease;
              pointer-events: auto;
            }

            /* 主持强制静音/禁视频：红色 + 脉冲 */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-force-muted="true"],
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"],
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] {
              width: 1.4rem;
              height: 1.4rem;
              color: #ff2020 !important;
              filter: drop-shadow(0 0 5px rgba(255, 32, 32, 0.8));
              animation: kloud-mic-alert-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg *,
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg,
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg *,
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg,
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg *,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg *,
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg,
            .webcam-sidebar-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg *,
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg,
            .floating-webcam-panel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg * {
              fill: currentColor !important;
              stroke: currentColor !important;
            }
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.kloud-custom-mic--force-muted,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] {
              color: #ff2020 !important;
            }
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.kloud-custom-mic--force-muted svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.kloud-custom-mic--force-muted svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-host-restricted="true"] svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator[data-kloud-force-muted="true"] svg * {
              fill: currentColor !important;
              stroke: currentColor !important;
            }

            @keyframes kloud-mic-alert-pulse {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.7; transform: scale(0.9); }
            }

            /* 举手角标：画面左上角的浅紫圆形手掌（只读，不可点击） */
            .kloud-tile-hand-badge {
              position: absolute;
              top: 10px;
              left: 10px;
              z-index: 6;
              display: flex;
              align-items: center;
              justify-content: center;
              width: 34px;
              height: 34px;
              padding: 7px;
              box-sizing: border-box;
              border-radius: 50%;
              border: none;
              background: var(--km-on-dark-accent);
              color: #1f1d6b;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
              pointer-events: none;
              animation: kloud-hand-raise-in 0.22s ease-out;
            }
            .kloud-tile-hand-badge svg {
              display: block;
              width: 100%;
              height: 100%;
            }
            .lk-mobile-scroll-grid .kloud-tile-hand-badge,
            .webcam-sidebar-panel .kloud-tile-hand-badge,
            .floating-webcam-panel .kloud-tile-hand-badge,
            .sky-meet-video-wrapper .lk-carousel .kloud-tile-hand-badge {
              top: 6px;
              left: 6px;
              width: 24px;
              height: 24px;
              padding: 4px;
              border-radius: 50%;
            }
            @keyframes kloud-hand-raise-in {
              from { opacity: 0; transform: translateY(4px) scale(0.85); }
              to { opacity: 1; transform: none; }
            }

            /* Host hover interactions */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.operator-interactive,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.operator-interactive,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.self-interactive,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.self-interactive {
              cursor: pointer;
              border-radius: 50%;
              padding: 3px;
              min-width: 1.6rem;
              min-height: 1.6rem;
              margin: 0;
            }
            /* SVG inside mic indicator must not steal pointer events */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator svg,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator svg *,
            .webcam-sidebar-panel .kloud-custom-mic-indicator svg,
            .webcam-sidebar-panel .kloud-custom-mic-indicator svg *,
            .floating-webcam-panel .kloud-custom-mic-indicator svg,
            .floating-webcam-panel .kloud-custom-mic-indicator svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator svg * {
              pointer-events: none;
            }
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.operator-interactive:hover,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.operator-interactive:hover,
            .floating-webcam-panel .kloud-custom-mic-indicator.operator-interactive:hover,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.operator-interactive:hover,
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.self-interactive:hover,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.self-interactive:hover,
            .floating-webcam-panel .kloud-custom-mic-indicator.self-interactive:hover,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.self-interactive:hover {
              background: rgba(60, 64, 67, 0.92);
              transform: scale(1.05);
            }

            .floating-webcam-panel .kloud-custom-mic-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator.operator-interactive,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.operator-interactive,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.self-interactive {
              min-width: 20px;
              min-height: 20px;
              width: 20px;
              height: 20px;
              padding: 3px;
              margin: 0 !important;
              box-sizing: border-box;
            }

            /* Custom injected camera indicator styling */
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator,
            .webcam-sidebar-panel .kloud-custom-cam-indicator,
            .floating-webcam-panel .kloud-custom-cam-indicator,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator {
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
              width: 1.15rem;
              height: 1.15rem;
              flex-shrink: 0;
              transition: all 0.2s ease;
              pointer-events: auto;
            }

            .lk-grid-layout-wrapper .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .webcam-sidebar-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"],
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .floating-webcam-panel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled {
              width: 1.4rem;
              height: 1.4rem;
              color: #ff2020 !important;
              filter: drop-shadow(0 0 5px rgba(255, 32, 32, 0.8));
              animation: kloud-mic-alert-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }

            .lk-grid-layout-wrapper .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg *,
            .webcam-sidebar-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg,
            .webcam-sidebar-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg *,
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg,
            .floating-webcam-panel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] svg * {
              fill: currentColor !important;
              stroke: currentColor !important;
            }
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator[data-kloud-host-restricted="true"] {
              color: #ff2020 !important;
            }
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.kloud-custom-cam--force-disabled svg * {
              fill: currentColor !important;
              stroke: currentColor !important;
            }

            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.operator-interactive,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.operator-interactive,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.self-interactive,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.self-interactive {
              cursor: pointer;
              border-radius: 50%;
              padding: 3px;
              min-width: 1.6rem;
              min-height: 1.6rem;
              margin: 0;
            }

            .lk-grid-layout-wrapper .kloud-custom-cam-indicator svg,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator svg *,
            .webcam-sidebar-panel .kloud-custom-cam-indicator svg,
            .webcam-sidebar-panel .kloud-custom-cam-indicator svg *,
            .floating-webcam-panel .kloud-custom-cam-indicator svg,
            .floating-webcam-panel .kloud-custom-cam-indicator svg *,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator svg,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator svg * {
              pointer-events: none;
            }

            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.operator-interactive:hover,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.operator-interactive:hover,
            .floating-webcam-panel .kloud-custom-cam-indicator.operator-interactive:hover,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.operator-interactive:hover,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.self-interactive:hover,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.self-interactive:hover,
            .floating-webcam-panel .kloud-custom-cam-indicator.self-interactive:hover,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.self-interactive:hover {
              background: rgba(60, 64, 67, 0.92);
              transform: scale(1.05);
            }

            /* Host/co-host controls stay visible so mute/camera state is never ambiguous. */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.operator-interactive,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.operator-interactive,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.operator-interactive,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.operator-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.operator-interactive {
              opacity: 1 !important;
              pointer-events: auto !important;
            }

            /* Self tile: always show own mic/cam controls (click to toggle) */
            .lk-grid-layout-wrapper .kloud-custom-mic-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator.self-interactive,
            .webcam-sidebar-panel .kloud-custom-mic-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-mic-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-mic-indicator.self-interactive,
            .lk-grid-layout-wrapper .kloud-custom-cam-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.self-interactive,
            .webcam-sidebar-panel .kloud-custom-cam-indicator.self-interactive,
            .floating-webcam-panel .kloud-custom-cam-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .kloud-custom-cam-indicator.self-interactive {
              opacity: 1 !important;
              pointer-events: auto !important;
            }

            /* Reveal both controls when host/co-host hovers the tile */
            .lk-grid-layout-wrapper .lk-participant-tile:hover .kloud-custom-mic-indicator.operator-interactive,
            .lk-grid-layout-wrapper .lk-participant-tile:hover .kloud-custom-cam-indicator.operator-interactive,
            .webcam-sidebar-panel .lk-participant-tile:hover .kloud-custom-mic-indicator.operator-interactive,
            .webcam-sidebar-panel .lk-participant-tile:hover .kloud-custom-cam-indicator.operator-interactive,
            .floating-webcam-panel .kl-participant-tile:hover .kloud-custom-mic-indicator.operator-interactive,
            .floating-webcam-panel .lk-participant-tile:hover .kloud-custom-cam-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .lk-participant-tile:hover .kloud-custom-mic-indicator.operator-interactive,
            .sky-meet-video-wrapper .lk-carousel .lk-participant-tile:hover .kloud-custom-cam-indicator.operator-interactive,
            .lk-grid-layout-wrapper .lk-participant-tile:hover .kloud-custom-mic-indicator.self-interactive,
            .lk-grid-layout-wrapper .lk-participant-tile:hover .kloud-custom-cam-indicator.self-interactive,
            .lk-mobile-scroll-grid .lk-participant-tile:hover .kloud-custom-mic-indicator.operator-interactive,
            .lk-mobile-scroll-grid .lk-participant-tile:hover .kloud-custom-cam-indicator.operator-interactive,
            .lk-mobile-scroll-grid .lk-participant-tile:hover .kloud-custom-mic-indicator.self-interactive,
            .lk-mobile-scroll-grid .lk-participant-tile:hover .kloud-custom-cam-indicator.self-interactive,
            .webcam-sidebar-panel .lk-participant-tile:hover .kloud-custom-mic-indicator.self-interactive,
            .webcam-sidebar-panel .lk-participant-tile:hover .kloud-custom-cam-indicator.self-interactive,
            .floating-webcam-panel .kl-participant-tile:hover .kloud-custom-mic-indicator.self-interactive,
            .floating-webcam-panel .lk-participant-tile:hover .kloud-custom-cam-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .lk-participant-tile:hover .kloud-custom-mic-indicator.self-interactive,
            .sky-meet-video-wrapper .lk-carousel .lk-participant-tile:hover .kloud-custom-cam-indicator.self-interactive {
              opacity: 1 !important;
              pointer-events: auto !important;
            }

            /* Mobile grid: keep metadata row compact so cam/mic icons match */
            .lk-mobile-scroll-grid .lk-participant-metadata-item {
              display: inline-flex !important;
              align-items: center !important;
              gap: 6px !important;
              max-width: 100% !important;
              min-width: 0 !important;
              padding: 0 !important;
              background: transparent !important;
              line-height: 1 !important;
            }
            /* 手机 webcam 左下角麦/摄像头：略放大，方便手指点击 */
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator {
              width: 1.65rem !important;
              height: 1.65rem !important;
              min-width: 1.65rem !important;
              min-height: 1.65rem !important;
              padding: 4px !important;
              border-radius: 50% !important;
            }
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.self-interactive,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator.operator-interactive,
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator.operator-interactive {
              min-width: 2rem !important;
              min-height: 2rem !important;
              width: 2rem !important;
              height: 2rem !important;
              padding: 5px !important;
            }
            .lk-mobile-scroll-grid .kloud-custom-cam-indicator svg,
            .lk-mobile-scroll-grid .kloud-custom-mic-indicator svg {
              width: 100% !important;
              height: 100% !important;
              max-width: 1.35rem;
              max-height: 1.35rem;
            }
            .lk-mobile-scroll-grid .lk-participant-metadata-item .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn {
              width: 2rem !important;
              height: 2rem !important;
              min-width: 2rem !important;
              min-height: 2rem !important;
            }
            .lk-mobile-scroll-grid .lk-participant-metadata-item .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn svg {
              width: 1.15rem !important;
              height: 1.15rem !important;
            }

            /* Mobile webcam：视频网格停在底部导航栏上方 */
            .kloud-mobile-meeting .main-meeting-area.kloud-mobile-webcam-view {
              bottom: var(--kloud-mobile-toolbar-height);
            }
            /* LiveDoc on phone: keep paging/zoom bar fully above the meeting toolbar */
            .kloud-mobile-meeting .main-meeting-area.kloud-mobile-webcam-view iframe[title="LiveDoc"] {
              max-height: 100%;
            }
            .kloud-mobile-meeting .main-meeting-area.kloud-mobile-webcam-view .lk-mobile-scroll-grid {
              height: 100%;
              max-height: 100%;
            }

            /* ══════════════════════════════════════════════════════
               2026-10 redesign — Meet-style tile chrome
               Desktop grid + spotlight stage: name bottom-left (no plate),
               round mic / cam / ⋯ badges top-right, hand badge top-left.
               ══════════════════════════════════════════════════════ */
            .lk-grid-layout-wrapper .lk-participant-tile > .lk-participant-metadata,
            .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout > .lk-participant-tile > .lk-participant-metadata {
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              padding: 10px 52px 10px 14px;
              align-items: flex-end;
              pointer-events: none;
              z-index: 3;
            }
            .lk-grid-layout-wrapper .lk-participant-tile > .lk-participant-metadata > .lk-participant-metadata-item:first-child,
            .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout > .lk-participant-tile > .lk-participant-metadata > .lk-participant-metadata-item:first-child {
              position: static !important;
              flex: 1 1 auto;
              min-width: 0 !important;
            }
            .lk-grid-layout-wrapper .lk-participant-tile > .lk-participant-metadata .lk-participant-name,
            .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout > .lk-participant-tile > .lk-participant-metadata .lk-participant-name {
              order: -1;
            }
            .lk-grid-layout-wrapper .lk-participant-tile > .lk-participant-metadata .kloud-custom-mic-indicator,
            .lk-grid-layout-wrapper .lk-participant-tile > .lk-participant-metadata .kloud-custom-cam-indicator,
            .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout > .lk-participant-tile > .lk-participant-metadata .kloud-custom-mic-indicator,
            .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout > .lk-participant-tile > .lk-participant-metadata .kloud-custom-cam-indicator {
              position: absolute !important;
              top: 10px;
              right: 10px;
              width: 30px !important;
              height: 30px !important;
              min-width: 30px !important;
              min-height: 30px !important;
              padding: 7px !important;
              pointer-events: auto;
            }
            .lk-grid-layout-wrapper .lk-participant-tile > .lk-participant-metadata .kloud-custom-cam-indicator,
            .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout > .lk-participant-tile > .lk-participant-metadata .kloud-custom-cam-indicator {
              right: 46px;
            }
            .lk-grid-layout-wrapper .lk-participant-tile > .lk-participant-metadata .kloud-tile-more-menu-wrap--inline,
            .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout > .lk-participant-tile > .lk-participant-metadata .kloud-tile-more-menu-wrap--inline {
              position: absolute !important;
              top: 10px;
              right: 82px;
            }
            .lk-grid-layout-wrapper .lk-participant-metadata-item .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn,
            .sky-meet-video-wrapper.webcam-spotlight .lk-focus-layout .lk-participant-metadata-item .kloud-tile-more-menu-wrap--inline .kloud-role-icon-btn {
              width: 30px !important;
              height: 30px !important;
            }
            /* LiveKit pin (focus) toggle moves to the bottom-right so it never covers the badges */
            .lk-grid-layout-wrapper .lk-participant-tile > .lk-focus-toggle-button {
              top: auto;
              bottom: 8px;
              right: 10px;
              z-index: 4;
              width: 32px;
              height: 32px;
              padding: 0;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              border-radius: 50%;
              background-color: rgba(32, 33, 36, 0.75);
            }
            .lk-grid-layout-wrapper .lk-participant-tile > .lk-focus-toggle-button:hover {
              background-color: rgba(60, 64, 67, 0.92);
            }
            /* Phone grid: name first, round badges after it on the bottom row */
            .lk-mobile-scroll-grid .lk-participant-tile > .lk-participant-metadata > .lk-participant-metadata-item:first-child {
              flex: 1 1 auto;
              min-width: 0 !important;
            }
            .lk-mobile-scroll-grid .lk-participant-tile .lk-participant-name {
              order: -1;
              flex: 1 1 auto;
              margin-right: 2px;
            }
            .lk-mobile-scroll-grid .kloud-tile-hand-badge {
              top: 6px;
              left: 6px;
              width: 26px;
              height: 26px;
              padding: 5px;
            }
            .webcam-sidebar-panel .kloud-tile-hand-badge,
            .floating-webcam-panel .kloud-tile-hand-badge {
              top: 6px;
              left: 6px;
              width: 24px;
              height: 24px;
              padding: 4px;
              border-radius: 50%;
            }

            /* ── Collapse / expand webcams tab on the stage edge ── */
            .webcam-collapse-toggle:hover {
              background: var(--km-control-hover) !important;
              color: #fff !important;
            }

            @media (prefers-reduced-motion: reduce) {
              .webcam-sidebar-tile,
              .webcam-sidebar-avatar-initials,
              .chat-overlay-panel,
              .kloud-tile-hand-badge,
              .webcam-collapse-toggle,
              .floating-webcam-panel,
              .floating-webcam-panel .floating-grid-video {
                animation: none !important;
                transition: none !important;
              }
            }

            /* Mobile: top-level RoomAudioRenderer plays remote audio; hide duplicates inside hidden video wrapper */
            .kloud-mobile-meeting .sky-meet-video-wrapper audio {
              display: none !important;
            }
`;

/** 会议内通用弹窗（会议就绪、录制确认等） */
export const KLOUD_MODAL_CSS = `
          .kloud-modal-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;
          }
          .kloud-modal {
            background: #fff; border-radius: 8px; width: 400px; max-width: 90vw; color: #111827; font-family: 'Inter', sans-serif; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          }
          .kloud-modal-center { padding: 24px; }
          .kloud-modal-side { position: absolute; right: 24px; top: 24px; bottom: 24px; height: auto; border-radius: 12px; display: flex; flex-direction: column; width: 360px; }
          .kloud-modal-header { padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f3f4f6; }
          .kloud-modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; color: #111827; }
          .kloud-modal-close { background: none; border: none; font-size: 16px; cursor: pointer; color: #6b7280; padding: 4px; border-radius: 4px; }
          .kloud-modal-close:hover { background: #f3f4f6; color: #111827; }
          .kloud-modal-body { padding: 24px; flex: 1; overflow-y: auto; }
          .kloud-btn-primary { background: #0b57d0; color: #fff; border: none; padding: 10px 24px; border-radius: 100px; font-weight: 600; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
          .kloud-btn-primary:hover { background: #0842a0; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
          .kloud-meeting-link-box { background: #f3f4f6; border-radius: 4px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; color: #111827; }
          .kloud-meeting-link-box button { background: none; border: none; cursor: pointer; color: #4b5563; padding: 4px; border-radius: 4px; display: flex; align-items: center; }
          .kloud-meeting-link-box button:hover { background: #e5e7eb; color: #111827; }
          .kloud-btn-text { background: none; border: none; font-size: 14px; font-weight: 500; color: #4b5563; cursor: pointer; padding: 8px 16px; border-radius: 4px; }
          .kloud-btn-text:hover { background: #f3f4f6; }
          /* Mobile: recording/meeting modals go centered, not side-panel */
          @media (max-width: 768px) {
            .kloud-modal-side {
              position: relative !important;
              right: auto !important; top: auto !important; bottom: auto !important;
              width: 90vw !important; max-width: 380px;
              height: auto !important; max-height: 85vh;
              border-radius: 16px !important;
            }
            .kloud-modal-overlay {
              align-items: center !important;
              padding: 16px;
            }
          }
`;
