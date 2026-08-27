'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 关麦时本地「想说话」意图监测。
 *
 * 设计要点：
 * 1. 独立 getUserMedia 监听流（关麦后 LiveKit 轨通常无采样，不能复用）
 * 2. 自适应噪声底噪 + 相对阈值，尽量在开口后尽快弹出
 * 3. 弹出后立即进入 2 分钟冷却；开麦后清除冷却，下次关麦可立即再监测
 * 4. 无麦克风权限或 AudioContext 未解锁时，在用户首次点击页面后重试
 */

const FRAME_MS = 40;
const WINDOW_FRAMES = 3;
const MIN_VOICE_RATIO = 0.67;
const MIN_STREAK_FRAMES = 2;
const ABS_RMS_FLOOR = 0.015;
const NOISE_EMA_QUIET = 0.05;
const NOISE_EMA_VOICE = 0.012;
const VOICE_OVER_NOISE = 2.8;
const PROMPT_AUTO_HIDE_MS = 10_000;
/** 弹出提示后的冷却（每场不限次数） */
const COOLDOWN_AFTER_SHOW_MS = 2 * 60_000;

export interface UseSpeakWhileMutedPromptOptions {
  /** 本地麦克风是否已开（开麦时不监测） */
  micEnabled: boolean;
  /** 是否允许监测（已入会、非 bot、非主持人强制静音、可访问麦克风等） */
  monitoringEnabled: boolean;
}

export interface UseSpeakWhileMutedPromptResult {
  visible: boolean;
  dismiss: () => void;
  /** 用户点「打开麦克风」：关闭提示（开麦后清除冷却，允许下一轮） */
  accept: () => void;
}

export function useSpeakWhileMutedPrompt({
  micEnabled,
  monitoringEnabled,
}: UseSpeakWhileMutedPromptOptions): UseSpeakWhileMutedPromptResult {
  const [visible, setVisible] = useState(false);
  const [monitorEpoch, setMonitorEpoch] = useState(0);
  const cooldownUntilRef = useRef(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCooldownTimer = useCallback(() => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const isInCooldown = useCallback(() => Date.now() < cooldownUntilRef.current, []);

  const scheduleCooldownEnd = useCallback(() => {
    clearCooldownTimer();
    const remaining = cooldownUntilRef.current - Date.now();
    if (remaining <= 0) {
      setMonitorEpoch((epoch) => epoch + 1);
      return;
    }
    cooldownTimerRef.current = setTimeout(() => {
      cooldownTimerRef.current = null;
      if (Date.now() >= cooldownUntilRef.current) {
        setMonitorEpoch((epoch) => epoch + 1);
      }
    }, remaining + 50);
  }, [clearCooldownTimer]);

  const startShowCooldown = useCallback(() => {
    cooldownUntilRef.current = Date.now() + COOLDOWN_AFTER_SHOW_MS;
    scheduleCooldownEnd();
  }, [scheduleCooldownEnd]);

  const dismiss = useCallback(() => {
    clearHideTimer();
    setVisible(false);
  }, [clearHideTimer]);

  const accept = useCallback(() => {
    clearHideTimer();
    setVisible(false);
  }, [clearHideTimer]);

  const showPrompt = useCallback(() => {
    if (isInCooldown()) return;
    setVisible(true);
    startShowCooldown();
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      hideTimerRef.current = null;
    }, PROMPT_AUTO_HIDE_MS);
  }, [clearHideTimer, isInCooldown, startShowCooldown]);

  // 开麦：收起提示并清除冷却，下次关麦可立即再监测
  useEffect(() => {
    if (micEnabled) {
      cooldownUntilRef.current = 0;
      clearCooldownTimer();
      clearHideTimer();
      setVisible(false);
      setMonitorEpoch((epoch) => epoch + 1);
    }
  }, [micEnabled, clearCooldownTimer, clearHideTimer]);

  // 不可监测时收起提示（保留冷却状态）
  useEffect(() => {
    if (!monitoringEnabled) {
      clearHideTimer();
      setVisible(false);
    }
  }, [monitoringEnabled, clearHideTimer]);

  useEffect(() => {
    const shouldMonitor =
      monitoringEnabled &&
      !micEnabled &&
      !visible &&
      !isInCooldown() &&
      typeof window !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia;

    if (!shouldMonitor) {
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let timeData: Uint8Array<ArrayBuffer> | null = null;
    let capturePending = false;
    let captureFailed = false;

    let noiseFloor = 0.006;
    let noiseBootstrapped = false;
    const recentVoice: boolean[] = [];
    let streak = 0;

    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      try {
        source?.disconnect();
      } catch {
        // ignore
      }
      source = null;
      analyser = null;
      if (audioContext) {
        void audioContext.close().catch(() => undefined);
        audioContext = null;
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
    };

    const resumeAudio = () => {
      if (!audioContext || audioContext.state !== 'suspended') return;
      void audioContext.resume().catch(() => undefined);
    };

    const tick = () => {
      if (cancelled || isInCooldown() || !analyser || !timeData) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      resumeAudio();

      analyser.getByteTimeDomainData(timeData);
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i += 1) {
        const centered = (timeData[i] - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / timeData.length);

      if (!noiseBootstrapped) {
        noiseFloor = Math.max(rms, 0.003);
        noiseBootstrapped = true;
      } else {
        const ema = rms > noiseFloor * VOICE_OVER_NOISE ? NOISE_EMA_VOICE : NOISE_EMA_QUIET;
        noiseFloor = noiseFloor * (1 - ema) + rms * ema;
      }

      const threshold = Math.max(noiseFloor * VOICE_OVER_NOISE, ABS_RMS_FLOOR);
      const isVoice = rms >= threshold;

      recentVoice.push(isVoice);
      if (recentVoice.length > WINDOW_FRAMES) {
        recentVoice.shift();
      }

      if (isVoice) {
        streak += 1;
      } else {
        streak = 0;
      }

      if (recentVoice.length < WINDOW_FRAMES) return;

      const voiceCount = recentVoice.reduce((n, v) => (v ? n + 1 : n), 0);
      const ratio = voiceCount / recentVoice.length;
      if (ratio >= MIN_VOICE_RATIO && streak >= MIN_STREAK_FRAMES) {
        stop();
        showPrompt();
      }
    };

    const startCapture = async () => {
      if (cancelled || capturePending || isInCooldown()) return;
      if (stream) return;
      capturePending = true;
      captureFailed = false;

      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        if (cancelled || isInCooldown()) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }

        const Ctx =
          window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) {
          nextStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = nextStream;
        audioContext = new Ctx();
        await audioContext.resume().catch(() => undefined);
        if (cancelled) {
          stop();
          return;
        }

        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.2;
        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize));

        noiseBootstrapped = false;
        recentVoice.length = 0;
        streak = 0;

        intervalId = setInterval(tick, FRAME_MS);
      } catch {
        captureFailed = true;
        stop();
      } finally {
        capturePending = false;
      }
    };

    const onUserGesture = () => {
      if (cancelled || isInCooldown()) return;
      resumeAudio();
      if (!stream && captureFailed) {
        void startCapture();
      }
    };

    document.addEventListener('pointerdown', onUserGesture, true);
    document.addEventListener('keydown', onUserGesture, true);

    void startCapture();

    return () => {
      cancelled = true;
      document.removeEventListener('pointerdown', onUserGesture, true);
      document.removeEventListener('keydown', onUserGesture, true);
      stop();
    };
  }, [micEnabled, monitoringEnabled, showPrompt, monitorEpoch, visible, isInCooldown]);

  useEffect(
    () => () => {
      clearHideTimer();
      clearCooldownTimer();
    },
    [clearHideTimer, clearCooldownTimer],
  );

  return { visible, dismiss, accept };
}
