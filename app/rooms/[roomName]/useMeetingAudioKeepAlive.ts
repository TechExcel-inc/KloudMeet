import React from 'react';
import {
  ConnectionState,
  RoomEvent,
  Track,
  TrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
} from 'livekit-client';
import { unlockMobileRoomAudio, unlockMobileRoomAudioOnGesture } from '@/lib/mobileAudioUnlock';
import { isToolbarMobileUserAgent } from '@/lib/useToolbarIsMobile';
import { AUDIO_RESUBSCRIBE_DELAY_MS, AUDIO_RESUBSCRIBE_MAX_TRIES } from './roomConstants';

/**
 * useMeetingAudioKeepAlive — 会中远端音频与音频会话保活
 *
 * 移动端：息屏 / 切后台恢复、他人入会后重新 startAudio、手势内解锁、静音音频保活；
 * 桌面端：远端音频订阅失败补订、自动播放被拦截时在下一次手势内 startAudio；
 * 两端：Wake Lock 防止息屏。
 *
 * @param room                 当前会议 Room
 * @param setCanPlaybackAudio  同步浏览器是否允许播放远端音频
 */
export function useMeetingAudioKeepAlive(
  room: Room,
  setCanPlaybackAudio: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  // ── 手机息屏恢复音频 ──
  // iOS/Android 浏览器在息屏或切后台时会 suspend AudioContext，
  // 当页面重新可见时，调用 room.startAudio() 恢复音频播放。
  React.useEffect(() => {
    if (!isToolbarMobileUserAgent()) return;

    const resumeAudio = () => {
      void unlockMobileRoomAudio(room).then((ok) => setCanPlaybackAudio(ok));
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resumeAudio();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', resumeAudio);
    window.addEventListener('focus', resumeAudio);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', resumeAudio);
      window.removeEventListener('focus', resumeAudio);
    };
  }, [room, setCanPlaybackAudio]);

  // ── 桌面端：远端音频订阅失败时补订，避免「只有他没声」卡死 ──
  React.useEffect(() => {
    if (isToolbarMobileUserAgent()) return;

    const tries = new Map<string, number>();
    const timers = new Map<string, number>();

    const handleSubscriptionFailed = (trackSid: string, participant: RemoteParticipant) => {
      const pub = participant.audioTrackPublications.get(trackSid);
      if (!pub || pub.permissionStatus === TrackPublication.PermissionStatus.NotAllowed) return;
      if (timers.has(trackSid)) return;
      const tried = tries.get(trackSid) ?? 0;
      if (tried >= AUDIO_RESUBSCRIBE_MAX_TRIES) return;
      tries.set(trackSid, tried + 1);

      timers.set(
        trackSid,
        window.setTimeout(() => {
          timers.delete(trackSid);
          if (room.state !== ConnectionState.Connected) return;
          const target = participant.audioTrackPublications.get(trackSid);
          if (!target || target.isSubscribed) return;
          console.warn('[KloudMeet] Re-subscribing failed remote audio:', participant.identity);
          target.setSubscribed(true);
        }, AUDIO_RESUBSCRIBE_DELAY_MS),
      );
    };

    const handleSubscribed = (_track: RemoteTrack, publication: RemoteTrackPublication) => {
      tries.delete(publication.trackSid);
    };

    room.on(RoomEvent.TrackSubscriptionFailed, handleSubscriptionFailed);
    room.on(RoomEvent.TrackSubscribed, handleSubscribed);
    return () => {
      room.off(RoomEvent.TrackSubscriptionFailed, handleSubscriptionFailed);
      room.off(RoomEvent.TrackSubscribed, handleSubscribed);
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      tries.clear();
    };
  }, [room]);

  // ── 移动端远程音频：与 Web 端 RoomAudioRenderer 对齐，但单独挂载并主动 startAudio ──
  // iOS/微信等在他人入会或轨道订阅后常需再次 startAudio，否则听不到对方声音。
  React.useEffect(() => {
    if (!isToolbarMobileUserAgent()) return;

    setCanPlaybackAudio(room.canPlaybackAudio);

    const recoverRemoteAudio = () => {
      void unlockMobileRoomAudio(room).then((ok) => setCanPlaybackAudio(ok));
    };

    const handleTrackSubscribed = (
      _track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (publication.kind === Track.Kind.Audio && participant.identity !== room.localParticipant.identity) {
        recoverRemoteAudio();
      }
    };

    const handleParticipantConnected = () => {
      room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((publication) => {
          if (
            publication.source === Track.Source.Microphone ||
            publication.source === Track.Source.ScreenShareAudio ||
            publication.source === Track.Source.Unknown
          ) {
            if (!publication.isSubscribed) {
              publication.setSubscribed(true);
            }
          }
        });
      });
      recoverRemoteAudio();
    };

    const handleAudioPlaybackStatusChanged = (allowed: boolean) => {
      setCanPlaybackAudio(allowed);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        recoverRemoteAudio();
      }
    };

    recoverRemoteAudio();
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.Reconnected, recoverRemoteAudio);
    room.on(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', recoverRemoteAudio);

    return () => {
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.Reconnected, recoverRemoteAudio);
      room.off(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', recoverRemoteAudio);
    };
  }, [room, setCanPlaybackAudio]);

  // ── 移动端：任意点击、触摸时在用户手势内重新解锁远程音频 ──
  // 他人入会后的 programmatic startAudio 常被移动浏览器拦截；手势内再 unlock 最稳。
  React.useEffect(() => {
    if (!isToolbarMobileUserAgent()) return;

    const onGesture = () => {
      if (room.state !== ConnectionState.Connected) return;
      unlockMobileRoomAudioOnGesture(room, (ok) => setCanPlaybackAudio(ok));
    };

    const opts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener('touchstart', onGesture, opts);
    document.addEventListener('pointerdown', onGesture, opts);
    document.addEventListener('click', onGesture, opts);
    return () => {
      document.removeEventListener('touchstart', onGesture, opts);
      document.removeEventListener('pointerdown', onGesture, opts);
      document.removeEventListener('click', onGesture, opts);
    };
  }, [room, setCanPlaybackAudio]);

  // ── 桌面端：浏览器拦截自动播放时（如刷新后跳过准备页直接入会，没有用户手势），
  // 在下一次任意点击/按键时静默 startAudio，否则本端听不到任何人 ──
  React.useEffect(() => {
    if (isToolbarMobileUserAgent()) return;

    const onGesture = () => {
      if (room.canPlaybackAudio) return;
      room.startAudio().catch((err: unknown) => {
        console.warn(
          '[KloudMeet] startAudio on gesture failed:',
          err instanceof Error ? err.message : err,
        );
      });
    };
    const handlePlaybackStatus = (allowed: boolean) => {
      if (!allowed) console.warn('[KloudMeet] Audio playback blocked — waiting for user gesture');
    };

    const opts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener('pointerdown', onGesture, opts);
    document.addEventListener('keydown', onGesture, opts);
    room.on(RoomEvent.AudioPlaybackStatusChanged, handlePlaybackStatus);
    return () => {
      document.removeEventListener('pointerdown', onGesture, opts);
      document.removeEventListener('keydown', onGesture, opts);
      room.off(RoomEvent.AudioPlaybackStatusChanged, handlePlaybackStatus);
    };
  }, [room]);

  // ── Wake Lock: 防止手机息屏中断音频 ──
  // 在支持 Wake Lock API 的浏览器上，保持屏幕唤醒以避免
  // AudioContext 被系统挂起。如果 Wake Lock 被释放（如切后台），
  // 页面恢复可见时自动重新获取。
  React.useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    let cancelled = false;

    const requestWakeLock = async () => {
      if (cancelled || !('wakeLock' in navigator)) return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          console.log('[KloudMeet] Wake Lock released');
        });
        console.log('[KloudMeet] Wake Lock acquired');
      } catch (e) {
        console.warn('[KloudMeet] Wake Lock request failed:', e);
      }
    };

    // 页面恢复可见时重新获取 Wake Lock（iOS Safari / Android Chrome 切后台后会自动释放）
    const handleVisibilityForWakeLock = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityForWakeLock);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityForWakeLock);
      if (wakeLock) {
        wakeLock.release().catch(() => { });
      }
    };
  }, []);

  // ── 静音音频保活：防止移动端息屏时挂起 WebRTC ──
  // iOS Safari / Android Chrome / 各类 WebView 在息屏后会暂停页面中所有音频。
  // 通过在一个隐藏的 <audio> 元素中循环播放极短的静音音频，
  // 可以保持浏览器的音频会话处于激活状态，从而让 WebRTC 的音频流持续工作。
  React.useEffect(() => {
    if (!isToolbarMobileUserAgent()) return;

    // 1秒静音 WAV：44字节 WAV 头 + 8000个零采样（8kHz mono 8-bit, ~1 秒）
    // 用 base64 data URL 避免额外文件请求
    const createSilentWav = (): string => {
      const sampleRate = 8000;
      const numSamples = sampleRate; // 1 second
      const bitsPerSample = 8;
      const numChannels = 1;
      const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
      const blockAlign = numChannels * (bitsPerSample / 8);
      const dataSize = numSamples * numChannels * (bitsPerSample / 8);
      const headerSize = 44;
      const buffer = new ArrayBuffer(headerSize + dataSize);
      const view = new DataView(buffer);

      // RIFF header
      const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true); // chunk size
      view.setUint16(20, 1, true);  // PCM
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, bitsPerSample, true);
      writeString(36, 'data');
      view.setUint32(40, dataSize, true);

      // 静音数据（8-bit PCM 的静音值是 128）
      for (let i = 0; i < dataSize; i++) {
        view.setUint8(headerSize + i, 128);
      }

      // 转 base64
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return 'data:audio/wav;base64,' + btoa(binary);
    };

    let audio: HTMLAudioElement | null = null;
    let started = false;

    const startKeepAlive = () => {
      if (started) return;
      try {
        audio = new Audio(createSilentWav());
        audio.loop = true;
        audio.volume = 0.01; // 几乎静音，但非零以保持音频会话
        // Safari / 移动端 WebView 需要 playsinline
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');
        void audio.play().then(() => {
          started = true;
        }).catch(() => {
          started = false;
        });
      } catch {
        started = false;
      }
    };

    // 进入会议后立即尝试播放（此时已有用户交互，一般不会被阻止）
    startKeepAlive();

    // 移动端可能多次拦截：每次用户交互都重试，直到成功
    const retryOnInteraction = () => {
      if (!started) {
        startKeepAlive();
      } else if (audio?.paused) {
        void audio.play().catch(() => null);
      }
    };
    document.addEventListener('click', retryOnInteraction, { capture: true, passive: true });
    document.addEventListener('touchstart', retryOnInteraction, { capture: true, passive: true });

    // 页面恢复可见时确保还在播放
    const handleVisibilityForKeepAlive = () => {
      if (document.visibilityState === 'visible' && audio) {
        if (audio.paused) {
          void audio.play().catch(() => null);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityForKeepAlive);
    window.addEventListener('pageshow', handleVisibilityForKeepAlive);

    return () => {
      document.removeEventListener('click', retryOnInteraction, true);
      document.removeEventListener('touchstart', retryOnInteraction, true);
      document.removeEventListener('visibilitychange', handleVisibilityForKeepAlive);
      window.removeEventListener('pageshow', handleVisibilityForKeepAlive);
      if (audio) {
        audio.pause();
        audio.src = '';
        audio = null;
      }
    };
  }, []);
}
