'use client';

import { useState, useEffect } from 'react';

const MOBILE_UA_RE = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;

/** 与 KloudMeetToolbar / Dev MainStage Browser.isMobile 一致的 UA 判定（可同步调用）。 */
export function isToolbarMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || navigator.vendor || (window as Window & { opera?: string }).opera;
  return MOBILE_UA_RE.test(String(ua).toLowerCase());
}

/** 通知 LiveDoc iframe 展开/关闭右侧文件栏（与 Dev onClickRightTab(show) 一致）。 */
export function postKloudShowFilePanelToIframe(show: 0 | 1): void {
  if (typeof document === 'undefined') return;
  const iframe =
    (document.getElementById('sharedIframePlayer') as HTMLIFrameElement | null) ??
    document.querySelector<HTMLIFrameElement>('iframe[title="LiveDoc"]');
  iframe?.contentWindow?.postMessage({ type: 'Kloud-ShowFilePanel', Show: show }, '*');
}

/** 与 KloudMeetToolbar 一致的移动设备 UA 判定（用于 Chat/Attendees 桌面气泡 vs 侧栏浮层）。 */
export function useToolbarIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(isToolbarMobileUserAgent());
  }, []);

  return isMobile;
}
