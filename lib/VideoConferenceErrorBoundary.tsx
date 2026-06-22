'use client';

import React from 'react';

const MAX_RETRIES = 10;

interface State {
  resetKey: number;
  retryCount: number;
}

export class VideoConferenceErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { resetKey: 0, retryCount: 0 };
  }

  componentDidCatch(error: Error) {
    console.warn('[VideoConferenceErrorBoundary] Caught error, remounting:', error.message);
    this.setState((prev) => ({
      resetKey: prev.resetKey + 1,
      retryCount: prev.retryCount + 1,
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
