import type { ScreenShareCaptureOptions } from 'livekit-client';

/** 入会 / 重连换票接口；未配环境变量时走同域 API */
export const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';

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
/** 移动端浮窗与右上角 mobileTopRightBtn 的间距 */
export const FLOATING_WEBCAM_MOBILE_TOP_RIGHT_GAP = 8;
/** 移动端未测到按钮时的 right 回退（约 3 个 44px 按钮 + gap + safe） */
export const FLOATING_WEBCAM_MOBILE_RIGHT_INSET_FALLBACK = 176;
/** 高于 mobileTopActions(1002)，低于部分全局弹层 */
export const FLOATING_WEBCAM_MOBILE_Z_INDEX = 1003;

/** 请求屏幕共享时的系统/标签页音频，浏览器才会在选取器中显示对应勾选项（支持情况因浏览器而异）。 */
export const SCREEN_SHARE_CAPTURE: ScreenShareCaptureOptions = {
  audio: true,
  systemAudio: 'include',
};

/**
 * 主持人静音 / 禁用摄像头持久生效：到期时间推到远未来，只能由主持人显式取消来解除。
 * 仍沿用原有的 lockUntil 协议字段，心跳与 CORRECTION 的一致性校验逻辑无需改动。
 */
export const HOST_MIC_LOCK_MS = 100 * 365 * 24 * 60 * 60 * 1000;
/** setTimeout 延迟超过 int32 会溢出并立即触发，永久锁不需要排到期检查 */
export const MAX_LOCK_TIMEOUT_MS = 2 ** 31 - 1;
/** 举手者取消静音后持续说话多久自动放下手（阈值用于过滤咳嗽、键盘等瞬时噪声） */
export const AUTO_LOWER_HAND_MS = 1500;
/** "XXX 举手了" 提示的合并窗口，避免多人同时举手刷屏 */
export const HAND_TOAST_MERGE_MS = 700;

/** Connect errors that need their own explanation (stored in connectError, never shown raw as a title). */
export const E2EE_UNSUPPORTED = 'E2EE_UNSUPPORTED';
export const ENCRYPTION_ERROR_PREFIX = 'E2EE_ERROR: ';
export const isEncryptionError = (message: string | null | undefined) =>
  !!message && (message === E2EE_UNSUPPORTED || message.startsWith(ENCRYPTION_ERROR_PREFIX));
export const MIC_PUBLISH_RETRY_MS = 800;
export const AUDIO_RESUBSCRIBE_DELAY_MS = 1500;
export const AUDIO_RESUBSCRIBE_MAX_TRIES = 2;
/** 重连退避上限；不设次数上限，直到连上或进入终止状态 */
export const RECONNECT_MAX_DELAY_MS = 10_000;
/** 连续失败到第几轮起每次都换新票（旧票可能已被服务端拒绝） */
export const RECONNECT_FRESH_TOKEN_ATTEMPT = 3;
/** 第几轮失败时输出一次严重日志，之后每隔该轮数再输出一次 */
export const RECONNECT_SERIOUS_LOG_EVERY = 6;
/** 断线兜底巡检：防止某条触发路径漏掉导致永远不重连 */
export const RECONNECT_WATCHDOG_MS = 5_000;
/** /api/connection-details 超时；挂住会让所有重连共享同一个永不返回的 Promise */
export const CONNECTION_DETAILS_TIMEOUT_MS = 15_000;
/** 麦克风上行巡检间隔 */
export const MIC_WATCHDOG_MS = 3_000;
/** 连续多少次巡检无上行数据时 restartTrack */
export const MIC_STALL_RESTART_TICKS = 3;
/** 连续多少次巡检无上行数据时取消发布并重新发布 */
export const MIC_STALL_REPUBLISH_TICKS = 6;
/** 麦克风补发失败后的最大冷却巡检轮数 */
export const MIC_REPUBLISH_MAX_COOLDOWN_TICKS = 10;
export const MEETING_CLOSED_ERROR = 'MeetingClosedError';
/** 后台换票失败后的重试间隔 */
export const TOKEN_REFRESH_RETRY_MS = 60_000;
/**
 * SDK 内部重连（resume → 失败自动升级 full reconnect，保留 Room 与已发布轨道）的间隔。
 * SDK 默认间隔封顶 7s、约 50s 放弃；这里封顶 2s（网络恢复后最多 ~3s 就发起下一次），
 * 约 2 分钟后再交给应用层重建。
 */
export const LIVEKIT_RECONNECT_DELAYS_MS: number[] = [
  0,
  300,
  1_000,
  ...Array.from({ length: 55 }, () => 2_000),
];
