import React from 'react';
import { useRouter } from 'next/navigation';
import {
  ConnectionState,
  DisconnectReason,
  RoomEvent,
  Track,
  type Participant,
  type Room,
  type RoomConnectOptions,
  type LocalTrackPublication,
  type TrackPublication,
} from 'livekit-client';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { handleKloudSessionExpired } from '@/lib/handleKloudSessionExpired';
import { appendKloudDeviceId } from '@/lib/kloudDeviceId';
import { authHeaders, connectionDetailsFetchInit } from '@/lib/kloudSession';
import { isMeetingEnded, setMeetingClosedNotice } from '@/lib/meetingClosedNotice';
import { isDbMeetingOwner } from '@/lib/meetingOwner';
import { classifyScreenShareFailure } from '@/lib/screenShareFailure';
import { replaceBrowserRoomUrl } from '@/lib/roomUrl';
import { unlockMobileRoomAudio } from '@/lib/mobileAudioUnlock';
import { isToolbarMobileUserAgent } from '@/lib/useToolbarIsMobile';
import {
  isLiveKitAuthError,
  isLiveKitParticipantTokenReusable,
  LIVEKIT_TOKEN_RENEW_MIN_DELAY_MS,
  msUntilLiveKitTokenRenew,
} from '@/lib/livekitToken';
import {
  classifyLiveKitFailure,
  isKloudSessionExpiredError,
  logSeriousLiveKitFailure,
} from '@/lib/livekitConnectionFailure';
import { useI18n } from '@/lib/i18n';
import type { ConnectionDetails } from '@/lib/types';
import type { ViewMode } from '@/lib/KloudMeetToolbar';
import {
  CONN_DETAILS_ENDPOINT,
  CONNECTION_DETAILS_TIMEOUT_MS,
  ENCRYPTION_ERROR_PREFIX,
  MEETING_CLOSED_ERROR,
  RECONNECT_FRESH_TOKEN_ATTEMPT,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_SERIOUS_LOG_EVERY,
  RECONNECT_WATCHDOG_MS,
  SCREEN_SHARE_CAPTURE,
  TOKEN_REFRESH_RETRY_MS,
} from './roomConstants';
import { publishMic } from './roomMedia';

export interface MeetingConnectionOptions {
  room: Room;
  /** E2EE 密钥写完后才允许首次 connect */
  e2eeSetupComplete: boolean;
  connectOptions: RoomConnectOptions;
  connectionDetails: ConnectionDetails;
  region?: string;
  username: string;
  videoDeviceId?: string;
  audioDeviceId?: string;
  meetingOwnerMemberId?: string | null;
  desiredMicRef: React.MutableRefObject<boolean>;
  desiredCamRef: React.MutableRefObject<boolean>;
  localMicRestrictedRef: React.MutableRefObject<boolean>;
  localCamRestrictedRef: React.MutableRefObject<boolean>;
  beginLocalScreenShareView: () => void;
  endLocalScreenShareView: () => ViewMode | null;
  setActiveView: React.Dispatch<React.SetStateAction<ViewMode>>;
  setScreenShareActive: React.Dispatch<React.SetStateAction<boolean>>;
  setMicEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setCanPlaybackAudio: React.Dispatch<React.SetStateAction<boolean>>;
  setShowMeetingReadyModal: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface MeetingConnectionApi {
  connectError: string | null;
  setConnectError: React.Dispatch<React.SetStateAction<string | null>>;
  meetingEndedByHost: boolean;
  evictedByDuplicateSession: boolean;
  removedFromMeeting: boolean;
  reconnectInFlightRef: React.MutableRefObject<boolean>;
  connectionDetailsRef: React.MutableRefObject<ConnectionDetails>;
  screenShareRestorePendingRef: React.MutableRefObject<boolean>;
  hostEndedHandledRef: React.MutableRefObject<boolean>;
  intentionalDisconnectRef: React.MutableRefObject<boolean>;
  duplicateSessionHandledRef: React.MutableRefObject<boolean>;
  setEvictedByDuplicateSession: React.Dispatch<React.SetStateAction<boolean>>;
  hostEndedRedirectTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  markIntentionalDisconnect: () => void;
  clearActiveKloudRoom: () => void;
  handleClosedByHostExit: () => void;
  handleRemovedFromMeeting: () => void;
  rejoinAfterDuplicateSession: () => void;
  /** 连接错误弹窗上的「重新入会」 */
  rejoinManually: () => void;
  handleError: (error: Error) => void;
  showScreenShareFailureToast: (error: unknown, restore?: boolean) => void;
}

/**
 * useMeetingConnection — 入会、断线重连、后台换票与连接错误态
 *
 * 首次 E2EE 就绪后发起连接；失败无限重试（1s 起步翻倍，封顶 10s + 抖动）。
 * 被移出 / 被顶号 / 会议结束 / 登录失效进入终止态，不再自动重连。
 */
export function useMeetingConnection({
  room,
  e2eeSetupComplete,
  connectOptions,
  connectionDetails,
  region,
  username,
  videoDeviceId,
  audioDeviceId,
  meetingOwnerMemberId,
  desiredMicRef,
  desiredCamRef,
  localMicRestrictedRef,
  localCamRestrictedRef,
  beginLocalScreenShareView,
  endLocalScreenShareView,
  setActiveView,
  setScreenShareActive,
  setMicEnabled,
  setCanPlaybackAudio,
  setShowMeetingReadyModal,
}: MeetingConnectionOptions): MeetingConnectionApi {
  const { t } = useI18n();
  const tRef = React.useRef(t);
  tRef.current = t;
  const router = useRouter();

  const connectAttemptedRef = React.useRef(false);
  /** 当前连续失败轮次，连上后清零；决定退避时长与是否换票 */
  const reconnectAttemptRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 同一时刻只允许一个 connect 尝试 */
  const reconnectInFlightRef = React.useRef(false);
  /** 下一轮必须换新票（上次 JWT 被拒 / 被顶号后重新接管） */
  const reconnectFreshRef = React.useRef(false);
  /** 终止状态：主动离开、会议结束、登录失效等，不再自动重连 */
  const intentionalDisconnectRef = React.useRef(false);
  const hasConnectedOnceRef = React.useRef(false);
  const connectionDetailsRef = React.useRef(connectionDetails);
  React.useEffect(() => {
    connectionDetailsRef.current = connectionDetails;
  }, [connectionDetails]);
  const connectOptionsRef = React.useRef(connectOptions);
  React.useEffect(() => {
    connectOptionsRef.current = connectOptions;
  }, [connectOptions]);
  const [connectError, setConnectError] = React.useState<string | null>(null);
  const [meetingEndedByHost, setMeetingEndedByHost] = React.useState(false);
  const [evictedByDuplicateSession, setEvictedByDuplicateSession] = React.useState(false);
  const [removedFromMeeting, setRemovedFromMeeting] = React.useState(false);
  const duplicateSessionHandledRef = React.useRef(false);
  const removedFromMeetingHandledRef = React.useRef(false);
  const hostEndedHandledRef = React.useRef(false);
  const hostEndedRedirectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Last LiveKit DisconnectReason name for serious-failure RCA logs. */
  const lastDisconnectReasonRef = React.useRef<string | undefined>(undefined);
  /**
   * Local screen share was active — restore after reconnect.
   * Set on publish; cleared on intentional stop or after restore attempt.
   */
  const screenShareRestorePendingRef = React.useRef(false);
  /** Coalesce concurrent /api/connection-details calls (avoids self-revoking JWTs). */
  const refreshConnectionDetailsInFlightRef = React.useRef<Promise<ConnectionDetails> | null>(null);

  const clearActiveKloudRoom = React.useCallback(() => {
    try {
      sessionStorage.removeItem('activeKloudRoom');
    } catch {
      /* ignore */
    }
  }, []);

  const clearReconnectTimer = React.useCallback(() => {
    if (!reconnectTimerRef.current) return;
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const refreshConnectionDetails = React.useCallback(async (): Promise<ConnectionDetails> => {
    if (refreshConnectionDetailsInFlightRef.current) {
      return refreshConnectionDetailsInFlightRef.current;
    }

    const run = (async (): Promise<ConnectionDetails> => {
      const participantName =
        connectionDetailsRef.current.participantName || username || 'Guest';
      const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
      url.searchParams.append('roomName', connectionDetailsRef.current.roomName);
      url.searchParams.append('participantName', participantName);
      appendKloudDeviceId(url);
      if (region) {
        url.searchParams.append('region', region);
      }

      const response = await fetchWithTimeout(
        url.toString(),
        connectionDetailsFetchInit({ cache: 'no-store' }),
        CONNECTION_DETAILS_TIMEOUT_MS,
      );
      if (response.status === 401) {
        handleKloudSessionExpired();
        throw new Error('Session expired');
      }
      if (response.status === 403 || response.status === 404) {
        const closed = new Error(`Meeting closed (${response.status}): ${await response.text()}`);
        closed.name = MEETING_CLOSED_ERROR;
        throw closed;
      }
      if (!response.ok) {
        throw new Error(
          `Could not refresh connection details (${response.status}): ${await response.text()}`,
        );
      }

      const fresh = (await response.json()) as ConnectionDetails;
      connectionDetailsRef.current = fresh;
      return fresh;
    })();

    refreshConnectionDetailsInFlightRef.current = run;
    try {
      return await run;
    } finally {
      if (refreshConnectionDetailsInFlightRef.current === run) {
        refreshConnectionDetailsInFlightRef.current = null;
      }
    }
  }, [region, username]);

  /**
   * Prefer the current LiveKit JWT when it is still reusable.
   * Mint a new ticket only when forced (auth/revoked/renew) or when expiry is near.
   */
  const ensureConnectionDetails = React.useCallback(
    async (opts?: { forceRefresh?: boolean }): Promise<ConnectionDetails> => {
      const current = connectionDetailsRef.current;
      if (
        !opts?.forceRefresh &&
        current?.participantToken &&
        isLiveKitParticipantTokenReusable(current.participantToken)
      ) {
        return current;
      }
      if (opts?.forceRefresh && current) {
        connectionDetailsRef.current = { ...current, participantToken: '' };
      }
      return refreshConnectionDetails();
    },
    [refreshConnectionDetails],
  );

  const connectRoom = React.useCallback(
    async (opts?: { forceRefresh?: boolean }) => {
      const cd = await ensureConnectionDetails(opts);
      return room.connect(cd.serverUrl, cd.participantToken, connectOptionsRef.current);
    },
    [ensureConnectionDetails, room],
  );

  const showScreenShareFailureToast = React.useCallback((error: unknown, restore = false) => {
    const failure = classifyScreenShareFailure(error);
    if (!failure || typeof document === 'undefined') return;
    const reason =
      failure.kind === 'unknown'
        ? failure.detail || tRef.current('meeting.screenShareReason.unknownFallback')
        : tRef.current(`meeting.screenShareReason.${failure.kind}`);
    const toastEl = document.createElement('div');
    toastEl.textContent = tRef.current(
      restore ? 'meeting.screenShareRestoreFailedReason' : 'meeting.screenShareFailed',
      { reason },
    );
    toastEl.style.cssText =
      'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(239,68,68,0.95);color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:99999;pointer-events:none;max-width:82vw;text-align:center;';
    document.body.appendChild(toastEl);
    setTimeout(() => toastEl.remove(), 4500);
  }, []);

  /** Re-request getDisplayMedia after renew/reconnect when we were sharing. */
  const restoreScreenShareAfterReconnect = React.useCallback(async () => {
    if (!screenShareRestorePendingRef.current) return;
    if (isToolbarMobileUserAgent()) {
      screenShareRestorePendingRef.current = false;
      const restored = endLocalScreenShareView();
      if (restored) setActiveView(restored);
      return;
    }
    try {
      await room.localParticipant.setScreenShareEnabled(true, SCREEN_SHARE_CAPTURE);
      setScreenShareActive(true);
      beginLocalScreenShareView();
      console.warn('[KloudMeet] Screen share restored after reconnect');
    } catch (e: unknown) {
      screenShareRestorePendingRef.current = false;
      setScreenShareActive(false);
      const restored = endLocalScreenShareView();
      if (restored) setActiveView(restored);
      console.warn(
        '[KloudMeet] Screen share restore failed (browser may require a user gesture):',
        e instanceof Error ? e.message : e,
      );
      showScreenShareFailureToast(e, true);
    }
  }, [
    room,
    showScreenShareFailureToast,
    beginLocalScreenShareView,
    endLocalScreenShareView,
    setActiveView,
    setScreenShareActive,
  ]);

  const restoreLocalMediaAfterReconnect = React.useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoIds = new Set(
        devices.filter((d) => d.kind === 'videoinput').map((d) => d.deviceId),
      );
      const audioIds = new Set(
        devices.filter((d) => d.kind === 'audioinput').map((d) => d.deviceId),
      );
      const wantedVideo = videoDeviceId;
      if (wantedVideo && !videoIds.has(wantedVideo)) {
        room.options.videoCaptureDefaults = {
          ...room.options.videoCaptureDefaults,
          deviceId: undefined,
        };
      }
      const wantedAudio = audioDeviceId;
      if (wantedAudio && !audioIds.has(wantedAudio)) {
        room.options.audioCaptureDefaults = {
          ...room.options.audioCaptureDefaults,
          deviceId: undefined,
        };
      }
    } catch {
      /* proceed with defaults */
    }
    const wantCam = desiredCamRef.current && !localCamRestrictedRef.current;
    await room.localParticipant.setCameraEnabled(wantCam).catch(() => undefined);
    if (desiredMicRef.current && !localMicRestrictedRef.current) {
      setMicEnabled(await publishMic(room));
    } else {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
    }
    if (isToolbarMobileUserAgent()) {
      void unlockMobileRoomAudio(room).then((ok) => setCanPlaybackAudio(ok));
    }
    await restoreScreenShareAfterReconnect();
  }, [
    videoDeviceId,
    audioDeviceId,
    room,
    restoreScreenShareAfterReconnect,
    desiredCamRef,
    desiredMicRef,
    localCamRestrictedRef,
    localMicRestrictedRef,
    setMicEnabled,
    setCanPlaybackAudio,
  ]);

  const markIntentionalDisconnect = React.useCallback(() => {
    intentionalDisconnectRef.current = true;
    clearReconnectTimer();
    if (hostEndedRedirectTimerRef.current) {
      clearTimeout(hostEndedRedirectTimerRef.current);
      hostEndedRedirectTimerRef.current = null;
    }
  }, [clearReconnectTimer]);

  const handleClosedByHostExit = React.useCallback(() => {
    if (hostEndedHandledRef.current) return;
    if (isDbMeetingOwner(meetingOwnerMemberId, room.localParticipant.metadata)) {
      hostEndedHandledRef.current = true;
      intentionalDisconnectRef.current = true;
      return;
    }
    hostEndedHandledRef.current = true;
    intentionalDisconnectRef.current = true;

    clearReconnectTimer();
    setConnectError(null);
    reconnectAttemptRef.current = 0;

    setMeetingClosedNotice(t('meeting.closedByHostToast'));
    setMeetingEndedByHost(true);
    clearActiveKloudRoom();
    try {
      localStorage.removeItem('activeMeetingId');
      localStorage.removeItem('activeMeetingStartedAt');
    } catch {
      /* ignore */
    }

    if (room.state !== ConnectionState.Disconnected) {
      room.disconnect().catch(console.error);
    }

    if (hostEndedRedirectTimerRef.current) {
      clearTimeout(hostEndedRedirectTimerRef.current);
    }
    hostEndedRedirectTimerRef.current = setTimeout(() => {
      router.push('/');
    }, 2200);
  }, [
    room,
    router,
    t,
    meetingOwnerMemberId,
    clearActiveKloudRoom,
    clearReconnectTimer,
  ]);

  /** Host/co-host 将本端移出会议 */
  const handleRemovedFromMeeting = React.useCallback(() => {
    if (removedFromMeetingHandledRef.current) return;
    removedFromMeetingHandledRef.current = true;
    intentionalDisconnectRef.current = true;

    clearReconnectTimer();
    setConnectError(null);
    setRemovedFromMeeting(true);
    clearActiveKloudRoom();
    try {
      localStorage.removeItem('activeMeetingId');
      localStorage.removeItem('activeMeetingStartedAt');
    } catch {
      /* ignore */
    }

    if (room.state !== ConnectionState.Disconnected) {
      room.disconnect().catch(console.error);
    }

    setTimeout(() => {
      router.push('/');
    }, 2500);
  }, [room, router, clearActiveKloudRoom, clearReconnectTimer]);

  /** 下一轮退避：1s 起步翻倍、封顶 10s，叠加 ±20% 抖动，避免多人同时断网后同一时刻挤进服务端 */
  const computeBackoffMs = React.useCallback((attempt: number): number => {
    const base = Math.min(RECONNECT_MAX_DELAY_MS, 1000 * 2 ** Math.max(0, attempt - 1));
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }, []);

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isReconnectBlocked = React.useCallback(
    (): boolean =>
      !mountedRef.current ||
      intentionalDisconnectRef.current ||
      duplicateSessionHandledRef.current ||
      removedFromMeetingHandledRef.current,
    [],
  );

  const handleFirstConnected = React.useCallback(() => {
    const rn = connectionDetails.roomName;
    replaceBrowserRoomUrl(rn);

    const isMeetingOwner = isDbMeetingOwner(
      meetingOwnerMemberId,
      room.localParticipant.metadata,
    );
    const wasRefresh =
      typeof window !== 'undefined' &&
      sessionStorage.getItem('activeKloudRoom') ===
        window.location.pathname.split('/').filter(Boolean).pop();
    if (isMeetingOwner && !wasRefresh) {
      setShowMeetingReadyModal(true);
    }

    const canAutoCopyMeetingUrl =
      typeof window !== 'undefined' &&
      typeof document !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.clipboard &&
      document.hasFocus();
    if (canAutoCopyMeetingUrl) {
      navigator.clipboard.writeText(window.location.href).catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== 'NotAllowedError') {
          console.warn('Failed to auto-copy meeting URL:', error);
        }
      });
    }

    if (isMeetingOwner) {
      fetch(`/api/meetings/${rn}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ actualStartedAt: new Date().toISOString() }),
      }).catch((e) => console.warn('[meeting start fallback] failed', e));
    }
  }, [connectionDetails.roomName, meetingOwnerMemberId, room, setShowMeetingReadyModal]);

  const scheduleReconnectRef = React.useRef<(opts?: { immediate?: boolean }) => void>(
    () => undefined,
  );

  /**
   * runReconnect — 执行一次连接尝试（首次入会与断线重连共用）
   *
   * 失败后自动排下一轮，不设次数上限，直到连上或进入终止状态。
   * 已入会后的重连会先确认会议未结束，避免 LiveKit 自动重建已结束的房间。
   */
  const runReconnect = React.useCallback(async (): Promise<void> => {
    if (reconnectInFlightRef.current || isReconnectBlocked()) return;
    if (room.state !== ConnectionState.Disconnected) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      scheduleReconnectRef.current();
      return;
    }

    reconnectInFlightRef.current = true;
    connectAttemptedRef.current = true;
    clearReconnectTimer();
    const attempt = reconnectAttemptRef.current + 1;
    reconnectAttemptRef.current = attempt;
    const firstConnect = !hasConnectedOnceRef.current;

    try {
      const roomName = connectionDetailsRef.current?.roomName;
      if (!firstConnect && roomName) {
        const ended = await isMeetingEnded(roomName, attempt === 1 ? 4 : 1);
        if (ended) {
          if (!isDbMeetingOwner(meetingOwnerMemberId, room.localParticipant.metadata)) {
            handleClosedByHostExit();
            return;
          }
          reconnectFreshRef.current = true;
        }
      }
      if (isReconnectBlocked()) return;

      const forceRefresh =
        reconnectFreshRef.current || attempt >= RECONNECT_FRESH_TOKEN_ATTEMPT;
      await connectRoom({ forceRefresh });

      reconnectAttemptRef.current = 0;
      reconnectFreshRef.current = false;
      if (firstConnect) handleFirstConnected();
      hasConnectedOnceRef.current = true;
      setConnectError(null);
      try {
        const rn = connectionDetailsRef.current.roomName;
        if (rn) sessionStorage.setItem('activeKloudRoom', rn);
      } catch {
        /* ignore */
      }
      if (attempt > 1 || !firstConnect) {
        console.warn(`[KloudMeet] LiveKit connected after ${attempt} attempt(s)`);
      }
      await restoreLocalMediaAfterReconnect();
      return;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (isKloudSessionExpiredError(error)) {
        intentionalDisconnectRef.current = true;
        return;
      }
      if (error.name === MEETING_CLOSED_ERROR) {
        handleClosedByHostExit();
        intentionalDisconnectRef.current = true;
        return;
      }
      if (isLiveKitAuthError(error)) {
        reconnectFreshRef.current = true;
      }
      console.warn(`[KloudMeet] LiveKit connect attempt ${attempt} failed:`, error.message);
      if (attempt % RECONNECT_SERIOUS_LOG_EVERY === 0) {
        logSeriousLiveKitFailure({
          phase: 'recovery',
          attempt,
          maxAttempts: 0,
          roomName: connectionDetailsRef.current?.roomName,
          roomState: room.state,
          disconnectReason: lastDisconnectReasonRef.current,
          authFail: isLiveKitAuthError(error),
          failureKind: classifyLiveKitFailure(error),
          participantToken: connectionDetailsRef.current?.participantToken,
          error,
          extra: { firstConnect },
        });
      }
    } finally {
      reconnectInFlightRef.current = false;
    }
    scheduleReconnectRef.current();
  }, [
    clearReconnectTimer,
    connectRoom,
    handleClosedByHostExit,
    handleFirstConnected,
    isReconnectBlocked,
    meetingOwnerMemberId,
    restoreLocalMediaAfterReconnect,
    room,
  ]);

  /**
   * scheduleReconnect — 排下一轮重连（已连接 / 连接中 / 已有尝试在进行时忽略）
   *
   * @param opts.immediate  立即尝试（断线瞬间、网络恢复、标签页回到前台），会顶掉正在等待的退避
   */
  const scheduleReconnect = React.useCallback(
    (opts?: { immediate?: boolean }) => {
      if (isReconnectBlocked()) return;
      if (room.state !== ConnectionState.Disconnected) return;
      if (reconnectInFlightRef.current) return;
      if (reconnectTimerRef.current) {
        if (!opts?.immediate) return;
        clearReconnectTimer();
      }
      const delay = opts?.immediate ? 0 : computeBackoffMs(reconnectAttemptRef.current + 1);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void runReconnect();
      }, delay);
    },
    [clearReconnectTimer, computeBackoffMs, isReconnectBlocked, room, runReconnect],
  );
  scheduleReconnectRef.current = scheduleReconnect;

  React.useEffect(() => {
    if (!e2eeSetupComplete || connectAttemptedRef.current) return;
    if (room.state !== ConnectionState.Disconnected) {
      console.warn('[LiveKit] Room already connected, skipping connect()');
      return;
    }
    void runReconnect();
  }, [e2eeSetupComplete, room, runReconnect]);

  React.useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (hostEndedRedirectTimerRef.current) clearTimeout(hostEndedRedirectTimerRef.current);
      if (room.state !== ConnectionState.Disconnected) {
        room.disconnect().catch(console.error);
        connectAttemptedRef.current = false;
      }
    };
  }, [room]);

  const handleError = React.useCallback((error: Error) => {
    if (isKloudSessionExpiredError(error)) {
      return;
    }
    if (
      error.name === 'NotAllowedError' ||
      error.message?.toLowerCase().includes('permission') ||
      error.message?.toLowerCase().includes('notallowed')
    ) {
      console.warn('User cancelled or denied media request:', error);
      return;
    }
    const DEVICE_ERRORS = [
      'notfounderror',
      'requested device',
      'device not found',
      'overconstrained',
      'notreadableerror',
      'could not start',
      'getusermedia',
      'enumeratedevices',
      'mediadevices',
      'cannot read properties of undefined',
    ];
    const msg = error?.message?.toLowerCase() ?? '';
    const name = error?.name?.toLowerCase() ?? '';
    if (DEVICE_ERRORS.some((k) => msg.includes(k) || name.includes(k))) {
      console.warn('[KloudMeet] Media device unavailable, user may switch in settings:', error.message);
      return;
    }
    console.warn('[KloudMeet] LiveKit error:', error.message);
    if (!connectAttemptedRef.current) return;
    scheduleReconnectRef.current();
  }, []);

  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error('[KloudMeet] Encryption error:', error);
    setConnectError(`${ENCRYPTION_ERROR_PREFIX}${error.message}`);
  }, []);

  React.useEffect(() => {
    const handleUnexpectedDisconnected = (reason?: DisconnectReason) => {
      if (reason !== undefined && reason !== null) {
        lastDisconnectReasonRef.current = DisconnectReason[reason] ?? String(reason);
      }
      console.warn(
        '[KloudMeet] Disconnected. reason=',
        lastDisconnectReasonRef.current,
        'intentional=',
        intentionalDisconnectRef.current,
      );
      if (intentionalDisconnectRef.current) return;
      if (
        reason === DisconnectReason.PARTICIPANT_REMOVED ||
        reason === DisconnectReason.DUPLICATE_IDENTITY
      ) {
        intentionalDisconnectRef.current = true;
        clearReconnectTimer();
        clearActiveKloudRoom();
        try {
          localStorage.removeItem('activeMeetingId');
          localStorage.removeItem('activeMeetingStartedAt');
        } catch {
          /* ignore */
        }
        if (removedFromMeetingHandledRef.current) {
          setRemovedFromMeeting(true);
          setTimeout(() => router.push('/'), 2500);
          return;
        }
        duplicateSessionHandledRef.current = true;
        setEvictedByDuplicateSession(true);
        return;
      }
      if (!hasConnectedOnceRef.current) return;
      scheduleReconnectRef.current({ immediate: true });
    };
    room.on(RoomEvent.Disconnected, handleUnexpectedDisconnected);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);
    return () => {
      room.off(RoomEvent.Disconnected, handleUnexpectedDisconnected);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [room, router, handleError, handleEncryptionError, clearActiveKloudRoom, clearReconnectTimer]);

  const rejoinAfterDuplicateSession = React.useCallback(() => {
    void (async () => {
      clearReconnectTimer();
      if (room.state !== ConnectionState.Disconnected) {
        await room.disconnect().catch(() => undefined);
      }
      duplicateSessionHandledRef.current = false;
      setEvictedByDuplicateSession(false);
      intentionalDisconnectRef.current = false;
      reconnectAttemptRef.current = 0;
      reconnectFreshRef.current = true;
      setConnectError(null);
      console.warn('[KloudMeet] Rejoin after session moved — taking over from this tab');
      await runReconnect();
    })();
  }, [clearReconnectTimer, room, runReconnect]);

  const rejoinManually = React.useCallback(() => {
    setConnectError(null);
    intentionalDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    reconnectFreshRef.current = true;
    clearReconnectTimer();
    console.warn('[KloudMeet] Manual rejoin');
    void runReconnect();
  }, [clearReconnectTimer, runReconnect]);

  React.useEffect(() => {
    const onLocalPub = (pub: { source?: Track.Source }) => {
      if (pub.source === Track.Source.ScreenShare) {
        screenShareRestorePendingRef.current = true;
      }
    };
    const onLocalUnpub = (pub: { source?: Track.Source }) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      if (reconnectInFlightRef.current || intentionalDisconnectRef.current) {
        return;
      }
      if (room.state !== ConnectionState.Connected) {
        return;
      }
      screenShareRestorePendingRef.current = false;
    };
    room.on(RoomEvent.LocalTrackPublished, onLocalPub);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalUnpub);
    if (room.localParticipant.isScreenShareEnabled) {
      screenShareRestorePendingRef.current = true;
    }
    return () => {
      room.off(RoomEvent.LocalTrackPublished, onLocalPub);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalUnpub);
    };
  }, [room]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const schedule = (delayMs?: number) => {
      if (timer) clearTimeout(timer);
      if (cancelled) return;
      const waitMs =
        delayMs ?? msUntilLiveKitTokenRenew(connectionDetailsRef.current.participantToken);
      if (waitMs == null) return;
      timer = setTimeout(() => {
        void refresh();
      }, Math.max(waitMs, LIVEKIT_TOKEN_RENEW_MIN_DELAY_MS));
    };

    const refresh = async (): Promise<void> => {
      if (cancelled || isReconnectBlocked()) return;
      try {
        await refreshConnectionDetails();
        schedule();
      } catch (err: unknown) {
        if (isKloudSessionExpiredError(err)) return;
        console.warn(
          '[KloudMeet] Background token refresh failed, retrying:',
          err instanceof Error ? err.message : err,
        );
        schedule(TOKEN_REFRESH_RETRY_MS);
      }
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshConnectionDetails, isReconnectBlocked]);

  React.useEffect(() => {
    const kick = (immediate: boolean) => {
      if (!connectAttemptedRef.current) return;
      scheduleReconnectRef.current({ immediate });
    };
    const handleOnline = () => kick(true);
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      kick(true);
    };
    const watchdog = window.setInterval(() => kick(false), RECONNECT_WATCHDOG_MS);

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(watchdog);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  React.useEffect(() => {
    const setDesired = (source: Track.Source, on: boolean) => {
      if (source === Track.Source.Microphone) desiredMicRef.current = on;
      if (source === Track.Source.Camera) desiredCamRef.current = on;
    };
    const onMuted = (pub: TrackPublication, participant: Participant) => {
      if (participant !== room.localParticipant) return;
      setDesired(pub.source, false);
    };
    const onUnmuted = (pub: TrackPublication, participant: Participant) => {
      if (participant !== room.localParticipant) return;
      setDesired(pub.source, true);
    };
    const onPublished = (pub: LocalTrackPublication) => {
      if (pub.isMuted) return;
      setDesired(pub.source, true);
    };
    room.on(RoomEvent.TrackMuted, onMuted);
    room.on(RoomEvent.TrackUnmuted, onUnmuted);
    room.on(RoomEvent.LocalTrackPublished, onPublished);
    return () => {
      room.off(RoomEvent.TrackMuted, onMuted);
      room.off(RoomEvent.TrackUnmuted, onUnmuted);
      room.off(RoomEvent.LocalTrackPublished, onPublished);
    };
  }, [room, desiredMicRef, desiredCamRef]);

  return {
    connectError,
    setConnectError,
    meetingEndedByHost,
    evictedByDuplicateSession,
    removedFromMeeting,
    reconnectInFlightRef,
    connectionDetailsRef,
    screenShareRestorePendingRef,
    hostEndedHandledRef,
    intentionalDisconnectRef,
    duplicateSessionHandledRef,
    setEvictedByDuplicateSession,
    hostEndedRedirectTimerRef,
    markIntentionalDisconnect,
    clearActiveKloudRoom,
    handleClosedByHostExit,
    handleRemovedFromMeeting,
    rejoinAfterDuplicateSession,
    rejoinManually,
    handleError,
    showScreenShareFailureToast,
  };
}
