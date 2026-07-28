import type { Room } from 'livekit-client';

/**
 * 在用户手势或可见性恢复时解锁远程音频。
 * 移动端浏览器（Safari / Chrome / 各类 WebView）常在他人入会、切后台后
 * 拦截 programmatic play，需同时 startAudio + 强制 play 所有 <audio>。
 */
export async function unlockMobileRoomAudio(room: Room): Promise<boolean> {
  try {
    await room.startAudio();
  } catch {
    // 继续走元素级 fallback
  }

  if (typeof document !== 'undefined') {
    document.querySelectorAll('audio').forEach((el) => {
      const audio = el;
      audio.muted = false;
      void audio.play().catch(() => null);
    });
  }

  return room.canPlaybackAudio;
}

let lastGestureUnlockAt = 0;

/** 手势触发解锁（节流，避免每次 touch 都打满 startAudio）。 */
export function unlockMobileRoomAudioOnGesture(
  room: Room,
  onResult?: (ok: boolean) => void,
): void {
  const now = Date.now();
  if (now - lastGestureUnlockAt < 250) return;
  lastGestureUnlockAt = now;
  void unlockMobileRoomAudio(room).then((ok) => {
    onResult?.(ok);
  });
}
