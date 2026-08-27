/**
 * Document Picture-in-Picture：网页端能力检测与 Media Session 辅助。
 */

import { isToolbarMobileUserAgent } from '@/lib/useToolbarIsMobile';

type DocumentPictureInPicture = {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
};

type MediaSessionWithCapture = MediaSession & {
  setCameraActive?: (active: boolean) => void;
  setMicrophoneActive?: (active: boolean) => void;
};

export function getDocumentPictureInPicture(): DocumentPictureInPicture | null {
  if (typeof window === 'undefined') return null;
  const api = (window as Window & { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture;
  return api ?? null;
}

/** 仅网页端：非 Electron、非手机 UA，且浏览器支持 Document PiP */
export function isWebDocumentPipEligible(): boolean {
  if (typeof window === 'undefined') return false;
  if ('electronAPI' in window) return false;
  if (isToolbarMobileUserAgent()) return false;
  return getDocumentPictureInPicture() !== null;
}

export function setMediaSessionActionHandler(
  action: string,
  handler: MediaSessionActionHandler | null,
): void {
  if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
  try {
    navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler);
  } catch {
    // 浏览器不支持该 action 时忽略
  }
}

/** 同步麦/摄像头状态，让 Chrome 把本页当成视频会议会话 */
export function updateMediaSessionCaptureState(micEnabled: boolean, camEnabled: boolean): void {
  if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
  const session = navigator.mediaSession as MediaSessionWithCapture;
  try {
    session.setMicrophoneActive?.(micEnabled);
  } catch {
    // ignore
  }
  try {
    session.setCameraActive?.(camEnabled);
  } catch {
    // ignore
  }
}

/** 把主文档样式表复制到 PiP 窗口（CSS Modules 类名才能生效） */
export function copyDocumentStyles(sourceDoc: Document, targetDoc: Document): void {
  sourceDoc.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    try {
      if (node instanceof HTMLStyleElement) {
        targetDoc.head.appendChild(targetDoc.importNode(node, true));
        return;
      }
      if (node instanceof HTMLLinkElement && node.href) {
        const link = targetDoc.createElement('link');
        Array.from(node.attributes).forEach((attr) => {
          if (attr.name === 'href') return;
          if (attr.name === 'type' && !attr.value) return;
          link.setAttribute(attr.name, attr.value);
        });
        link.href = node.href;
        targetDoc.head.appendChild(link);
      }
    } catch {
      // 个别样式表无法复制时跳过
    }
  });
}
