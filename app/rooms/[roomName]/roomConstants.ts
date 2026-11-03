import {
  getBrowser,
  VideoPreset,
  type ScreenShareCaptureOptions,
  type VideoEncoding,
} from 'livekit-client';

/** 入会 / 重连换票接口；未配环境变量时走同域 API */
export const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';

/**
 * 屏幕共享编码上限：15 帧、4 Mbps。1.5 Mbps 时文字边缘被压糊，翻页、滚动后要一两秒才清楚；
 * 麦克风只要几十 kbps，用不着为它留出一大截上行。画面不动时编码器实际用不到这么多。
 */
export const SCREEN_SHARE_ENCODING: VideoEncoding = {
  maxBitrate: 4_000_000,
  maxFramerate: 15,
};

/**
 * 屏幕共享的弱网层：清晰优先，网不好时宁可画面更新慢，也不糊。
 * SDK 默认的第二层是半分辨率（1440p 采集时是 720p），网差的观众收到的字是糊的。
 * 这里换成原分辨率、3 帧、600 kbps：宽高写得比任何屏幕都大，SDK 算出来就不缩小
 * （scaleResolutionDownBy 最小是 1）。两层一样大时，LiveKit 服务器给网好的人发 15 帧那层，
 * 网差时才换到这层；共享方上行不够时，浏览器也先停掉 15 帧那层，只发这层。
 * priority 'high'：Chrome 按第一层的 priority 给整路共享分带宽，和摄像头抢上行时共享先拿。
 */
export const SCREEN_SHARE_SIMULCAST_LAYERS: VideoPreset[] = [
  new VideoPreset(7680, 4320, 600_000, 3, 'high'),
];

/**
 * 屏幕共享采集。系统声音勾选仍在；分辨率按 1440p15（ideal，不是硬封顶），
 * 2K、4K、Retina 屏只缩到 1440p，不再缩到 1080p 把字缩糊；小于它的屏幕按原样采集。
 * contentHint 用 detail，幻灯片和文字更清晰，也更省码率。
 */
export const SCREEN_SHARE_CAPTURE: ScreenShareCaptureOptions = {
  audio: true,
  systemAudio: 'include',
  contentHint: 'detail',
  resolution: { width: 2560, height: 1440, frameRate: 15 },
};

/**
 * screenShareCaptureOptions — 本次共享实际交给 getDisplayMedia 的参数
 *
 * Safari 17 一旦写了 resolution，采集会掉到很低的分辨率（WebKit 263015）。
 * 那种浏览器不传分辨率，其余字段照旧。
 */
export function screenShareCaptureOptions(): ScreenShareCaptureOptions {
  const browser = getBrowser();
  if (browser?.name === 'Safari' && browser.version.startsWith('17.')) {
    return {
      audio: SCREEN_SHARE_CAPTURE.audio,
      systemAudio: SCREEN_SHARE_CAPTURE.systemAudio,
      contentHint: SCREEN_SHARE_CAPTURE.contentHint,
    };
  }
  return SCREEN_SHARE_CAPTURE;
}

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
