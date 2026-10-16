'use client';

import React from 'react';
import type { Room } from 'livekit-client';
import {
  SPEAK_ACTIVITY_PATH,
  SPEAK_BATCH_MAX,
  type SpeakInterval,
} from '@/lib/recordingSpeakActivity';

const SAMPLE_MS = 150;
/** 同一人静音超过该间隔即结束当前区间 */
const GAP_MS = 400;
const FLUSH_MS = 3000;
/** 上报持续失败时最多保留的区间数，超出丢弃最旧的 */
const PENDING_MAX = 5000;
/** sendBeacon / keepalive 单次请求体约 64KB 上限 */
const BEACON_CHUNK = 200;

interface OpenInterval {
  identity: string;
  name: string;
  startMs: number;
  lastMs: number;
  sum: number;
  count: number;
  peak: number;
}

function toInterval(item: OpenInterval): SpeakInterval {
  return {
    identity: item.identity,
    name: item.name,
    startMs: item.startMs,
    endMs: item.lastMs,
    avgLevel: item.sum / item.count,
    peakLevel: item.peak,
  };
}

/**
 * 录制机器人专用：采样远端参会者的说话状态与音量，合并成区间后批量上报。
 * token 为空时不采集。
 */
export function useSpeakActivityRecorder(room: Room, token: string | null): void {
  React.useEffect(() => {
    if (!token) return;
    const open = new Map<string, OpenInterval>();
    let pending: SpeakInterval[] = [];
    let sending = false;

    const enqueue = (items: SpeakInterval[]) => {
      pending = items.concat(pending);
      if (pending.length > PENDING_MAX) pending = pending.slice(pending.length - PENDING_MAX);
    };

    const body = (intervals: SpeakInterval[]) =>
      JSON.stringify({ token, intervals });

    const sample = () => {
      const now = Date.now();
      for (const participant of room.remoteParticipants.values()) {
        if (!participant.isSpeaking) continue;
        const level = participant.audioLevel;
        const name = participant.name || participant.identity;
        const current = open.get(participant.identity);
        if (current) {
          current.lastMs = now;
          current.sum += level;
          current.count += 1;
          current.peak = Math.max(current.peak, level);
          current.name = name;
          continue;
        }
        open.set(participant.identity, {
          identity: participant.identity,
          name,
          startMs: now,
          lastMs: now,
          sum: level,
          count: 1,
          peak: level,
        });
      }
      for (const [identity, item] of open) {
        if (now - item.lastMs <= GAP_MS) continue;
        pending.push(toInterval(item));
        open.delete(identity);
      }
    };

    const flush = async () => {
      if (sending || pending.length === 0) return;
      const batch = pending.splice(0, SPEAK_BATCH_MAX);
      sending = true;
      try {
        const res = await fetch(SPEAK_ACTIVITY_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body(batch),
        });
        // 404：录制记录可能尚未写库；5xx：服务端暂时失败。两者都稍后重试
        if (res.status === 404 || res.status >= 500) enqueue(batch);
      } catch (err) {
        enqueue(batch);
        console.warn('[useSpeakActivityRecorder] upload failed', err);
      } finally {
        sending = false;
      }
    };

    const flushFinal = () => {
      for (const item of open.values()) pending.push(toInterval(item));
      open.clear();
      while (pending.length > 0) {
        const chunk = pending.splice(0, BEACON_CHUNK);
        const blob = new Blob([body(chunk)], { type: 'application/json' });
        if (navigator.sendBeacon(SPEAK_ACTIVITY_PATH, blob)) continue;
        void fetch(SPEAK_ACTIVITY_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body(chunk),
          keepalive: true,
        }).catch((err: unknown) => {
          console.warn('[useSpeakActivityRecorder] final upload failed', err);
        });
      }
    };

    const sampler = setInterval(sample, SAMPLE_MS);
    const flusher = setInterval(() => void flush(), FLUSH_MS);
    window.addEventListener('pagehide', flushFinal);
    return () => {
      clearInterval(sampler);
      clearInterval(flusher);
      window.removeEventListener('pagehide', flushFinal);
      flushFinal();
    };
  }, [room, token]);
}
