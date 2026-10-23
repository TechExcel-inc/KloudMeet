'use client';

/**
 * useCaptions.ts — 会议实时字幕 React Hook
 *
 * 字幕数据流：
 *   麦克风 → 国内百炼 Fun-ASR / 国外 OpenAI → onMessage → publishData(LiveKit) → 所有参与者 → 渲染
 *
 * 额外功能（本次新增）：
 *   — 每当本地发言者收到 type=0（最终字幕）时，自动 POST /api/transcripts/save
 *     将字幕持久化到 MeetingTranscript 表，供回放页展示。
 *
 * meetingId 从 localStorage 的 'activeMeetingId' 读取，
 * 由 PageClientImpl 在 meetingInfo 加载后写入。
 *
 * 字幕消息 topic：'kloud-caption'
 */

import React from 'react';
import { RoomEvent } from 'livekit-client';
import type { Room } from 'livekit-client';
import { RtasrHelper } from './RtasrHelper';
import type { CaptionEngine, RtasrMessage } from './RtasrHelper';
import { FunAsrHelper } from './FunAsrHelper';
import { resolveSttProvider } from './sttProvider';
import type { SttProvider } from './sttProvider';
import { translateText } from './translationService';

// ── 常量 ──────────────────────────────────────────────────────────────────

const CAPTION_TOPIC = 'kloud-caption';

/** 字幕自动隐藏延迟（ms） */
const CAPTION_HIDE_DELAY = 5000;

// ── 类型定义 ──────────────────────────────────────────────────────────────

export interface CaptionPayload {
  /** 句段 ID */
  id: number | string;
  /** 识别文字 */
  src: string;
  /** 0 = 最终结果 / 1 = 中间结果 */
  tp: 0 | 1;
  /** 发言者用户 ID（来自 localStorage kloudUser） */
  userId: string;
  /** 发言者姓名 */
  userName: string;
  /** 会议开始后的秒数（用于回放跳转） */
  offsetSeconds?: number;
  /** 发言时的语言 */
  speakLanguage?: string;
  /** 广播方的默认目标翻译语言 */
  defaultTargetLanguage?: string;
  /** 广播方提供的默认翻译文本 */
  defaultTranslatedText?: string;
}

export interface CaptionsInfo {
  /** 是否显示字幕区域 */
  show: boolean;
  /** 发言者姓名 */
  userName: string;
  /** 字幕内容 */
  text: string;
  /** 是否是中间结果（partial），用于显示闪烁光标 */
  isPartial: boolean;
}

export interface UseCaptionsOptions {
  /** LiveKit Room 实例 */
  room: Room;
  /** 本地麦克风是否开启（关闭时自动停止识别） */
  micEnabled: boolean;
  /** AssemblyAI 语言代码（默认 zh）*/
  languageCode?: string;
}

export interface UseCaptionsReturn {
  /** 当前字幕状态 */
  captionsInfo: CaptionsInfo;
  /**
   * 开启/关闭字幕
   * @param open true = 开启，false = 关闭
   */
  setCaptionsOpen: (open: boolean) => Promise<void>;
  /** 字幕是否正在运行 */
  captionsRunning: boolean;
}

// ── 工具：从 localStorage 读取当前 meetingId ─────────────────────────────

function getActiveMeetingId(): number | null {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('activeMeetingId') : null;
    if (raw) {
      const id = parseInt(raw);
      return isNaN(id) ? null : id;
    }
  } catch (_) {}
  return null;
}

// ── 工具：计算距会议开始的秒数 ────────────────────────────────────────────

function getMeetingOffsetSeconds(): number | undefined {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('activeMeetingStartedAt') : null;
    if (raw) {
      const diff = Math.floor((Date.now() - new Date(raw).getTime()) / 1000);
      return diff >= 0 ? diff : undefined;
    }
  } catch (_) {}
  return undefined;
}

// ── 核心：保存最终字幕到 DB（fire-and-forget）─────────────────────────────

async function saveTranscript(payload: {
  meetingId: number;
  speakerName: string;
  content: string;
  offsetSeconds?: number;
}) {
  try {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('kloudUser') : null;
    const token = stored ? (JSON.parse(stored).token || '') : '';
    await fetch('/api/transcripts/save', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[useCaptions] Failed to save transcript:', err);
  }
}

// ── Hook 实现 ─────────────────────────────────────────────────────────────

export function useCaptions({
  room,
  micEnabled,
  languageCode = 'zh',
}: UseCaptionsOptions): UseCaptionsReturn {
  const [captionsInfo, setCaptionsInfo] = React.useState<CaptionsInfo>({
    show: false,
    userName: '',
    text: '',
    isPartial: false,
  });
  const [captionsRunning, setCaptionsRunning] = React.useState(false);
  const [engineEpoch, setEngineEpoch] = React.useState(0);

  const rtasrRef = React.useRef<CaptionEngine | null>(null);
  const providerRef = React.useRef<SttProvider | null>(null);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const micEnabledRef = React.useRef(micEnabled);
  const openSeqRef = React.useRef(0);
  micEnabledRef.current = micEnabled;

  const encoder = React.useMemo(() => new TextEncoder(), []);
  const decoder = React.useMemo(() => new TextDecoder(), []);

  // ── 显示字幕到界面 ──────────────────────────────────────────────────────

  const showCaptionsToGUI = React.useCallback(
    (payload: CaptionPayload) => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      const displayName =
        payload.userName ||
        (() => {
          for (const [, p] of room.remoteParticipants) {
            if (p.identity === payload.userId) return p.name || p.identity;
          }
          if (room.localParticipant.identity === payload.userId) {
            return room.localParticipant.name || room.localParticipant.identity || payload.userId;
          }
          return payload.userId;
        })();

      setCaptionsInfo({ show: true, userName: displayName, text: payload.src, isPartial: payload.tp === 1 });

      // partial 结果只延迟 1s 后隐藏（给视觉刷新留余地），final 延迟 5s
      const delay = payload.tp === 1 ? 1200 : CAPTION_HIDE_DELAY;
      hideTimerRef.current = setTimeout(() => {
        setCaptionsInfo((prev) => ({ ...prev, show: false, isPartial: false }));
      }, delay);
    },
    [room],
  );

  // ── 接收远端字幕（LiveKit DataChannel） ────────────────────────────────

  React.useEffect(() => {
    const handleData = (
      payloadBytes: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== CAPTION_TOPIC) return;
      try {
        const data: CaptionPayload = JSON.parse(decoder.decode(payloadBytes));
        
        let settings = { subtitleVisible: true, readLanguage: languageCode === 'zh' ? 'en' : 'zh' };
        try {
          const raw = localStorage.getItem('kloud-stt-settings');
          if (raw) Object.assign(settings, JSON.parse(raw));
        } catch(e) {}
        
        if (!settings.subtitleVisible) return;
        
        const speakLanguage = data.speakLanguage || languageCode || 'zh';
        const myReadLanguage = settings.readLanguage || (speakLanguage === 'zh' ? 'en' : 'zh');
        
        // 核心优化：直接利用广播方的默认翻译，省去重复调用的费用
        if (data.defaultTargetLanguage === myReadLanguage && data.defaultTranslatedText) {
           showCaptionsToGUI({ ...data, src: data.defaultTranslatedText });
        } else if (data.tp === 1 && speakLanguage !== myReadLanguage) {
           // 中间结果尚未翻译，避免先显示原文、最终句再切换成译文
           return;
        } else if (
          data.tp === 0 &&
          speakLanguage !== myReadLanguage &&
          speakLanguage !== 'auto'
        ) {
           // 仅最终句翻译；中间结果（tp=1）不打 /api/translate
           translateText(data.src, myReadLanguage, speakLanguage)
             .then(translated => showCaptionsToGUI({ ...data, src: translated }))
             .catch(() => showCaptionsToGUI(data));
        } else {
           showCaptionsToGUI(data); // 读语言 = 说语言，或仍在识别中，直接显示原文
        }
      } catch (e) {
        console.error('[useCaptions] Failed to parse caption data', e);
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, decoder, showCaptionsToGUI, languageCode]);

  // 识别只由这里启动和停止。开字幕本身不连引擎，避免和开麦各打一次 token。
  React.useEffect(() => {
    const engine = rtasrRef.current;
    if (!captionsRunning || !engine) return;
    if (!micEnabled) {
      engine.Stop();
      return;
    }
    const defaultMic = localStorage.getItem('DefaultMic') || '';
    engine.Start(defaultMic).catch((err: unknown) => {
      console.warn('[useCaptions] Failed to restart recognition:', err);
    });
  }, [micEnabled, captionsRunning, engineEpoch]);

  // ── 监听设置变更 ────────────────────────────────────────────────────────
  React.useEffect(() => {
    const handleSettingsChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.subtitleVisible === false) {
        setCaptionsInfo((prev) => ({ ...prev, show: false }));
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
      }
    };
    window.addEventListener('kloud-stt-settings-changed', handleSettingsChange);
    return () => window.removeEventListener('kloud-stt-settings-changed', handleSettingsChange);
  }, []);

  // ── 开启/关闭字幕 ──────────────────────────────────────────────────────

  const setCaptionsOpen = React.useCallback(
    async (open: boolean) => {
      const seq = ++openSeqRef.current;
      if (open) {
        const provider = await resolveSttProvider();
        if (seq !== openSeqRef.current) return;
        if (!rtasrRef.current || providerRef.current !== provider) {
          rtasrRef.current?.Stop();
          const helper: CaptionEngine = provider === 'bailian' ? new FunAsrHelper() : new RtasrHelper();
          helper.languageCode = languageCode;
          helper.roomName = room.name;

          helper.OnMessage = async (d: RtasrMessage) => {
            // 使用 LiveKit 的 localParticipant（每个连接独立，不受同浏览器多 Tab 共享 localStorage 影响）
            const userId = room.localParticipant.identity;
            const userName = room.localParticipant.name || userId;

            const offsetSeconds = getMeetingOffsetSeconds();

            let settings = { 
              subtitleVisible: true, 
              readLanguage: languageCode === 'zh' ? 'en' : 'zh', 
              speakLanguage: languageCode 
            };
            try {
              const raw = localStorage.getItem('kloud-stt-settings');
              if (raw) Object.assign(settings, JSON.parse(raw));
            } catch(e) {}
            
            // STT 识别出的实际语种优先于用户设置（OpenAI 返回 ISO-639-1；若未返回则取设置值）
            const speakLanguage = d.detectedLanguage || settings.speakLanguage || languageCode || 'zh';
            const defaultTargetLanguage = settings.readLanguage || (speakLanguage === 'zh' ? 'en' : 'zh');
            const needsTranslation =
              speakLanguage !== defaultTargetLanguage &&
              speakLanguage !== 'auto';

            const payload: CaptionPayload = {
              id: d.id,
              src: d.src,
              tp: d.type,
              userId,
              userName,
              offsetSeconds,
              speakLanguage,
              defaultTargetLanguage,
            };

            // 仅最终句翻译；中间结果（type=1）每个 delta 都会回调，不能打翻译接口
            if (
              d.type === 0 &&
              needsTranslation
            ) {
              try {
                payload.defaultTranslatedText = await translateText(d.src, defaultTargetLanguage, speakLanguage);
              } catch (e) {
                payload.defaultTranslatedText = d.src;
              }
            } else if (!needsTranslation) {
              payload.defaultTranslatedText = d.src;
            }

            // 需要翻译时不显示未翻译的中间结果，只显示最终译文
            if (settings.subtitleVisible && (d.type === 0 || !needsTranslation)) {
                showCaptionsToGUI({ ...payload, src: payload.defaultTranslatedText || payload.src });
            }

            // 广播给所有参与者
            try {
              const data = encoder.encode(JSON.stringify(payload));
              await room.localParticipant
                .publishData(data, { reliable: false, topic: CAPTION_TOPIC })
                .catch(() =>
                  room.localParticipant.publishData(data, { topic: CAPTION_TOPIC }),
                );
            } catch (e) {
              console.error('[useCaptions] Failed to publish caption', e);
            }

            // ── 仅 type=0 (最终结果) 才保存到 DB ──────────────────────
            if (d.type === 0 && d.src.trim()) {
              const meetingId = getActiveMeetingId();
              if (meetingId) {
                saveTranscript({
                  meetingId,
                  speakerName: userName,
                  content: d.src.trim(),
                  offsetSeconds,
                });
              }
            }
          };

          rtasrRef.current = helper;
          providerRef.current = provider;
          setEngineEpoch((n) => n + 1);
        } else {
          // 如果已存在实例，更新语言
          rtasrRef.current.languageCode = languageCode;
        }

        // 获取最新的用户选择语言并应用到识别引擎
        try {
          const raw = localStorage.getItem('kloud-stt-settings');
          if (raw) {
            const settings = JSON.parse(raw);
            const speakLanguage = settings.speakLanguage || languageCode || 'zh';
            if (rtasrRef.current) {
              rtasrRef.current.languageCode = speakLanguage;
            }
          }
        } catch(e) {}

        if (seq !== openSeqRef.current) return;
        setCaptionsRunning(true);
      } else {
        if (rtasrRef.current) {
          rtasrRef.current.Stop();
          setCaptionsRunning(false);
        }
        setCaptionsInfo((prev) => ({ ...prev, show: false }));
      }
    },
    [room, encoder, showCaptionsToGUI, languageCode],
  );

  // ── 组件卸载时清理 ─────────────────────────────────────────────────────

  React.useEffect(() => {
    return () => {
      if (rtasrRef.current) {
        rtasrRef.current.Stop();
        rtasrRef.current = null;
        providerRef.current = null;
      }
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  return { captionsInfo, setCaptionsOpen, captionsRunning };
}
