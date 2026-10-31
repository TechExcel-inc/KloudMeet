import type { Metadata, Viewport } from 'next';
import { TvShell } from './TvShell';

export const metadata: Metadata = {
  title: 'Kloud Meet TV',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#0b0c10',
  width: 'device-width',
  initialScale: 1,
};

/** Everything a TV shows (home, joining, the meeting) shares one shell: pairing, keys, voice. */
export default function TvScreenLayout({ children }: { children: React.ReactNode }) {
  return <TvShell>{children}</TvShell>;
}
