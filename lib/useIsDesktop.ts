'use client';

import { useState, useEffect } from 'react';

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Our preload.js explicitly injects window.electronAPI only in the Electron Native App
    if (typeof window !== 'undefined' && 'electronAPI' in window) {
      setIsDesktop(true);
    }
  }, []);

  return isDesktop;
}
