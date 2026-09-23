'use client';

import React from 'react';

const MAX_RETRIES = 10;
/** 距上次出错超过该时长则重新计数；达到上限后隔该时长再恢复渲染，避免视频区永久空白 */
const RETRY_WINDOW_MS = 60_000;

interface State {
  resetKey: number;
  retryCount: number;
  lastErrorAt: number;
}

export class VideoConferenceErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { resetKey: 0, retryCount: 0, lastErrorAt: 0 };
  }

  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  componentDidUpdate() {
    if (this.state.retryCount < MAX_RETRIES || this.resumeTimer) return;
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.setState((prev) => ({ resetKey: prev.resetKey + 1, retryCount: 0, lastErrorAt: 0 }));
    }, RETRY_WINDOW_MS);
  }

  componentWillUnmount() {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
  }

  componentDidCatch(error: Error) {
    console.warn('[VideoConferenceErrorBoundary] Caught error, remounting:', error.message);
    const now = Date.now();
    this.setState((prev) => ({
      resetKey: prev.resetKey + 1,
      retryCount: now - prev.lastErrorAt > RETRY_WINDOW_MS ? 1 : prev.retryCount + 1,
      lastErrorAt: now,
    }));
  }

  render() {
    if (this.state.retryCount >= MAX_RETRIES) {
      return null;
    }
    return (
      <React.Fragment key={this.state.resetKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
