'use client';

/**
 * CaptionsOverlay.tsx — 会议字幕显示组件
 *
 * 在会议界面底部渲染浮动字幕条（类似 Zoom / Google Meet 风格）。
 * 由 useCaptions hook 驱动，无需额外状态。
 *
 * 用法：
 *   <CaptionsOverlay captionsInfo={captionsInfo} />
 */

import React from 'react';
import type { CaptionsInfo } from './useCaptions';

interface CaptionsOverlayProps {
  captionsInfo: CaptionsInfo;
  /** 可选：底部偏移（px），避免被 Toolbar 遮挡，默认 80 */
  bottomOffset?: number;
}

export function CaptionsOverlay({
  captionsInfo,
  bottomOffset = 80,
}: CaptionsOverlayProps) {
  if (!captionsInfo.show || !captionsInfo.text) return null;

  return (
    <>
      <style>{`
        @keyframes kloud-caption-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .kloud-caption-bar {
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          z-index: 9000;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          pointer-events: none;
          animation: kloud-caption-in 0.2s ease;
          max-width: min(700px, 92vw);
          width: 100%;
        }
        .kloud-caption-name {
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: rgba(255, 255, 255, 0.75);
          text-shadow: 0 1px 3px rgba(0,0,0,0.5);
          font-family: 'Inter', -apple-system, sans-serif;
        }
        .kloud-caption-text {
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          color: #ffffff;
          font-size: 1rem;
          font-weight: 500;
          line-height: 1.5;
          padding: 6px 16px 8px;
          border-radius: 8px;
          text-align: center;
          font-family: 'Inter', -apple-system, sans-serif;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 4px 20px rgba(0,0,0,0.35);
          word-break: break-word;
        }
      `}</style>

      <div
        className="kloud-caption-bar"
        style={{ bottom: bottomOffset }}
        aria-live="polite"
        aria-atomic="true"
        role="status"
      >
        {captionsInfo.userName && (
          <span className="kloud-caption-name">{captionsInfo.userName}</span>
        )}
        <div className="kloud-caption-text">{captionsInfo.text}</div>
      </div>
    </>
  );
}

export default CaptionsOverlay;
