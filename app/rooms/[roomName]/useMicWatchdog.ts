import React from 'react';
import { ConnectionState, LocalAudioTrack, Track, type Room } from 'livekit-client';
import { isToolbarMobileUserAgent } from '@/lib/useToolbarIsMobile';
import {
  MIC_REPUBLISH_MAX_COOLDOWN_TICKS,
  MIC_STALL_REPUBLISH_TICKS,
  MIC_STALL_RESTART_TICKS,
  MIC_WATCHDOG_MS,
} from './roomConstants';
import { publishMic } from './roomMedia';

interface MicWatchdogOptions {
  room: Room;
  /** 用户当前是否想开麦 */
  desiredMicRef: React.MutableRefObject<boolean>;
  /** 本人被主持人禁麦时为 true，此时不补发 */
  localMicRestrictedRef: React.MutableRefObject<boolean>;
  /** 应用层重连进行中时为 true，此时不巡检 */
  reconnectInFlightRef: React.MutableRefObject<boolean>;
  setMicEnabled: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * useMicWatchdog — 麦克风保活巡检
 *
 * 每隔 MIC_WATCHDOG_MS 检查一次本地麦克风：没发布就补发，轨道结束就重启。
 * 桌面端另看上行字节：长时间不涨先 restartTrack、再取消发布后重新发布。
 * 手机开了 DTX，安静时 bytesSent 不涨，不能当卡死。
 */
export function useMicWatchdog({
  room,
  desiredMicRef,
  localMicRestrictedRef,
  reconnectInFlightRef,
  setMicEnabled,
}: MicWatchdogOptions): void {
  // ── 麦克风保活：用户想开麦时，保证轨道已发布且真的在上行发包 ──
  // 覆盖：发布失败无人补发、设备被系统/其他应用占用（track muted / ended）、发送端卡死。
  React.useEffect(() => {
    let stalls = 0;
    let lastBytes = -1;
    let failures = 0;
    let cooldown = 0;
    let busy = false;

    const reset = () => {
      stalls = 0;
      lastBytes = -1;
    };

    const republish = async (): Promise<void> => {
      const ok = await publishMic(room);
      setMicEnabled(ok);
      failures = ok ? 0 : failures + 1;
      cooldown = Math.min(failures, MIC_REPUBLISH_MAX_COOLDOWN_TICKS);
      reset();
    };

    const tick = async (): Promise<void> => {
      if (busy) return;
      if (cooldown > 0) {
        cooldown -= 1;
        return;
      }
      if (
        room.state !== ConnectionState.Connected ||
        reconnectInFlightRef.current ||
        !desiredMicRef.current ||
        localMicRestrictedRef.current
      ) {
        reset();
        return;
      }
      busy = true;
      try {
        const lp = room.localParticipant;
        const pub = lp.getTrackPublication(Track.Source.Microphone);
        const track = pub?.track;
        if (!pub || !(track instanceof LocalAudioTrack)) {
          console.warn('[KloudMeet] Mic expected but not published — republishing');
          await republish();
          return;
        }
        if (pub.isMuted) {
          reset();
          return;
        }
        const media = track.mediaStreamTrack;
        if (media.readyState === 'ended') {
          console.warn('[KloudMeet] Mic track ended — restarting');
          await track.restartTrack();
          reset();
          return;
        }
        // 手机 DTX：不说话时上行字节不涨，不能当发送卡死
        if (isToolbarMobileUserAgent()) {
          reset();
          return;
        }
        const stats = await track.getSenderStats();
        const bytes = stats?.bytesSent ?? -1;
        const frozen = bytes >= 0 && lastBytes >= 0 && bytes <= lastBytes;
        lastBytes = bytes;
        stalls = media.muted || frozen ? stalls + 1 : 0;
        if (stalls === MIC_STALL_RESTART_TICKS) {
          console.warn('[KloudMeet] Mic uplink stalled — restarting track');
          await track.restartTrack();
          lastBytes = -1;
          return;
        }
        if (stalls >= MIC_STALL_REPUBLISH_TICKS) {
          console.warn('[KloudMeet] Mic uplink still stalled — republishing');
          await lp.unpublishTrack(track);
          await republish();
        }
      } catch (err: unknown) {
        console.warn(
          '[KloudMeet] Mic watchdog failed:',
          err instanceof Error ? err.message : err,
        );
      } finally {
        busy = false;
      }
    };

    const id = window.setInterval(() => void tick(), MIC_WATCHDOG_MS);
    return () => window.clearInterval(id);
  }, [room, setMicEnabled, desiredMicRef, localMicRestrictedRef, reconnectInFlightRef]);
}
