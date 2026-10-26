import React from 'react';

/** useInlineVideoElements — 给页面上所有 <video> 补齐禁用画中画与内联播放属性（含微信 X5） */
export function useInlineVideoElements(): void {
  // Modify video elements globally:
  // 1. Force disable native PiP overlays (e.g. Firefox)
  // 2. Add properties specifically for WeChat / X5 engine to support inline viewing
  React.useEffect(() => {
    const patchVideoElements = () => {
      document.querySelectorAll('video').forEach((video) => {
        if (!video.hasAttribute('disablePictureInPicture')) video.setAttribute('disablePictureInPicture', 'true');
        // WeChat & Mobile browser specific attributes to ensure screen shares (and normal video) play inline
        if (!video.hasAttribute('playsinline')) video.setAttribute('playsinline', 'true');
        if (!video.hasAttribute('webkit-playsinline')) video.setAttribute('webkit-playsinline', 'true');
        if (!video.hasAttribute('x5-playsinline')) video.setAttribute('x5-playsinline', 'true');
        if (!video.hasAttribute('x5-video-player-type')) video.setAttribute('x5-video-player-type', 'h5');
      });
    };
    patchVideoElements();
    const observer = new MutationObserver(patchVideoElements);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}
