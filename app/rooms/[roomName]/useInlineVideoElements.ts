import React from 'react';

function patchVideo(video: HTMLVideoElement): void {
  if (!video.hasAttribute('disablePictureInPicture')) {
    video.setAttribute('disablePictureInPicture', 'true');
  }
  // WeChat & Mobile browser specific attributes to ensure screen shares (and normal video) play inline
  if (!video.hasAttribute('playsinline')) video.setAttribute('playsinline', 'true');
  if (!video.hasAttribute('webkit-playsinline')) video.setAttribute('webkit-playsinline', 'true');
  if (!video.hasAttribute('x5-playsinline')) video.setAttribute('x5-playsinline', 'true');
  if (!video.hasAttribute('x5-video-player-type')) video.setAttribute('x5-video-player-type', 'h5');
}

function patchAdded(node: Node): void {
  if (node instanceof HTMLVideoElement) {
    patchVideo(node);
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  node.querySelectorAll('video').forEach((video) => patchVideo(video));
}

/** useInlineVideoElements — 给页面上所有 <video> 补齐禁用画中画与内联播放属性（含微信 X5） */
export function useInlineVideoElements(): void {
  React.useEffect(() => {
    document.querySelectorAll('video').forEach((video) => patchVideo(video));
    const observer = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach(patchAdded);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}
