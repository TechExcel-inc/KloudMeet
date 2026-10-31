import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { RemoteApp } from './RemoteApp';

export const metadata: Metadata = {
  title: 'Kloud Meet TV Remote',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0b0c10',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

/** Phone remote for Kloud Meet TV: scan the TV's QR code, or open this page and enter its code. */
export default function TvRemotePage() {
  return (
    <Suspense fallback={null}>
      <RemoteApp />
    </Suspense>
  );
}
