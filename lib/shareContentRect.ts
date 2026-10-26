/**
 * Where the shared picture actually sits inside its <video> element.
 *
 * A screen share is shown with `object-fit: contain`, so the video box usually has bars on two
 * sides, and the box itself is only part of the stage (the camera strip sits beside it).
 * Annotation and remote control both normalise pointer positions to this content box, so
 * (0, 0)–(1, 1) means the same pixel of the presenter's screen for every viewer, whatever
 * their window size.
 */

export type Rect = { left: number; top: number; width: number; height: number };
export type ObjectFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';

/** The rectangle the video's pixels occupy inside `box` (same coordinate space as `box`). */
export function contentRect(box: Rect, videoW: number, videoH: number, fit: ObjectFit = 'contain'): Rect {
  if (!(videoW > 0 && videoH > 0) || !(box.width > 0 && box.height > 0) || fit === 'fill') {
    return { ...box };
  }
  const videoAspect = videoW / videoH;
  const boxAspect = box.width / box.height;
  let width: number;
  let height: number;
  if (fit === 'none' || (fit === 'scale-down' && videoW <= box.width && videoH <= box.height)) {
    width = videoW;
    height = videoH;
  } else if ((fit === 'cover') !== videoAspect > boxAspect) {
    // contain + wider video, or cover + taller video: full width
    width = box.width;
    height = box.width / videoAspect;
  } else {
    height = box.height;
    width = box.height * videoAspect;
  }
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Pointer position → 0–1 within the content box. `inside` is false over the bars or the camera strip. */
export function toContentNormalized(
  clientX: number,
  clientY: number,
  content: Rect,
): { x: number; y: number; inside: boolean } {
  const rawX = content.width > 0 ? (clientX - content.left) / content.width : 0;
  const rawY = content.height > 0 ? (clientY - content.top) / content.height : 0;
  return {
    x: clamp01(rawX),
    y: clamp01(rawY),
    inside: rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1,
  };
}

/** 0–1 content position → pixels in the content box's coordinate space. */
export function fromContentNormalized(x: number, y: number, content: Rect): { x: number; y: number } {
  return { x: content.left + x * content.width, y: content.top + y * content.height };
}

/** The screen-share <video> on the stage, if one is rendered. */
export function findShareVideo(root: ParentNode = document): HTMLVideoElement | null {
  return (
    root.querySelector<HTMLVideoElement>('[data-lk-source="screen_share"] video') ||
    root.querySelector<HTMLVideoElement>('video[data-lk-source="screen_share"]') ||
    root.querySelector<HTMLVideoElement>('.lk-focus-layout .lk-participant-tile video') ||
    root.querySelector<HTMLVideoElement>('.lk-focus-layout video')
  );
}

/**
 * The shared picture's rectangle in viewport coordinates, or null when no share video is
 * laid out yet. Falls back to the whole video box until the first frame reports its size.
 */
export function shareContentClientRect(video: HTMLVideoElement | null): Rect | null {
  if (!video) return null;
  const r = video.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  let fit: ObjectFit = 'contain';
  try {
    const f = getComputedStyle(video).objectFit as ObjectFit;
    if (f) fit = f;
  } catch {
    /* keep contain */
  }
  return contentRect({ left: r.left, top: r.top, width: r.width, height: r.height }, video.videoWidth, video.videoHeight, fit);
}
