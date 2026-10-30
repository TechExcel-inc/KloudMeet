'use client';

import React from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { LocalTrackPublication, LocalVideoTrack, Room } from 'livekit-client';
import {
  KLOUD_BACKGROUND_PROCESSOR,
  KloudBackgroundProcessor,
  VIDEO_BACKGROUND_EVENT,
  loadVideoBackground,
  saveVideoBackground,
  videoBackgroundsOffered,
  videoBackgroundsSupported,
  type VideoBackground,
  type VideoBackgroundStatus,
} from './videoBackground';
import { COMPANY_BACKGROUNDS_EVENT, refreshCompanyBackgrounds } from './companyBackgrounds';

export interface VideoBackgroundControls {
  /** Show the entry at all (not on phones). */
  offered: boolean;
  /** This browser can run it; otherwise the dialog explains why not. */
  supported: boolean;
  background: VideoBackground;
  status: VideoBackgroundStatus;
  changeBackground: (next: VideoBackground) => void;
  /** Run the current choice again after a failure. */
  retry: () => void;
  /** The camera while it's on (meeting only; the pre-join page passes its own preview). */
  cameraTrack?: LocalVideoTrack;
}

/** Puts `next` on the camera track. Never touches a processor that isn't ours. */
async function applyToTrack(
  track: LocalVideoTrack | undefined,
  processor: KloudBackgroundProcessor | undefined,
  next: VideoBackground,
) {
  const current = track?.getProcessor();
  if (next === 'none') {
    if (track && current?.name === KLOUD_BACKGROUND_PROCESSOR) await track.stopProcessor();
    return;
  }
  if (!processor) return;
  await processor.setBackground(next);
  if (!track || current === processor) return;
  if (current && current.name !== KLOUD_BACKGROUND_PROCESSOR) return;
  await track.setProcessor(processor);
}

function useSavedBackground(supported: boolean) {
  const [background, setBackground] = React.useState<VideoBackground>('none');
  React.useEffect(() => {
    if (!supported) return;
    setBackground(loadVideoBackground());
    // Changed elsewhere: the other picker, the processor falling back when an image is gone, or the
    // company's backgrounds arriving (their default or "company only" rule can change the choice).
    const sync = () => setBackground(loadVideoBackground());
    window.addEventListener(VIDEO_BACKGROUND_EVENT, sync);
    window.addEventListener(COMPANY_BACKGROUNDS_EVENT, sync);
    void refreshCompanyBackgrounds();
    return () => {
      window.removeEventListener(VIDEO_BACKGROUND_EVENT, sync);
      window.removeEventListener(COMPANY_BACKGROUNDS_EVENT, sync);
    };
  }, [supported]);
  return [background, setBackground] as const;
}

/**
 * In the meeting. The camera starts with the saved background because VideoConferenceComponent
 * puts our processor in the room's capture defaults; this hook switches it while the meeting runs
 * and keeps those defaults in step, so a camera turned on later starts with the same choice.
 */
export function useRoomVideoBackground(room: Room | undefined): VideoBackgroundControls {
  const offered = React.useMemo(() => videoBackgroundsOffered(), []);
  const supported = React.useMemo(() => videoBackgroundsSupported(), []);
  const [background, setBackground] = useSavedBackground(supported);
  const [status, setStatus] = React.useState<VideoBackgroundStatus>('idle');
  const [cameraTrack, setCameraTrack] = React.useState<LocalVideoTrack | undefined>();
  const processorRef = React.useRef<KloudBackgroundProcessor | null>(null);
  const queueRef = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    if (!room) return;
    const sync = () => {
      const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
      setCameraTrack(
        publication?.track && !publication.isMuted ? (publication.track as LocalVideoTrack) : undefined,
      );
    };
    sync();
    const events = [
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
    ] as const;
    events.forEach((event) => room.on(event, sync));
    return () => {
      events.forEach((event) => room.off(event, sync));
    };
  }, [room]);

  // The processor the room started the camera with, so its progress and failures show here.
  React.useEffect(() => {
    const existing = room?.options.videoCaptureDefaults?.processor;
    if (existing instanceof KloudBackgroundProcessor) {
      processorRef.current = existing;
      existing.setListener(setStatus);
    }
    return () => processorRef.current?.setListener(undefined);
  }, [room]);

  /** What the camera was last set to, so company changes only re-apply when they change it. */
  const appliedRef = React.useRef<VideoBackground | null>(null);

  const run = React.useCallback(
    (next: VideoBackground) => {
      if (!room || !supported) return;
      appliedRef.current = next;
      // One change at a time, in order: quick clicks never race two pipelines onto the track.
      queueRef.current = queueRef.current
        .then(async () => {
          const defaults = (room.options.videoCaptureDefaults ??= {});
          const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as
            | LocalVideoTrack
            | undefined;
          if (next === 'none') {
            defaults.processor = undefined;
            await applyToTrack(track, processorRef.current ?? undefined, 'none');
            setStatus('idle');
            return;
          }
          if (!processorRef.current) {
            processorRef.current = new KloudBackgroundProcessor(next);
            processorRef.current.setListener(setStatus);
          }
          defaults.processor = processorRef.current;
          await applyToTrack(track, processorRef.current, next);
        })
        .catch((error) => {
          console.warn('[KloudMeet] camera background', error);
          setStatus('failed');
        });
    },
    [room, supported],
  );

  const changeBackground = React.useCallback(
    (next: VideoBackground) => {
      setBackground(next);
      saveVideoBackground(next);
      run(next);
    },
    [run, setBackground],
  );

  const retry = React.useCallback(() => {
    const current = loadVideoBackground();
    if (current === 'none') return;
    // A failed pipeline is rebuilt from scratch on the next attach.
    const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track as
      | LocalVideoTrack
      | undefined;
    queueRef.current = queueRef.current
      .then(async () => {
        if (track?.getProcessor()?.name === KLOUD_BACKGROUND_PROCESSOR) await track.stopProcessor();
      })
      .catch(() => undefined);
    run(current);
  }, [room, run]);

  // The company's backgrounds arrived or changed: their default or "company only" rule may now
  // pick a different background than the one the camera started with.
  React.useEffect(() => {
    if (!room || !supported) return;
    const started = room.options.videoCaptureDefaults?.processor;
    appliedRef.current ??= started instanceof KloudBackgroundProcessor ? started.currentBackground : 'none';
    const onCompany = () => {
      const next = loadVideoBackground();
      if (next !== appliedRef.current) run(next);
    };
    window.addEventListener(COMPANY_BACKGROUNDS_EVENT, onCompany);
    return () => window.removeEventListener(COMPANY_BACKGROUNDS_EVENT, onCompany);
  }, [room, supported, run]);

  // A camera published without it (rebuilt after a device loss, say): put the background back.
  React.useEffect(() => {
    if (!room || !supported) return;
    const onPublished = (publication: LocalTrackPublication) => {
      if (publication.source !== Track.Source.Camera) return;
      const saved = loadVideoBackground();
      if (saved !== 'none' && !publication.track?.getProcessor()) run(saved);
    };
    room.on(RoomEvent.LocalTrackPublished, onPublished);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, onPublished);
    };
  }, [room, supported, run]);

  return { offered, supported, background, status, changeBackground, retry, cameraTrack };
}

/**
 * On the pre-join page: the saved background on the preview camera, so people choose it before
 * anyone sees them. Each preview track gets its own processor (a device switch makes a new track
 * and stops the old one, which tears its processor down).
 */
export function usePreviewVideoBackground(
  track: LocalVideoTrack | undefined,
): VideoBackgroundControls {
  const offered = React.useMemo(() => videoBackgroundsOffered(), []);
  const supported = React.useMemo(() => videoBackgroundsSupported(), []);
  const [background, setBackground] = useSavedBackground(supported);
  const [status, setStatus] = React.useState<VideoBackgroundStatus>('idle');
  const [attempt, setAttempt] = React.useState(0);
  const processorRef = React.useRef<{ track: LocalVideoTrack; processor: KloudBackgroundProcessor } | null>(
    null,
  );
  const queueRef = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    if (!supported) return;
    if (!track) {
      setStatus('idle');
      return;
    }
    queueRef.current = queueRef.current
      .then(async () => {
        if (background === 'none') {
          await applyToTrack(track, undefined, 'none');
          setStatus('idle');
          return;
        }
        if (processorRef.current?.track !== track) {
          processorRef.current?.processor.setListener(undefined);
          processorRef.current = { track, processor: new KloudBackgroundProcessor(background, setStatus) };
        }
        await applyToTrack(track, processorRef.current.processor, background);
      })
      .catch((error) => {
        console.warn('[KloudMeet] preview background', error);
        setStatus('failed');
      });
  }, [track, background, supported, attempt]);

  React.useEffect(() => () => processorRef.current?.processor.setListener(undefined), []);

  const changeBackground = React.useCallback(
    (next: VideoBackground) => {
      setBackground(next);
      saveVideoBackground(next);
    },
    [setBackground],
  );

  const retry = React.useCallback(() => {
    const entry = processorRef.current;
    queueRef.current = queueRef.current
      .then(async () => {
        if (entry && entry.track.getProcessor() === entry.processor) await entry.track.stopProcessor();
      })
      .catch(() => undefined);
    setAttempt((n) => n + 1);
  }, []);

  return { offered, supported, background, status, changeBackground, retry };
}
