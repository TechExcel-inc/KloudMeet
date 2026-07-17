import type { ScreenShareCaptureOptions } from 'livekit-client';

/** LiveDoc 浮窗头像条相对右侧文件控制栏的默认间距（px）；默认 top 仍为 12 */
export const FLOATING_WEBCAM_DEFAULT_GAP_FROM_LIVEDOC_PANEL = 16;
export const LIVEDOC_FILE_PANEL_EXPANDED_WIDTH = 320;
export const LIVEDOC_FILE_PANEL_COLLAPSED_WIDTH = 56;
/** 非 LiveDoc 场景下默认 `right`：为右侧聊天等预留（与 chat-overlay 约 352px 对齐） */
export const FLOATING_WEBCAM_RIGHT_INSET = 350;
/** 拖拽时 maxX 只用父容器右缘留白；文件栏在 iframe 内不占外层 clientWidth，不能再扣 livedoc 宽度或 350 */
export const FLOATING_WEBCAM_RIGHT_DRAG_CLAMP_MARGIN = 12;
/** 浮窗底边与底栏顶边之间的额外间距 */
export const FLOATING_WEBCAM_BOTTOM_GAP = 8;
/** 无法测量底栏时的回退高度（约桌面工具栏） */
export const FLOATING_WEBCAM_BOTTOM_TOOLBAR_FALLBACK = 64;
/** @deprecated 使用运行时测量底栏；保留别名避免旧引用断裂 */
export const FLOATING_WEBCAM_BOTTOM_TOOLBAR_INSET = FLOATING_WEBCAM_BOTTOM_TOOLBAR_FALLBACK;
export const FLOATING_WEBCAM_TOP_INSET = 12;

/** 请求屏幕共享时的系统/标签页音频，浏览器才会在选取器中显示对应勾选项（支持情况因浏览器而异）。 */
export const SCREEN_SHARE_CAPTURE: ScreenShareCaptureOptions = {
  audio: true,
  systemAudio: 'include',
};
