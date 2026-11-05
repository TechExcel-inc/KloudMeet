import type { Metadata } from 'next';
import {
  fetchReleaseManifest,
  findMacDmg,
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
          arm64: findMacDmg(mac, 'arm64')?.size ?? null,
          hasArm64: !!findMacDmg(mac, 'arm64'),
          x64: findMacDmg(mac, 'x64')?.size ?? null,
          hasX64: !!findMacDmg(mac, 'x64'),
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
