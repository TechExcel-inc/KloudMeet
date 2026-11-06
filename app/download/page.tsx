import type { Metadata } from 'next';
import {
  fetchReleaseManifest,
  findMacInstaller,
  findWindowsInstaller,
} from '@/lib/desktopReleaseManifest';
import { DownloadPageClient } from './DownloadPageClient';

export const metadata: Metadata = {
  title: 'Download Kloud Meet for Mac and Windows',
  description: 'Install the Kloud Meet desktop app for Mac or Windows.',
};

export const revalidate = 60;

export default async function DownloadPage() {
  const [mac, win] = await Promise.all([fetchReleaseManifest('mac'), fetchReleaseManifest('win')]);
  return (
    <DownloadPageClient
      mac={
        mac && {
          version: mac.version,
          arm64: findMacInstaller(mac, 'arm64')?.size ?? null,
          hasArm64: !!findMacInstaller(mac, 'arm64'),
          x64: findMacInstaller(mac, 'x64')?.size ?? null,
          hasX64: !!findMacInstaller(mac, 'x64'),
        }
      }
      win={
        win && {
          version: win.version,
          size: findWindowsInstaller(win)?.size ?? null,
          available: !!findWindowsInstaller(win),
        }
      }
    />
  );
}
