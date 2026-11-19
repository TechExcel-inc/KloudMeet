/** AI Notes Only：共享画面有变化才上传的一张图，回放按时间轴盖在声音上。 */

export const SHOT_KIND = 'shot';
export const SHOT_INTERVAL_MS = 5000;
export const SHOT_DIFF_W = 32;
export const SHOT_DIFF_H = 18;
/** 缩小后的平均灰度差达到这个值，才当作画面变了 */
export const SHOT_DIFF_MIN = 6;
export const SHOT_MAX_W = 1280;
export const SHOT_JPEG_Q = 0.7;
export const SHOT_MAX_BYTES = 1536 * 1024;

export interface ShareShot {
  url: string;
  startMs: number;
  endMs: number | null;
}

/** 把一帧缩成灰度，用来和上一张比较。 */
export function grayOf(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const p = i * 4;
    out[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  }
  return out;
}

/**
 * frameChanged — 和上一帧比，平均灰度差够大才值得上传
 *
 * @param prev 上一张缩小灰度，没有则本张算作变了
 * @param next 这一张缩小灰度
 */
export function frameChanged(prev: Uint8Array | null, next: Uint8Array): boolean {
  if (!prev || prev.length !== next.length || next.length === 0) return true;
  let sum = 0;
  for (let i = 0; i < next.length; i++) sum += Math.abs(next[i] - prev[i]);
  return sum / next.length >= SHOT_DIFF_MIN;
}

/**
 * shotAt — 时间轴上当前该显示的那张截图
 *
 * @param shots 按 startMs 升序
 * @param ms    播放时间（毫秒）
 */
export function shotAt(shots: ShareShot[], ms: number): ShareShot | null {
  let found: ShareShot | null = null;
  for (const shot of shots) {
    if (ms < shot.startMs) break;
    if (shot.endMs === null || ms < shot.endMs) found = shot;
  }
  return found;
}

/** 截图相对这个起点存毫秒：有活文档用它的时间轴，否则用录制创建时间。 */
export function shotAnchor(recording: { livedocStartedAt: Date | null; createdAt: Date }): Date {
  return recording.livedocStartedAt ?? recording.createdAt;
}

/** shotOffset — 某个时刻在截图时间轴上的毫秒 */
export function shotOffset(anchor: Date, at: Date): number {
  return Math.max(0, at.getTime() - anchor.getTime());
}
