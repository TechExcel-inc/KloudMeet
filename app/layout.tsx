import '../styles/globals.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'react-hot-toast';
import { I18nProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: {
    default: 'Kloud Meet',
    template: '%s',
  },
  description:
    'LiveKit is an open source WebRTC project that gives you everything needed to build scalable and real-time audio and/or video experiences in your applications.',
  twitter: {
    creator: '@livekitted',
    site: '@livekitted',
    card: 'summary_large_image',
  },
  openGraph: {
    url: 'https://meet.livekit.io',
    images: [
      {
        url: 'https://meet.livekit.io/images/livekit-meet-open-graph.png',
        width: 2000,
        height: 1000,
        type: 'image/png',
      },
    ],
    siteName: 'LiveKit Meet',
  },
};

export const viewport: Viewport = {
  themeColor: '#070707',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body data-lk-theme="default">
        <I18nProvider>
          <Toaster />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
