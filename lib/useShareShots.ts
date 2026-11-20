'use client';

import React from 'react';
import { Track, type Room } from 'livekit-client';
import {
  frameChanged,
  grayOf,
  SHOT_DIFF_H,
  SHOT_DIFF_W,
  SHOT_LOOK_MS,
  SHOT_JPEG_Q,
  SHOT_MAX_W,
} from '@/lib/shareShot';

/**
 * useShareShots — AI Notes Only 时，由正在共享的这台电脑抓画面
 *
 * 本地每秒看一眼。和上一张已经抓过的比，没有变化不上传。
 * 画面还在动就先等它停稳，停稳后再抓一张。
 *
 * @param room     当前房间
 * @param enabled  正在用 AI Notes Only 录、没有暂停、并且本地正在共享
 * @param token    参会 token，用来把图交给服务器
 * @param roomName 房间名
 */
export function useShareShots(room: Room, enabled: boolean, token: string, roomName: string): void {
  React.useEffect(() => {
    if (!enabled || !token || !roomName) return;

    const diff = document.createElement('canvas');
    diff.width = SHOT_DIFF_W;
    diff.height = SHOT_DIFF_H;
    const shot = document.createElement('canvas');
    let video: HTMLVideoElement | null = null;
    let attached: MediaStreamTrack | null = null;
    let sent: Uint8Array | null = null;
    let seen: Uint8Array | null = null;
    let stopped = false;
    let sending = false;

    const ensureVideo = (media: MediaStreamTrack): HTMLVideoElement => {
      if (video && attached === media) return video;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
      attached = media;
      sent = null;
      seen = null;
      const el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      el.srcObject = new MediaStream([media]);
      void el.play().catch(() => undefined);
      video = el;
      return el;
    };

    const endShare = () => {
      const url = `/api/meetings/${encodeURIComponent(roomName)}/screen-shot?end=1`;
      void fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => undefined);
    };

    const tick = async () => {
      const media = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack;
      if (stopped || sending || !media || media.readyState !== 'live') return;
      const frame = ensureVideo(media);
      if (frame.readyState < 2 || frame.videoWidth < 2) return;
      const dctx = diff.getContext('2d', { willReadFrequently: true });
      if (!dctx) return;
      dctx.drawImage(frame, 0, 0, SHOT_DIFF_W, SHOT_DIFF_H);
      const gray = grayOf(dctx.getImageData(0, 0, SHOT_DIFF_W, SHOT_DIFF_H).data, SHOT_DIFF_W, SHOT_DIFF_H);
      const changed = frameChanged(sent, gray);
      const moving = frameChanged(seen, gray);
      seen = gray;
      if (!changed || moving || sending) return;
      sent = gray;
      sending = true;
      try {
        const scale = Math.min(1, SHOT_MAX_W / frame.videoWidth);
        shot.width = Math.max(1, Math.round(frame.videoWidth * scale));
        shot.height = Math.max(1, Math.round(frame.videoHeight * scale));
        const sctx = shot.getContext('2d');
        if (!sctx) return;
        sctx.drawImage(frame, 0, 0, shot.width, shot.height);
        const blob = await new Promise<Blob | null>((resolve) => shot.toBlob(resolve, 'image/jpeg', SHOT_JPEG_Q));
        if (!blob || stopped) return;
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' };
        const url = `/api/meetings/${encodeURIComponent(roomName)}/screen-shot`;
        await fetch(url, { method: 'POST', headers, body: blob }).catch(() => null);
      } finally {
        sending = false;
      }
    };

    const id = window.setInterval(() => void tick(), SHOT_LOOK_MS);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(id);
      video?.pause();
      if (video) video.srcObject = null;
      endShare();
    };
  }, [room, enabled, token, roomName]);
}
