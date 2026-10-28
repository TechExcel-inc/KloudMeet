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
import { RoomEvent, Track } from 'livekit-client';
import type { LocalTrackPublication, Room } from 'livekit-client';
import { RtasrHelper } from './RtasrHelper';
import type { CaptionEngine, RtasrMessage } from './RtasrHelper';
import { FunAsrHelper } from './FunAsrHelper';
import { resolveSttProvider } from './sttProvider';
import type { SttProvider } from './sttProvider';
import { translateText } from './translationService';
import { CaptionSupervisor, IDLE_CAPTION_STATUS, type CaptionStatus } from './captionSupervisor';
import { meetingMicSource, type MeetingMicSource } from './captionMic';
import {
  CAPTION_STATUS_TOPIC,
  parsePeerCaptionState,
  peerStateOf,
  type PeerCaptionIssue,
  type PeerCaptionState,
} from './captionPeers';
import {
  CAPTION_SETTINGS_EVENT,
  captionLanguageFor,
  isCaptionLanguage,
  loadCaptionSettings,
  pickCaptionText,
  readCaptionLanguage,
  saveReadCaptionLanguage,
  translationTargets,
  type CaptionLanguage,
} from './captionLanguage';
import { roomAuthHeaders } from '@/lib/roomAuth';

// ── 常量 ──────────────────────────────────────────────────────────────────

const CAPTION_TOPIC = 'kloud-caption';
/** Each participant announces the language it reads captions in, so speakers translate once per language. */
const CAPTION_LANG_TOPIC = 'kloud-caption-lang';
/** A slow translation must not hold back the caption for everyone. */
const TRANSLATE_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

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
  /** Final sentence translated once into every reading language in the room, keyed by language. */
  translations?: Record<string, string>;
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
  /** Language the text is shown in, and the language it was spoken in. */
  lang?: string;
  spokenLang?: string;
  /** The words as spoken, kept under a translation (translations can be wrong). */
  original?: string;
}

export interface UseCaptionsOptions {
  /** LiveKit Room 实例 */
  room: Room;
  /** 本地麦克风是否开启（关闭时自动停止识别） */
  micEnabled: boolean;
  /** AssemblyAI 语言代码（默认 zh）*/
  languageCode?: string;
  /** 取最新 LiveKit 参会 token，用于转写/翻译接口鉴权（会中会续期，须每次现取） */
  getToken: () => string;
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
  /** This participant's reading language, and every reading language announced in the room. */
  readLanguage: CaptionLanguage;
  roomLanguages: CaptionLanguage[];
  setReadLanguage: (lang: CaptionLanguage) => void;
  /** This participant's own recognition: live, reconnecting, failed… */
  captionStatus: CaptionStatus;
  /** Try again after captions gave up. */
  retryCaptions: () => void;
  /** Other speakers whose captions have stopped working (for the host). */
  peerCaptionIssues: PeerCaptionIssue[];
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
        ...roomAuthHeaders(),
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
  languageCode = 'en',
  getToken,
}: UseCaptionsOptions): UseCaptionsReturn {
  const uiLanguage = captionLanguageFor(languageCode);
  const [readLanguage, setReadLanguageState] = React.useState<CaptionLanguage>(uiLanguage);
  const readLanguageRef = React.useRef<CaptionLanguage>(uiLanguage);
  /** identity → reading language announced by each remote participant. */
  const peerLanguagesRef = React.useRef(new Map<string, CaptionLanguage>());
  const [roomLanguages, setRoomLanguages] = React.useState<CaptionLanguage[]>([uiLanguage]);
  const [captionsInfo, setCaptionsInfo] = React.useState<CaptionsInfo>({
    show: false,
    userName: '',
    text: '',
    isPartial: false,
  });
  const [captionsRunning, setCaptionsRunning] = React.useState(false);
  const [engineEpoch, setEngineEpoch] = React.useState(0);

  const rtasrRef = React.useRef<CaptionEngine | null>(null);
  const supervisorRef = React.useRef<CaptionSupervisor | null>(null);
  /** The meeting-mic source handed to the engine (captionMic.ts). */
  const micSourceRef = React.useRef<MeetingMicSource | null>(null);
  const [captionStatus, setCaptionStatus] = React.useState<CaptionStatus>(IDLE_CAPTION_STATUS);
  const peerStatesRef = React.useRef(new Map<string, PeerCaptionState>());
  const [peerCaptionIssues, setPeerCaptionIssues] = React.useState<PeerCaptionIssue[]>([]);
  const sentPeerStateRef = React.useRef<PeerCaptionState>('ok');
  const providerRef = React.useRef<SttProvider | null>(null);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const micEnabledRef = React.useRef(micEnabled);
  const openSeqRef = React.useRef(0);
  const getTokenRef = React.useRef(getToken);
  micEnabledRef.current = micEnabled;
  getTokenRef.current = getToken;

  const encoder = React.useMemo(() => new TextEncoder(), []);
  const decoder = React.useMemo(() => new TextDecoder(), []);

  // ── 显示字幕到界面 ──────────────────────────────────────────────────────

  const showCaptionsToGUI = React.useCallback(
    (payload: CaptionPayload, lang?: string, original?: string) => {
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

      setCaptionsInfo({
        show: true,
        userName: displayName,
        text: payload.src,
        isPartial: payload.tp === 1,
        lang: lang || payload.speakLanguage,
        spokenLang: payload.speakLanguage,
        original: original && original !== payload.src ? original : undefined,
      });

      // partial 结果只延迟 1s 后隐藏（给视觉刷新留余地），final 延迟 5s
      const delay = payload.tp === 1 ? 1200 : CAPTION_HIDE_DELAY;
      hideTimerRef.current = setTimeout(() => {
        setCaptionsInfo((prev) => ({ ...prev, show: false, isPartial: false }));
      }, delay);
    },
    [room],
  );

  // ── Reading languages in the room ───────────────────────────────────────

  const refreshRoomLanguages = React.useCallback(() => {
    const all = new Set<CaptionLanguage>([readLanguageRef.current, ...peerLanguagesRef.current.values()]);
    setRoomLanguages([...all]);
  }, []);

  const announceReadLanguage = React.useCallback(() => {
    if (room.state !== 'connected') return;
    const data = encoder.encode(JSON.stringify({ lang: readLanguageRef.current }));
    room.localParticipant.publishData(data, { reliable: true, topic: CAPTION_LANG_TOPIC }).catch(() => {});
  }, [room, encoder]);

  // Own reading language: saved choice, else the interface language; re-announce on change.
  React.useEffect(() => {
    const sync = () => {
      const lang = readCaptionLanguage(uiLanguage);
      readLanguageRef.current = lang;
      setReadLanguageState(lang);
      refreshRoomLanguages();
      announceReadLanguage();
    };
    sync();
    window.addEventListener(CAPTION_SETTINGS_EVENT, sync);
    return () => window.removeEventListener(CAPTION_SETTINGS_EVENT, sync);
  }, [uiLanguage, refreshRoomLanguages, announceReadLanguage]);

  // Learn others' languages; tell newcomers ours; forget people who leave.
  React.useEffect(() => {
    const onData = (payload: Uint8Array, participant?: { identity: string }, _kind?: unknown, topic?: string) => {
      if (topic !== CAPTION_LANG_TOPIC || !participant) return;
      try {
        const { lang } = JSON.parse(decoder.decode(payload)) as { lang?: unknown };
        if (!isCaptionLanguage(lang)) return;
        peerLanguagesRef.current.set(participant.identity, lang);
        refreshRoomLanguages();
      } catch {
        /* ignore malformed announcements */
      }
    };
    const onJoin = () => announceReadLanguage();
    const onLeave = (participant: { identity: string }) => {
      if (peerLanguagesRef.current.delete(participant.identity)) refreshRoomLanguages();
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, onJoin);
    room.on(RoomEvent.ParticipantDisconnected, onLeave);
    room.on(RoomEvent.Connected, onJoin);
    announceReadLanguage();
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantConnected, onJoin);
      room.off(RoomEvent.ParticipantDisconnected, onLeave);
      room.off(RoomEvent.Connected, onJoin);
    };
  }, [room, decoder, refreshRoomLanguages, announceReadLanguage]);

  const setReadLanguage = React.useCallback((lang: CaptionLanguage) => {
    // Saving fires CAPTION_SETTINGS_EVENT, which updates state and re-announces.
    saveReadCaptionLanguage(lang);
  }, []);

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
        
        if (!loadCaptionSettings(uiLanguage).subtitleVisible) return;

        const myReadLanguage = readLanguageRef.current;
        const choice = pickCaptionText(data, myReadLanguage);
        if (choice.kind === 'original') {
          showCaptionsToGUI(data); // 读语言 = 说语言，直接显示原文
        } else if (choice.kind === 'translated') {
          // 发言方已经按房间里的每种阅读语言各翻译了一次，直接用，不再重复调用
          showCaptionsToGUI({ ...data, src: choice.text }, myReadLanguage, data.src);
        } else if (data.tp === 0) {
          // 发言方还不知道我的语言（刚入会），只有这一句自己翻译
          translateText(data.src, myReadLanguage, data.speakLanguage || 'auto', getTokenRef.current())
            .then((translated) => showCaptionsToGUI({ ...data, src: translated }, myReadLanguage, data.src))
            .catch(() => showCaptionsToGUI(data));
        }
        // 中间结果需要翻译时不显示，避免先显示原文、最终句再切换成译文
      } catch (e) {
        console.error('[useCaptions] Failed to parse caption data', e);
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, decoder, showCaptionsToGUI, uiLanguage]);

  // 识别只由这里启动和停止。开字幕本身不连引擎，避免和开麦各打一次 token。
  // 断线重连、失败后的状态由 supervisor 负责。
  React.useEffect(() => {
    const supervisor = supervisorRef.current;
    if (!captionsRunning || !supervisor) return;
    if (!micEnabled) {
      supervisor.stop();
      return;
    }
    supervisor.start();
  }, [micEnabled, captionsRunning, engineEpoch]);

  // Captions listen to the meeting's own mic (captionMic.ts). When the person switches mic, or
  // the mic track is (re)published while captions run on a stand-in capture, pick up the new
  // source: a quick restart, so the old device isn't left open.
  React.useEffect(() => {
    if (!captionsRunning || !micEnabled) return;
    const restart = () => supervisorRef.current?.retry();
    const onDevice = (kind: MediaDeviceKind) => {
      if (kind === 'audioinput') restart();
    };
    const onPublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.Microphone && micSourceRef.current?.usingStandIn()) restart();
    };
    room.on(RoomEvent.ActiveDeviceChanged, onDevice);
    room.on(RoomEvent.LocalTrackPublished, onPublished);
    return () => {
      room.off(RoomEvent.ActiveDeviceChanged, onDevice);
      room.off(RoomEvent.LocalTrackPublished, onPublished);
    };
  }, [room, captionsRunning, micEnabled]);

  // Network back: don't sit out the rest of a backoff wait.
  React.useEffect(() => {
    const onOnline = () => supervisorRef.current?.nudge();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const retryCaptions = React.useCallback(() => supervisorRef.current?.retry(), []);

  // ── Speakers' caption health (host sees who is missing) ────────────────

  const announceCaptionState = React.useCallback(
    (state: PeerCaptionState) => {
      if (room.state !== 'connected') return;
      const data = encoder.encode(JSON.stringify({ state }));
      room.localParticipant.publishData(data, { reliable: true, topic: CAPTION_STATUS_TOPIC }).catch(() => {});
    },
    [room, encoder],
  );

  React.useEffect(() => {
    const state = peerStateOf(captionStatus);
    if (state === sentPeerStateRef.current) return;
    sentPeerStateRef.current = state;
    announceCaptionState(state);
  }, [captionStatus, announceCaptionState]);

  const refreshPeerIssues = React.useCallback(() => {
    const issues: PeerCaptionIssue[] = [];
    for (const [identity, state] of peerStatesRef.current) {
      if (state !== 'failed') continue;
      const p = room.remoteParticipants.get(identity);
      issues.push({ identity, name: p?.name || identity });
    }
    setPeerCaptionIssues(issues);
  }, [room]);

  React.useEffect(() => {
    const onData = (payload: Uint8Array, participant?: { identity: string }, _kind?: unknown, topic?: string) => {
      if (topic !== CAPTION_STATUS_TOPIC || !participant) return;
      const state = parsePeerCaptionState(decoder.decode(payload));
      if (!state) return;
      peerStatesRef.current.set(participant.identity, state);
      refreshPeerIssues();
    };
    // Someone joining late (e.g. the host rejoining), or us coming back after a reconnect,
    // still learns that our captions are down.
    const reannounce = () => {
      if (sentPeerStateRef.current !== 'ok') announceCaptionState(sentPeerStateRef.current);
    };
    const onLeave = (participant: { identity: string }) => {
      if (peerStatesRef.current.delete(participant.identity)) refreshPeerIssues();
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, reannounce);
    room.on(RoomEvent.Connected, reannounce);
    room.on(RoomEvent.Reconnected, reannounce);
    room.on(RoomEvent.ParticipantDisconnected, onLeave);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantConnected, reannounce);
      room.off(RoomEvent.Connected, reannounce);
      room.off(RoomEvent.Reconnected, reannounce);
      room.off(RoomEvent.ParticipantDisconnected, onLeave);
    };
  }, [room, decoder, refreshPeerIssues, announceCaptionState]);

  // Captions off for the room: nobody's captions are "down" any more.
  React.useEffect(() => {
    if (captionsRunning) return;
    peerStatesRef.current.clear();
    setPeerCaptionIssues([]);
  }, [captionsRunning]);

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
      // A new spoken language takes effect at once: recognition restarts in it.
      const engine = rtasrRef.current;
      const speakLanguage = loadCaptionSettings(uiLanguage).speakLanguage;
      if (engine && engine.languageCode !== speakLanguage) {
        engine.languageCode = speakLanguage;
        supervisorRef.current?.retry(); // no-op unless recognition is running
      }
    };
    window.addEventListener(CAPTION_SETTINGS_EVENT, handleSettingsChange);
    return () => window.removeEventListener(CAPTION_SETTINGS_EVENT, handleSettingsChange);
  }, [uiLanguage]);

  // ── 开启/关闭字幕 ──────────────────────────────────────────────────────

  const setCaptionsOpen = React.useCallback(
    async (open: boolean) => {
      const seq = ++openSeqRef.current;
      if (open) {
        const provider = await resolveSttProvider();
        if (seq !== openSeqRef.current) return;
        if (!rtasrRef.current || providerRef.current !== provider) {
          supervisorRef.current?.dispose();
          const token = () => getTokenRef.current();
          const helper: CaptionEngine = provider === 'bailian' ? new FunAsrHelper(token) : new RtasrHelper(token);
          helper.languageCode = loadCaptionSettings(uiLanguage).speakLanguage;
          helper.roomName = room.name;
          micSourceRef.current = meetingMicSource(room);
          helper.micSource = micSourceRef.current;

          helper.OnMessage = async (d: RtasrMessage) => {
            // 使用 LiveKit 的 localParticipant（每个连接独立，不受同浏览器多 Tab 共享 localStorage 影响）
            const userId = room.localParticipant.identity;
            const userName = room.localParticipant.name || userId;

            const offsetSeconds = getMeetingOffsetSeconds();

            // Speak and read in the interface language unless caption settings say otherwise.
            const settings = loadCaptionSettings(uiLanguage);

            // STT 识别出的实际语种优先于用户设置（OpenAI 返回 ISO-639-1；若未返回则取设置值）
            const speakLanguage = d.detectedLanguage || settings.speakLanguage;
            const myReadLanguage = readLanguageRef.current;
            // Every reading language in the room (mine included) except the spoken one.
            const targets = speakLanguage === 'auto'
              ? []
              : translationTargets([myReadLanguage, ...peerLanguagesRef.current.values()], speakLanguage);

            const payload: CaptionPayload = {
              id: d.id,
              src: d.src,
              tp: d.type,
              userId,
              userName,
              offsetSeconds,
              speakLanguage,
              // Kept for clients that predate `translations`.
              defaultTargetLanguage: myReadLanguage,
            };

            // 仅最终句翻译，每种语言只翻一次；中间结果（type=1）每个 delta 都会回调，不能打翻译接口
            if (d.type === 0 && targets.length > 0) {
              const results = await Promise.allSettled(
                targets.map((lang) =>
                  withTimeout(translateText(d.src, lang, speakLanguage, getTokenRef.current()), TRANSLATE_TIMEOUT_MS).then(
                    (text) => [lang, text] as const,
                  ),
                ),
              );
              const translations: Record<string, string> = {};
              for (const r of results) {
                if (r.status === 'fulfilled' && r.value[1]) translations[r.value[0]] = r.value[1];
              }
              payload.translations = translations;
              payload.defaultTranslatedText = translations[myReadLanguage] || d.src;
            } else if (myReadLanguage === speakLanguage) {
              payload.defaultTranslatedText = d.src;
            }

            // 自己屏幕：需要翻译时不显示未翻译的中间结果；译文下方保留原文
            const mine = pickCaptionText(payload, myReadLanguage);
            if (settings.subtitleVisible) {
              if (mine.kind === 'original') {
                showCaptionsToGUI(payload);
              } else if (mine.kind === 'translated') {
                showCaptionsToGUI({ ...payload, src: mine.text }, myReadLanguage, d.src);
              } else if (d.type === 0) {
                showCaptionsToGUI(payload); // 翻译失败：至少显示原文
              }
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
          supervisorRef.current = new CaptionSupervisor(helper, setCaptionStatus);
          providerRef.current = provider;
          setEngineEpoch((n) => n + 1);
        } else {
          // 已有实例：用最新选择的说话语言
          rtasrRef.current.languageCode = loadCaptionSettings(uiLanguage).speakLanguage;
        }

        if (seq !== openSeqRef.current) return;
        setCaptionsRunning(true);
      } else {
        if (rtasrRef.current) {
          supervisorRef.current?.stop();
          setCaptionsRunning(false);
        }
        setCaptionsInfo((prev) => ({ ...prev, show: false }));
      }
    },
    [room, encoder, showCaptionsToGUI, uiLanguage],
  );

  // ── 组件卸载时清理 ─────────────────────────────────────────────────────

  React.useEffect(() => {
    return () => {
      if (rtasrRef.current) {
        supervisorRef.current?.dispose();
        supervisorRef.current = null;
        rtasrRef.current = null;
        providerRef.current = null;
      }
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  return {
    captionsInfo,
    setCaptionsOpen,
    captionsRunning,
    readLanguage,
    roomLanguages,
    setReadLanguage,
    captionStatus,
    retryCaptions,
    peerCaptionIssues,
  };
}
