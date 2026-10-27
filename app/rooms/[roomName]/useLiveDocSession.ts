import React from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import {
  bindLivedocToMeeting,
  createLivedocInstance,
  createOrUpdateInstantAccount,
  keepLivedocInstanceActive,
  syncLivedocLessonMember,
} from '@/lib/livedoc/client';
import type { ConnectionDetails } from '@/lib/types';

export interface LiveDocSessionOptions {
  room: Room;
  livekitConnected: boolean;
  meetingEndedByHost: boolean;
  isHost: boolean;
  isRecorderBot: boolean;
  shouldMountLiveDoc: boolean;
  shouldDisplayLiveDoc: boolean;
  isMirrorBlocked: boolean;
  jitsiInstanceId: string;
  meetingRoomName: string;
  username: string;
  livedocInstanceId: string | null;
  setLivedocInstanceId: React.Dispatch<React.SetStateAction<string | null>>;
  setLivedocInitError: React.Dispatch<React.SetStateAction<string | null>>;
  setLivedocInitInProgress: React.Dispatch<React.SetStateAction<boolean>>;
  livedocHasBeenActivated: boolean;
  setLivedocHasBeenActivated: React.Dispatch<React.SetStateAction<boolean>>;
  connectionDetailsRef: React.MutableRefObject<ConnectionDetails>;
  sendMeetingMsg: (msg: object, destinationIdentities?: string[]) => void;
  /** 主持人权威状态里的 livedocInstanceId，创建/保活成功后写回 */
  setAuthLivedocInstanceId: (id: string) => void;
}

/**
 * useLiveDocSession — LiveDoc 实例创建、参会者注册、保活与后台预热
 *
 * 主持人入会后建 instance 并广播；全员注册 LessonMember；15s 保活；
 * 入会后延迟预热 iframe，避免点 AI 才冷启动。
 */
export function useLiveDocSession({
  room,
  livekitConnected,
  meetingEndedByHost,
  isHost,
  isRecorderBot,
  shouldMountLiveDoc,
  shouldDisplayLiveDoc,
  isMirrorBlocked,
  jitsiInstanceId,
  meetingRoomName,
  username,
  livedocInstanceId,
  setLivedocInstanceId,
  setLivedocInitError,
  setLivedocInitInProgress,
  livedocHasBeenActivated,
  setLivedocHasBeenActivated,
  connectionDetailsRef,
  sendMeetingMsg,
  setAuthLivedocInstanceId,
}: LiveDocSessionOptions): void {
  const livedocHostBootstrappedRef = React.useRef(false);
  const livedocMemberSyncedRef = React.useRef<string | null>(null);
  const aliveRef = React.useRef(true);
  const bootRef = React.useRef({
    username,
    jitsiInstanceId,
    meetingRoomName,
    livedocInstanceId,
    sendMeetingMsg,
    setLivedocInstanceId,
    setLivedocInitError,
    setLivedocInitInProgress,
    setAuthLivedocInstanceId,
    connectionDetailsRef,
  });
  bootRef.current = {
    username,
    jitsiInstanceId,
    meetingRoomName,
    livedocInstanceId,
    sendMeetingMsg,
    setLivedocInstanceId,
    setLivedocInitError,
    setLivedocInitInProgress,
    setAuthLivedocInstanceId,
    connectionDetailsRef,
  };

  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    const onDisconnected = () => {
      livedocHostBootstrappedRef.current = false;
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  React.useEffect(() => {
    if (shouldDisplayLiveDoc || isMirrorBlocked) {
      setLivedocHasBeenActivated(true);
    }
  }, [shouldDisplayLiveDoc, isMirrorBlocked, setLivedocHasBeenActivated]);

  React.useEffect(() => {
    if (!livekitConnected || meetingEndedByHost || isRecorderBot) return;
    if (livedocHasBeenActivated) return;

    const WARMUP_DELAY_MS = 1200;
    let delayTimer: number | undefined;
    let idleHandle: number | undefined;

    const warm = () => {
      setLivedocHasBeenActivated(true);
    };

    delayTimer = window.setTimeout(() => {
      const ric = (
        window as Window & {
          requestIdleCallback?: (
            cb: IdleRequestCallback,
            opts?: IdleRequestOptions,
          ) => number;
        }
      ).requestIdleCallback;
      if (typeof ric === 'function') {
        idleHandle = ric(() => warm(), { timeout: 2500 });
      } else {
        warm();
      }
    }, WARMUP_DELAY_MS);

    return () => {
      if (delayTimer !== undefined) window.clearTimeout(delayTimer);
      const cic = (
        window as Window & {
          cancelIdleCallback?: (id: number) => void;
        }
      ).cancelIdleCallback;
      if (idleHandle !== undefined && typeof cic === 'function') {
        cic(idleHandle);
      }
    };
  }, [
    livekitConnected,
    meetingEndedByHost,
    isRecorderBot,
    livedocHasBeenActivated,
    setLivedocHasBeenActivated,
  ]);

  React.useEffect(() => {
    if (!shouldMountLiveDoc) return;
    if (!livekitConnected || !isHost) return;
    // 先占位再发请求。父组件一重渲染就会重跑 effect，请求还没回来时旧逻辑会再打一次 create。
    if (livedocHostBootstrappedRef.current) return;
    livedocHostBootstrappedRef.current = true;

    const boot = bootRef.current;
    const existing = boot.livedocInstanceId;
    if (existing) {
      boot.setAuthLivedocInstanceId(existing);
      boot.sendMeetingMsg({ type: 'LIVEDOC_INSTANCE', livedocInstanceId: existing });
      return;
    }

    void (async () => {
      boot.setLivedocInitInProgress(true);
      boot.setLivedocInitError(null);
      try {
        const userToken = await createOrUpdateInstantAccount(boot.username);
        const id = await createLivedocInstance({
          userToken,
          jitsiInstanceId: boot.jitsiInstanceId,
        });
        if (!aliveRef.current) return;
        boot.setLivedocInstanceId(id);
        boot.setAuthLivedocInstanceId(id);
        boot.sendMeetingMsg({ type: 'LIVEDOC_INSTANCE', livedocInstanceId: id });
        try {
          await bindLivedocToMeeting({
            roomName: boot.meetingRoomName,
            livedocInstanceId: id,
            livekitToken: boot.connectionDetailsRef.current.participantToken,
          });
        } catch (bindError) {
          console.warn('[LiveDoc] bind-livedoc failed', bindError);
        }
        try {
          await syncLivedocLessonMember({ userToken, livedocInstanceId: id });
        } catch (syncError) {
          console.warn('[LiveDoc] sync-member failed', syncError);
        }
      } catch (e) {
        if (!aliveRef.current) return;
        boot.setLivedocInitError((e as Error).message ?? String(e));
      } finally {
        if (aliveRef.current) boot.setLivedocInitInProgress(false);
      }
    })();
  }, [shouldMountLiveDoc, livekitConnected, isHost]);

  React.useEffect(() => {
    if (!livekitConnected || meetingEndedByHost || !livedocInstanceId) return;
    if (livedocMemberSyncedRef.current === livedocInstanceId) return;
    let cancelled = false;
    (async () => {
      try {
        const userToken = await createOrUpdateInstantAccount(username);
        if (cancelled) return;
        await syncLivedocLessonMember({ userToken, livedocInstanceId });
        if (!cancelled) {
          livedocMemberSyncedRef.current = livedocInstanceId;
        }
      } catch (error) {
        console.warn('[LiveDoc] attendee sync-member failed:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [livekitConnected, meetingEndedByHost, livedocInstanceId, username]);

  React.useEffect(() => {
    if (!livekitConnected || meetingEndedByHost || !livedocInstanceId) return;

    let cancelled = false;
    let inFlight = false;

    const keepAlive = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const userToken = await createOrUpdateInstantAccount(username);
        const id = await keepLivedocInstanceActive({
          userToken,
          jitsiInstanceId,
          livedocInstanceId,
        });
        if (!cancelled && id && id !== livedocInstanceId) {
          setLivedocInstanceId(id);
          if (isHost) {
            setAuthLivedocInstanceId(id);
            sendMeetingMsg({ type: 'LIVEDOC_INSTANCE', livedocInstanceId: id });
          }
        }
      } catch (error) {
        console.warn('[LiveDoc keepalive] failed:', error);
      } finally {
        inFlight = false;
      }
    };

    const LIVEDOC_KEEPALIVE_INTERVAL_MS = 15000;
    keepAlive();
    const interval = setInterval(keepAlive, LIVEDOC_KEEPALIVE_INTERVAL_MS);
    const keepAliveOnResume = () => {
      if (document.hidden) return;
      keepAlive();
    };
    window.addEventListener('online', keepAlive);
    document.addEventListener('visibilitychange', keepAliveOnResume);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('online', keepAlive);
      document.removeEventListener('visibilitychange', keepAliveOnResume);
    };
  }, [
    livekitConnected,
    meetingEndedByHost,
    livedocInstanceId,
    jitsiInstanceId,
    username,
    isHost,
    sendMeetingMsg,
    setLivedocInstanceId,
    setAuthLivedocInstanceId,
  ]);
}
