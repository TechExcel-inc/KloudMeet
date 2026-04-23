'use client';

/**
 * CaptionsOverlay.tsx — 会议字幕显示组件
 *
 * 布局："发言人: 字幕内容▊" — 同行 inline 显示，类似 YouTube / Google Meet 字幕。
 * isPartial=true 时显示闪烁光标（表示识别进行中）。
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
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes kloud-cursor-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        .kloud-caption-bar {
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          z-index: 9000;
          pointer-events: none;
          animation: kloud-caption-in 0.18s ease;
          max-width: min(800px, 94vw);
          width: max-content;
        }
        .kloud-caption-bubble {
          display: inline-flex;
          align-items: baseline;
          background: rgba(0, 0, 0, 0.80);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.10);
          box-shadow: 0 4px 24px rgba(0,0,0,0.45);
          border-radius: 10px;
          padding: 7px 18px 9px;
          line-height: 1.6;
          word-break: break-word;
          font-family: 'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        }
        .kloud-caption-name {
          font-size: 0.9rem;
          font-weight: 700;
          color: #5bbcff;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .kloud-caption-colon {
          font-size: 0.9rem;
          font-weight: 700;
          color: #5bbcff;
          margin-right: 7px;
          flex-shrink: 0;
        }
        .kloud-caption-text {
          color: #f5f5f5;
          font-size: 1rem;
          font-weight: 400;
          letter-spacing: 0.01em;
        }
        .kloud-caption-cursor {
          display: inline-block;
          width: 2px;
          height: 1em;
          background: #5bbcff;
          margin-left: 2px;
          vertical-align: text-bottom;
          border-radius: 1px;
          animation: kloud-cursor-blink 0.9s step-end infinite;
        }
      `}</style>

      <div
        className="kloud-caption-bar"
        style={{ bottom: bottomOffset }}
        aria-live="polite"
        aria-atomic="true"
        role="status"
      >
        <div className="kloud-caption-bubble">
          {captionsInfo.userName && (
            <>
              <span className="kloud-caption-name">{captionsInfo.userName}</span>
              <span className="kloud-caption-colon">:</span>
            </>
          )}
          <span className="kloud-caption-text">
            {captionsInfo.text}
            {captionsInfo.isPartial && (
              <span className="kloud-caption-cursor" aria-hidden="true" />
            )}
          </span>
        </div>
      </div>
    </>
  );
}

export default CaptionsOverlay;
