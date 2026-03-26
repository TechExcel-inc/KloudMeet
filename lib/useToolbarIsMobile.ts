'use client';

import { useState, useEffect } from 'react';

/** 与 KloudMeetToolbar 一致的移动设备 UA 判定（用于 Chat/Attendees 桌面气泡 vs 侧栏浮层）。 */
export function useToolbarIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || navigator.vendor || (window as Window & { opera?: string }).opera;
    setIsMobile(/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(String(ua).toLowerCase()));
  }, []);

  return isMobile;
}
