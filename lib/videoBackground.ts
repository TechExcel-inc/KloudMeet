/**
 * Camera backgrounds: blur, or a scene behind the person. The person is cut out in this browser
 * (MediaPipe selfie segmentation, edges cleaned up in lib/backgroundCutout.ts), so everyone in
 * the meeting — and the recording — sees the processed picture.
 *
 * The model and its wasm are served from this site (public/mediapipe), not the library's default
 * Google / jsDelivr URLs, which mainland visitors can't reach.
 */

import { supportsBackgroundProcessors } from '@livekit/track-processors';
import type { ProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { createBackgroundPipeline, type BackgroundLook, type BackgroundPipeline } from './backgroundCutout';
import { isToolbarMobileUserAgent } from './useToolbarIsMobile';

export const BACKGROUND_SCENES = [
  'shelf',
  'studio',
  'doorway',
  'indigo',
  'forest',
  'mountains',
  'seaside',
  'mist',
] as const;

export type BackgroundScene = (typeof BACKGROUND_SCENES)[number];
export type VideoBackground = 'none' | 'blur-light' | 'blur' | BackgroundScene;
export type VideoBackgroundStatus = 'idle' | 'starting' | 'running' | 'failed';

export const VIDEO_BACKGROUND_EFFECTS = ['none', 'blur-light', 'blur'] as const;

const STORAGE_KEY = 'kloudmeet.videoBackground';
/** Fired on window when the saved background changes (pre-join and meeting stay in step). */
export const VIDEO_BACKGROUND_EVENT = 'kloudmeet:video-background';
/** `track.getProcessor()?.name` of ours, so we never touch another processor. */
export const KLOUD_BACKGROUND_PROCESSOR = 'kloud-background';

const BLUR_RADIUS: Record<'blur-light' | 'blur', number> = { 'blur-light': 5, blur: 14 };

const ASSETS = { wasm: '/mediapipe/wasm', model: '/mediapipe/selfie_segmenter.tflite' };

export function isBackgroundScene(value: unknown): value is BackgroundScene {
  return typeof value === 'string' && (BACKGROUND_SCENES as readonly string[]).includes(value);
}

function isVideoBackground(value: unknown): value is VideoBackground {
  return (
    value === 'none' || value === 'blur-light' || value === 'blur' || isBackgroundScene(value)
  );
}

export function sceneImageUrl(scene: BackgroundScene): string {
  return `/backgrounds/${scene}.jpg`;
}

export function sceneThumbUrl(scene: BackgroundScene): string {
  return `/backgrounds/thumbs/${scene}.jpg`;
}

export function loadVideoBackground(): VideoBackground {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isVideoBackground(saved) ? saved : 'none';
  } catch {
    return 'none';
  }
}

export function saveVideoBackground(background: VideoBackground): void {
  try {
    localStorage.setItem(STORAGE_KEY, background);
  } catch {
    // Private mode or storage full: the choice still applies for this visit.
  }
  window.dispatchEvent(new CustomEvent(VIDEO_BACKGROUND_EVENT, { detail: background }));
}

/** Phones don't get backgrounds in this version (heat, battery, uneven browser support). */
export function videoBackgroundsOffered(): boolean {
  return typeof window !== 'undefined' && !isToolbarMobileUserAgent();
}

/** This browser can run the processor (WebGL2, OffscreenCanvas, VideoFrame). */
export function videoBackgroundsSupported(): boolean {
  if (!videoBackgroundsOffered()) return false;
  try {
    return supportsBackgroundProcessors();
  } catch {
    return false;
  }
}

function lookFor(background: Exclude<VideoBackground, 'none'>): BackgroundLook {
  if (background === 'blur-light' || background === 'blur') {
    return { kind: 'blur', radius: BLUR_RADIUS[background] };
  }
  return { kind: 'image', url: sceneImageUrl(background) };
}

type VideoOptions = ProcessorOptions<Track.Kind.Video>;
type StatusListener = (status: VideoBackgroundStatus, error?: unknown) => void;

/**
 * One background processor for a camera track. Unlike the library's processor it can be reused
 * across tracks (each init builds a fresh pipeline), it waits while the camera is off instead of
 * starting on an ended track, and a failure never stops the camera: the picture goes out without
 * the background and the listener hears "failed".
 */
export class KloudBackgroundProcessor
  implements TrackProcessor<Track.Kind.Video, VideoOptions>
{
  readonly name = KLOUD_BACKGROUND_PROCESSOR;

  private inner?: BackgroundPipeline;
  private background: Exclude<VideoBackground, 'none'>;
  private listener?: StatusListener;
  private status: VideoBackgroundStatus = 'idle';
  /** Bumped by destroy/restart so a slow init that finishes late cleans up after itself. */
  private generation = 0;

  constructor(background: Exclude<VideoBackground, 'none'>, listener?: StatusListener) {
    this.background = background;
    this.listener = listener;
  }

  get processedTrack(): MediaStreamTrack | undefined {
    return this.inner?.processedTrack;
  }

  get currentStatus(): VideoBackgroundStatus {
    return this.status;
  }

  get currentBackground(): Exclude<VideoBackground, 'none'> {
    return this.background;
  }

  setListener(listener: StatusListener | undefined) {
    this.listener = listener;
    listener?.(this.status);
  }

  async init(opts: VideoOptions) {
    await this.stopInner();
    await this.start(opts);
  }

  async restart(opts: VideoOptions) {
    await this.stopInner();
    await this.start(opts);
  }

  async destroy() {
    await this.stopInner();
    this.emit('idle');
  }

  /** Switch blur ↔ scene without rebuilding the pipeline (no flash). */
  async setBackground(background: Exclude<VideoBackground, 'none'>) {
    this.background = background;
    if (!this.inner) return;
    try {
      await this.inner.switchTo(lookFor(background));
      this.emit('running');
    } catch (error) {
      this.emit('failed', error);
    }
  }

  private async start(opts: VideoOptions) {
    // Camera turned off: LiveKit restarts us with the new track when it comes back on.
    if (opts.track.readyState === 'ended') return;
    const generation = ++this.generation;
    const startedWith = this.background;
    this.emit('starting');
    let inner: BackgroundPipeline | undefined;
    try {
      inner = createBackgroundPipeline(lookFor(startedWith), ASSETS);
      await inner.init(opts);
      if (generation !== this.generation) {
        await inner.destroy().catch(() => undefined);
        return;
      }
      if (this.background !== startedWith) await inner.switchTo(lookFor(this.background));
      this.inner = inner;
      this.emit('running');
    } catch (error) {
      await inner?.destroy().catch(() => undefined);
      if (generation === this.generation) this.emit('failed', error);
    }
  }

  private async stopInner() {
    this.generation++;
    const inner = this.inner;
    this.inner = undefined;
    await inner?.destroy().catch(() => undefined);
  }

  private emit(status: VideoBackgroundStatus, error?: unknown) {
    this.status = status;
    this.listener?.(status, error);
  }
}

/** The processor to start the camera with: the saved choice, if this browser can run it. */
export function initialBackgroundProcessor(): KloudBackgroundProcessor | undefined {
  if (!videoBackgroundsSupported()) return undefined;
  const saved = loadVideoBackground();
  return saved === 'none' ? undefined : new KloudBackgroundProcessor(saved);
}
