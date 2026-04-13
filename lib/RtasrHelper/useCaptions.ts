'use client';

/**
 * useCaptions.ts — 会议实时字幕 React Hook
 *
 * 替代 Vue 版中的 SetCaptionsInfo / ShowCaptions2GUI 方法。
 *
 * 用法：
 *   const { captionsInfo, setCaptionsOpen } = useCaptions({ room, micEnabled });
 *
 * 字幕数据流：
 *   麦克风 → RtasrHelper → onMessage → publishData(LiveKit) → 所有参与者收到 → 渲染
 *
 * 字幕消息 topic：'kloud-caption'
 * 消息格式（JSON）：
 *   { type: 'caption', id, src, tp, userId, userName }
 */

import React from 'react';
import { RoomEvent } from 'livekit-client';
import type { Room } from 'livekit-client';
import { RtasrHelper } from './RtasrHelper';
import type { RtasrMessage } from './RtasrHelper';

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
}

export interface CaptionsInfo {
  /** 是否显示字幕区域 */
  show: boolean;
  /** 发言者姓名 */
  userName: string;
  /** 字幕内容 */
  text: string;
}

export interface UseCaptionsOptions {
  /** LiveKit Room 实例 */
  room: Room;
  /** 本地麦克风是否开启（关闭时自动停止识别） */
  micEnabled: boolean;
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

// ── Hook 实现 ─────────────────────────────────────────────────────────────

export function useCaptions({ room, micEnabled }: UseCaptionsOptions): UseCaptionsReturn {
  const [captionsInfo, setCaptionsInfo] = React.useState<CaptionsInfo>({
    show: false,
    userName: '',
    text: '',
  });
  const [captionsRunning, setCaptionsRunning] = React.useState(false);

  // 内部引用，避免 useCallback 过期闭包
  const rtasrRef = React.useRef<RtasrHelper | null>(null);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const micEnabledRef = React.useRef(micEnabled);
  micEnabledRef.current = micEnabled;

  // 文字编解码器
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
          // 从已连接参与者中查找显示名
          for (const [, p] of room.remoteParticipants) {
            if (p.identity === payload.userId) {
              return p.name || p.identity;
            }
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
      });

      hideTimerRef.current = setTimeout(() => {
        setCaptionsInfo((prev) => ({ ...prev, show: false }));
      }, CAPTION_HIDE_DELAY);
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
        showCaptionsToGUI(data);
      } catch (e) {
        console.error('[useCaptions] Failed to parse caption data', e);
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, decoder, showCaptionsToGUI]);

  // ── 当 mic 关闭时自动停止识别 ──────────────────────────────────────────

  React.useEffect(() => {
    if (!micEnabled && rtasrRef.current) {
      rtasrRef.current.Stop();
      setCaptionsRunning(false);
    }
  }, [micEnabled]);

  // ── 开启/关闭字幕 ──────────────────────────────────────────────────────

  const setCaptionsOpen = React.useCallback(
    async (open: boolean) => {
      if (open) {
        // 创建 RtasrHelper（若未初始化）
        if (!rtasrRef.current) {
          const helper = new RtasrHelper();

          helper.OnMessage = async (d: RtasrMessage) => {
            // 如果 mic 已被关闭，停止识别
            if (!micEnabledRef.current) {
              rtasrRef.current?.Stop();
              setCaptionsRunning(false);
              return;
            }

            // 从 localStorage 读取当前用户信息
            let userId = '';
            let userName = '';
            try {
              const stored = localStorage.getItem('kloudUser');
              if (stored) {
                const u = JSON.parse(stored);
                userId = u.id || u.username || '';
                userName = u.displayName || u.username || '';
              }
            } catch (_) { }

            // 也可使用 LiveKit participant identity 作为 fallback
            if (!userId) {
              userId = room.localParticipant.identity;
              userName = room.localParticipant.name || userId;
            }

            const payload: CaptionPayload = {
              id: d.id,
              src: d.src,
              tp: d.type,
              userId,
              userName,
            };

            // 本端直接显示（不等服务端回传）
            showCaptionsToGUI(payload);

            // 通过 LiveKit DataChannel 广播给所有参与者
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
          };

          helper.OnLog = (txt: string) => {
            console.log('[RtasrHelper]', txt);
          };

          rtasrRef.current = helper;
        }

        let serverId = 5;
        let speakingLangId = 0;

        rtasrRef.current.SetServerID(serverId);
        rtasrRef.current.SetSpeakingLanguageID(speakingLangId);

        // 读取用户选择的默认麦克风
        const defaultMic = localStorage.getItem('DefaultMic') || '';
        rtasrRef.current.Start(defaultMic);
        setCaptionsRunning(true);
      } else {
        // 关闭字幕
        if (rtasrRef.current) {
          rtasrRef.current.Stop();
          setCaptionsRunning(false);
        }
        setCaptionsInfo((prev) => ({ ...prev, show: false }));
      }
    },
    [room, encoder, showCaptionsToGUI],
  );

  // ── 组件卸载时清理 ─────────────────────────────────────────────────────

  React.useEffect(() => {
    return () => {
      if (rtasrRef.current) {
        rtasrRef.current.Stop();
        rtasrRef.current = null;
      }
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  return { captionsInfo, setCaptionsOpen, captionsRunning };
}
