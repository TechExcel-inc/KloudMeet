'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 关麦时本地「想说话」意图监测。
 *
 * 设计要点（降低咳嗽/键盘误触，同时对持续说话够灵敏）：
 * 1. 独立 getUserMedia 监听流（关麦后 LiveKit 轨通常无采样，不能复用）
 * 2. 自适应噪声底噪：安静时缓慢抬升噪声估计
 * 3. 相对阈值：RMS 需明显高于噪声底（并设绝对下限）
 * 4. 持续性：约 1s 窗口内多数帧为「语音帧」，且至少有一段连续语音 ≥ ~450ms
 * 5. 整场会议只触发一次提示
 */

const FRAME_MS = 50;
const WINDOW_FRAMES = 20; // ~1s
const MIN_VOICE_RATIO = 0.55;
const MIN_STREAK_FRAMES = 9; // ~450ms 连续
const ABS_RMS_FLOOR = 0.018;
const NOISE_EMA_QUIET = 0.04;
const NOISE_EMA_VOICE = 0.01;
const VOICE_OVER_NOISE = 3.2;
const PROMPT_AUTO_HIDE_MS = 10_000;

export interface UseSpeakWhileMutedPromptOptions {
  /** 本地麦克风是否已开（开麦时不监测） */
  micEnabled: boolean;
  /** 是否允许监测（已入会、非 bot、非主持人强制静音、可访问麦克风等） */
  monitoringEnabled: boolean;
}

export interface UseSpeakWhileMutedPromptResult {
  visible: boolean;
  dismiss: () => void;
  /** 用户点「打开麦克风」：关闭提示并标记已提示过 */
  accept: () => void;
}

export function useSpeakWhileMutedPrompt({
  micEnabled,
  monitoringEnabled,
}: UseSpeakWhileMutedPromptOptions): UseSpeakWhileMutedPromptResult {
  const [visible, setVisible] = useState(false);
  const promptedOnceRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearHideTimer();
    setVisible(false);
    promptedOnceRef.current = true;
  }, [clearHideTimer]);

  const accept = useCallback(() => {
    clearHideTimer();
    setVisible(false);
    promptedOnceRef.current = true;
  }, [clearHideTimer]);

  const showPrompt = useCallback(() => {
    if (promptedOnceRef.current) return;
    promptedOnceRef.current = true;
    setVisible(true);
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      hideTimerRef.current = null;
    }, PROMPT_AUTO_HIDE_MS);
  }, [clearHideTimer]);

  // 麦打开或不可监测时收起提示（不重置 once，整场只提示一次）
  useEffect(() => {
    if (micEnabled || !monitoringEnabled) {
      clearHideTimer();
      setVisible(false);
    }
  }, [micEnabled, monitoringEnabled, clearHideTimer]);

  useEffect(() => {
    const shouldMonitor =
      monitoringEnabled &&
      !micEnabled &&
      !promptedOnceRef.current &&
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

    let noiseFloor = 0.008;
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

    const tick = () => {
      if (cancelled || promptedOnceRef.current || !analyser || !timeData) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      analyser.getByteTimeDomainData(timeData);
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i += 1) {
        const centered = (timeData[i] - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / timeData.length);

      if (!noiseBootstrapped) {
        noiseFloor = Math.max(rms, 0.004);
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

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        if (cancelled || promptedOnceRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          return;
        }

        const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          return;
        }

        audioContext = new Ctx();
        if (audioContext.state === 'suspended') {
          await audioContext.resume().catch(() => undefined);
        }
        if (cancelled) {
          stop();
          return;
        }

        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.35;
        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize));

        intervalId = setInterval(tick, FRAME_MS);
      } catch {
        // 无麦克风权限或设备不可用：静默跳过
        stop();
      }
    };

    void start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [micEnabled, monitoringEnabled, showPrompt]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  return { visible, dismiss, accept };
}
