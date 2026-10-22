import '../styles/globals.css';
import '../styles/tokens.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'react-hot-toast';
import { I18nProvider } from '@/lib/i18n';

/** Shown in search results and link previews (WeChat, Slack, etc.). */
const SITE_DESCRIPTION =
  'Meet on your slides and docs — every session becomes a replayable lesson. Join from the browser, no download. 在文档上开会，会后按页回放，浏览器即可加入。';

export const metadata: Metadata = {
  title: {
    default: 'Kloud Meet',
    template: '%s',
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    url: 'https://meet.kloud.cn',
    images: [
      {
        url: 'https://meet.kloud.cn/images/KloudMeet-open-graph.png',
        width: 2000,
        height: 1000,
        type: 'image/png',
      },
    ],
    siteName: 'Kloud Meet',
    title: 'Kloud Meet',
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: '#070707',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body data-lk-theme="default" suppressHydrationWarning>
        <I18nProvider>
          <Toaster />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
