'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import type { LocalUserChoices } from '@livekit/components-react';
import { ArrowLeft, LoaderCircle, Mic, MicOff, Users, Video, VideoOff } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { appendKloudDeviceId } from '@/lib/kloudDeviceId';
import { connectionDetailsFetchInit } from '@/lib/kloudSession';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { getInitials } from '@/lib/getInitials';
import {
  appendJoinCredentials,
  cancelKnock,
  fetchMeetingAccess,
  pollKnock,
  sendKnock,
  type MeetingAccessState,
} from '@/lib/meetingAccessClient';
import type { ConnectionDetails } from '@/lib/types';
import { loadMediaPrefs, saveMediaPrefs, type TvMediaPrefs } from '@/lib/tv/deviceIdentity';
import { lookupMeeting } from '@/lib/tv/meetingLookup';
import type { TvRoomActions, TvRoomHooks, TvRoomSnapshot } from '@/lib/tv/tvRoomBridge';
import { VideoConferenceComponent } from '@/app/rooms/[roomName]/VideoConferenceComponent';
import { useTvCommands, useTvShell } from '../../TvShell';
import { focusDefault } from '../../useSpatialNav';
import { TvStage } from '../../../components/TvStage';
import { TvBrand, TvClock, TvKeyLegend } from '../../../components/TvChrome';
import { TvMeetingOverlay } from './TvMeetingOverlay';
import styles from '@/styles/Tv.module.css';

type Phase =
  | { kind: 'checking' }
  | { kind: 'error'; reason: 'notFound' | 'ended' | 'network' | 'signIn' | 'notInvited' | 'denied' }
  | { kind: 'prejoin' }
  | { kind: 'waitingForHost' }
  | { kind: 'knocking' }
  | { kind: 'connecting' }
  | { kind: 'meeting'; details: ConnectionDetails; choices: LocalUserChoices };

interface MeetingInfo {
  roomName: string;
  title: string | null;
  createdByMemberId: number | null;
}

/** Camera / mic the TV has, and a live preview while the pre-join screen is up. */
function useTvPreview(enabled: boolean, prefs: TvMediaPrefs) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [hasCam, setHasCam] = React.useState<boolean | null>(null);
  const [hasMic, setHasMic] = React.useState<boolean | null>(null);
  const [level, setLevel] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    let raf = 0;
    let ctx: AudioContext | null = null;
    (async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const cam = list.some((d) => d.kind === 'videoinput');
        const mic = list.some((d) => d.kind === 'audioinput');
        if (cancelled) return;
        setHasCam(cam);
        setHasMic(mic);
        if (!cam && !mic) return;
        stream = await navigator.mediaDevices.getUserMedia({
          video: cam && prefs.cam ? (prefs.videoDeviceId ? { deviceId: { ideal: prefs.videoDeviceId } } : true) : false,
          audio: mic && prefs.mic ? (prefs.audioDeviceId ? { deviceId: { ideal: prefs.audioDeviceId } } : true) : false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) videoRef.current.srcObject = stream;
        if (stream.getAudioTracks().length) {
          ctx = new AudioContext();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          ctx.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const v of data) sum += ((v - 128) / 128) ** 2;
            setLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
            raf = requestAnimationFrame(tick);
          };
          tick();
        }
      } catch {
        if (!cancelled) {
          setHasCam((v) => v ?? false);
          setHasMic((v) => v ?? false);
        }
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => undefined);
      stream?.getTracks().forEach((t) => t.stop());
      setLevel(0);
    };
  }, [enabled, prefs.cam, prefs.mic, prefs.videoDeviceId, prefs.audioDeviceId]);

  return { videoRef, hasCam, hasMic, level };
}

export function TvRoom({ roomName: rawRoomName }: { roomName: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const shell = useTvShell();
  const [phase, setPhase] = React.useState<Phase>({ kind: 'checking' });
  const [info, setInfo] = React.useState<MeetingInfo | null>(null);
  const [access, setAccess] = React.useState<MeetingAccessState | null>(null);
  const [prefs, setPrefs] = React.useState<TvMediaPrefs>(() => ({ mic: true, cam: true }));
  React.useEffect(() => setPrefs(loadMediaPrefs()), []);
  const roomName = info?.roomName ?? rawRoomName;
  const knockingRef = React.useRef(false);
  const aliveRef = React.useRef(true);
  React.useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  const preview = useTvPreview(phase.kind === 'prejoin' || phase.kind === 'waitingForHost' || phase.kind === 'knocking', prefs);
  const camOn = prefs.cam && preview.hasCam !== false;
  const micOn = prefs.mic && preview.hasMic !== false;

  const updatePrefs = (patch: Partial<TvMediaPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      saveMediaPrefs(next);
      return next;
    });
  };

  // ── 1. Find the meeting and what it lets this TV do ──
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const code = decodeURIComponent(rawRoomName);
      const found = await lookupMeeting(code);
      if (cancelled) return;
      if (!found.ok) {
        setPhase({ kind: 'error', reason: found.reason });
        return;
      }
      setInfo({ roomName: found.roomName, title: found.title, createdByMemberId: found.createdByMemberId });
      const acc = await fetchMeetingAccess(found.roomName);
      if (cancelled) return;
      setAccess(acc);
      if (acc?.decision === 'sign_in') setPhase({ kind: 'error', reason: 'signIn' });
      else if (acc?.decision === 'refused') setPhase({ kind: 'error', reason: acc.reason === 'DENIED' ? 'denied' : 'notInvited' });
      else setPhase({ kind: 'prejoin' });
    })();
    return () => {
      cancelled = true;
    };
  }, [rawRoomName]);

  const title = info?.title || access?.meeting.title || roomName;

  // ── 2. Join: knock if needed, wait for the host if needed, then get a ticket ──
  const join = React.useCallback(async () => {
    if (!info) return;
    const choices: LocalUserChoices = {
      username: shell.identity.name,
      audioEnabled: micOn,
      videoEnabled: camOn,
      audioDeviceId: prefs.audioDeviceId ?? 'default',
      videoDeviceId: prefs.videoDeviceId ?? 'default',
    };

    if (access?.decision === 'knock' && !knockingRef.current) {
      knockingRef.current = true;
      setPhase({ kind: 'knocking' });
      const first = await sendKnock(info.roomName, shell.identity.name);
      let status = first.status;
      if (first.tooSoonMs || status === 'DENIED') {
        knockingRef.current = false;
        setPhase({ kind: 'error', reason: 'denied' });
        return;
      }
      // Polls until someone in the meeting answers (null: knocking isn't needed after all)
      while (aliveRef.current && knockingRef.current && status === 'PENDING') {
        await new Promise((r) => setTimeout(r, 2500));
        const polled = await pollKnock(info.roomName);
        status = polled?.status ?? status;
      }
      if (status === 'DENIED' || status === 'CANCELED') {
        knockingRef.current = false;
        if (aliveRef.current) setPhase({ kind: 'error', reason: 'denied' });
        return;
      }
      if (!aliveRef.current || !knockingRef.current) return;
      knockingRef.current = false;
    }

    setPhase({ kind: 'connecting' });
    for (;;) {
      const url = new URL('/api/connection-details', window.location.origin);
      url.searchParams.set('roomName', info.roomName);
      url.searchParams.set('participantName', shell.identity.name);
      appendKloudDeviceId(url);
      appendJoinCredentials(url);
      let res: Response;
      try {
        res = await fetchWithTimeout(url.toString(), connectionDetailsFetchInit(), 15_000);
      } catch {
        setPhase({ kind: 'error', reason: 'network' });
        return;
      }
      if (!aliveRef.current) return;
      if (res.status === 403) {
        const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
        if (body?.code === 'NOT_STARTED') {
          setPhase({ kind: 'waitingForHost' });
          // Wait until the host starts, then ask for a ticket again
          for (;;) {
            await new Promise((r) => setTimeout(r, 3000));
            if (!aliveRef.current) return;
            const acc = await fetchMeetingAccess(info.roomName);
            if (acc?.started) break;
          }
          setPhase({ kind: 'connecting' });
          continue;
        }
        if (body?.code === 'KNOCK_REQUIRED') {
          const acc = await fetchMeetingAccess(info.roomName);
          setAccess(acc);
          setPhase({ kind: 'prejoin' });
          return;
        }
        if (body?.code === 'SIGN_IN_REQUIRED') return setPhase({ kind: 'error', reason: 'signIn' });
        if (body?.code === 'NOT_INVITED') return setPhase({ kind: 'error', reason: 'notInvited' });
        if (body?.code === 'DENIED') return setPhase({ kind: 'error', reason: 'denied' });
        return setPhase({ kind: 'error', reason: 'ended' });
      }
      if (!res.ok) {
        setPhase({ kind: 'error', reason: res.status === 404 ? 'notFound' : 'network' });
        return;
      }
      const details = (await res.json()) as ConnectionDetails;
      shell.addRecent(details.roomName, info.title);
      setPhase({ kind: 'meeting', details, choices });
      return;
    }
  }, [info, access, shell, micOn, camOn, prefs.audioDeviceId, prefs.videoDeviceId]);

  const goHome = React.useCallback(() => {
    if (knockingRef.current && info) cancelKnock(info.roomName);
    knockingRef.current = false;
    router.push('/tv');
  }, [info, router]);

  // ── The meeting itself ──
  const actionsRef = React.useRef<TvRoomActions | null>(null);
  const [snapshot, setSnapshot] = React.useState<TvRoomSnapshot | null>(null);
  const joinedAtRef = React.useRef(Date.now());
  const tvHooks = React.useMemo<TvRoomHooks>(
    () => ({ actionsRef, onSnapshot: setSnapshot, exitPath: '/tv' }),
    [],
  );

  // What the phone remote sees
  React.useEffect(() => {
    const base = { pendingCode: roomName, pendingTitle: title };
    switch (phase.kind) {
      case 'checking':
        shell.report({ screen: 'checking', ...base });
        break;
      case 'error':
        shell.report({ screen: 'refused', ...base });
        break;
      case 'prejoin':
      case 'waitingForHost':
      case 'knocking':
      case 'connecting':
        shell.report({ screen: phase.kind, ...base });
        break;
      default:
        break;
    }
    if (phase.kind !== 'meeting') setTimeout(() => focusDefault());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, roomName, title]);

  // Remote / voice commands before the meeting starts (the overlay takes over after)
  useTvCommands((cmd) => {
    if (phase.kind === 'meeting') return false;
    switch (cmd.type) {
      case 'mic':
        updatePrefs({ mic: cmd.on ?? !prefs.mic });
        return true;
      case 'cam':
        updatePrefs({ cam: cmd.on ?? !prefs.cam });
        return true;
      case 'confirm':
        if (phase.kind === 'prejoin') void join();
        return true;
      case 'cancel':
      case 'leave':
      case 'home':
        goHome();
        return true;
      case 'key':
        if (cmd.key === 'back') {
          goHome();
          return true;
        }
        return false;
      case 'join':
        router.push(`/tv/rooms/${encodeURIComponent(cmd.code)}`);
        return true;
      default:
        return false;
    }
  });

  if (phase.kind === 'meeting') {
    return (
      <div className={styles.meetingRoot}>
        <div data-lk-theme="default" className={styles.meetingStage}>
          <VideoConferenceComponent
            connectionDetails={phase.details}
            userChoices={phase.choices}
            meetingOwnerMemberId={info?.createdByMemberId != null ? String(info.createdByMemberId) : null}
            meetingTitle={title}
            options={{ codec: 'h264', hq: false }}
            tv={tvHooks}
          />
        </div>
        <TvMeetingOverlay
          actionsRef={actionsRef}
          snapshot={snapshot}
          code={phase.details.roomName}
          title={title}
          joinedAt={joinedAtRef.current}
        />
      </div>
    );
  }

  return (
    <TvStage>
      <div className={styles.screen}>
        <header className={styles.topBar}>
          <TvBrand name={shell.identity.name} />
          <TvClock />
        </header>

        {phase.kind === 'checking' && (
          <div className={styles.centerState}>
            <LoaderCircle className={styles.spin} size={72} />
            <p className={styles.stateTitle}>{t('tv.room.finding')}</p>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className={styles.centerState}>
            <p className={styles.stateTitle}>{t(`tv.room.err.${phase.reason}`)}</p>
            <p className={styles.stateBody}>{t(`tv.room.err.${phase.reason}Body`)}</p>
            <div className={styles.stateActions}>
              <button
                type="button"
                className={styles.btnPrimary}
                data-tv-autofocus
                onClick={() => router.push(`/tv?screen=join&code=${encodeURIComponent(decodeURIComponent(rawRoomName))}`)}
              >
                {t('tv.room.tryAnother')}
              </button>
              <button type="button" className={styles.btnSecondary} onClick={goHome}>
                {t('tv.home')}
              </button>
            </div>
          </div>
        )}

        {(phase.kind === 'prejoin' || phase.kind === 'waitingForHost' || phase.kind === 'knocking' || phase.kind === 'connecting') && (
          <main className={styles.prejoinGrid}>
            <section className={styles.previewCol}>
              <div className={styles.preview}>
                {camOn ? (
                  <video ref={preview.videoRef} className={styles.previewVideo} autoPlay muted playsInline />
                ) : (
                  <div className={styles.previewOff}>
                    <span className={styles.previewInitials}>{getInitials(shell.identity.name)}</span>
                    <span className={styles.previewOffText}>
                      {preview.hasCam === false ? t('tv.prejoin.noCamera') : t('tv.prejoin.camOff')}
                    </span>
                  </div>
                )}
                <span className={styles.previewName}>{shell.identity.name}</span>
                {micOn && (
                  <span className={styles.previewLevel} aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <span key={i} style={{ transform: `scaleY(${0.25 + Math.min(1, preview.level * (1.4 - i * 0.3))})` }} />
                    ))}
                  </span>
                )}
              </div>
              <div className={styles.deviceToggles}>
                <button
                  type="button"
                  className={`${styles.roundToggle} ${micOn ? styles.roundLive : styles.roundOff}`}
                  disabled={preview.hasMic === false}
                  onClick={() => updatePrefs({ mic: !prefs.mic })}
                  aria-pressed={micOn}
                  aria-label={micOn ? t('tv.fb.micOff') : t('tv.fb.micOn')}
                >
                  {micOn ? <Mic size={40} /> : <MicOff size={40} />}
                </button>
                <button
                  type="button"
                  className={`${styles.roundToggle} ${camOn ? styles.roundLive : styles.roundOff}`}
                  disabled={preview.hasCam === false}
                  onClick={() => updatePrefs({ cam: !prefs.cam })}
                  aria-pressed={camOn}
                  aria-label={camOn ? t('tv.fb.camOff') : t('tv.fb.camOn')}
                >
                  {camOn ? <Video size={40} /> : <VideoOff size={40} />}
                </button>
              </div>
            </section>

            <section className={styles.joinCol}>
              <p className={styles.eyebrow}>{roomName}</p>
              <h1 className={styles.meetingTitle}>{title}</h1>
              {access?.meeting.hostName && (
                <p className={styles.metaLine}>
                  {t('tv.prejoin.host', { name: access.meeting.hostName })}
                  {access.meeting.companyName ? ` · ${access.meeting.companyName}` : ''}
                </p>
              )}
              {typeof access?.meeting.participantCount === 'number' && (
                <p className={styles.metaLine}>
                  <Users size={28} />
                  {access.meeting.participantCount > 1
                    ? t('tv.prejoin.inMeeting', { n: access.meeting.participantCount })
                    : access.meeting.participantCount === 1
                      ? t('tv.prejoin.inMeetingOne')
                      : t('tv.prejoin.empty')}
                </p>
              )}

              {phase.kind === 'prejoin' && (
                <>
                  <p className={styles.joinAs}>{t('tv.prejoin.joinAs', { name: shell.identity.name })}</p>
                  {access?.decision === 'knock' && <p className={styles.metaNote}>{t('tv.prejoin.knockNote')}</p>}
                  <div className={styles.joinActions}>
                    <button type="button" className={styles.btnPrimaryLg} data-tv-autofocus onClick={() => void join()}>
                      {access?.decision === 'knock' ? t('tv.prejoin.ask') : t('tv.prejoin.join')}
                    </button>
                    <button type="button" className={styles.btnSecondary} onClick={goHome}>
                      <ArrowLeft size={28} />
                      {t('common.cancel')}
                    </button>
                  </div>
                </>
              )}

              {phase.kind !== 'prejoin' && (
                <div className={styles.waitBox} role="status">
                  <LoaderCircle className={styles.spin} size={48} />
                  <div>
                    <p className={styles.waitTitle}>
                      {phase.kind === 'waitingForHost'
                        ? t('tv.prejoin.waitHost')
                        : phase.kind === 'knocking'
                          ? t('tv.prejoin.knocking')
                          : t('tv.prejoin.connecting')}
                    </p>
                    <p className={styles.waitBody}>
                      {phase.kind === 'waitingForHost'
                        ? t('tv.prejoin.waitHostBody')
                        : phase.kind === 'knocking'
                          ? t('tv.prejoin.knockingBody')
                          : ''}
                    </p>
                  </div>
                  <button type="button" className={styles.btnSecondary} data-tv-autofocus onClick={goHome}>
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </section>
          </main>
        )}
        <TvKeyLegend voice />
      </div>
    </TvStage>
  );
}
