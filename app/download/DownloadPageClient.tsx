'use client';

/**
 * Download page: one clear button for the computer you're on, Open for people who already installed,
 * and every other build underneath. A build that isn't published says so instead of offering a file.
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { KloudLogo } from '../home/components/KloudLogo';
import css from '@/styles/Download.module.css';

interface MacRelease {
  version: string;
  arm64: number | null;
  hasArm64: boolean;
  x64: number | null;
  hasX64: boolean;
}

interface WinRelease {
  version: string;
  size: number | null;
  available: boolean;
}

type Visitor = 'mac' | 'win' | 'mobile' | 'other';
type Chip = 'arm64' | 'x64' | null;

const MAC_ARM64_HREF = '/api/download?os=mac&arch=arm64';
const MAC_X64_HREF = '/api/download?os=mac&arch=x64';
const WIN_HREF = '/api/download?os=win';

function detectVisitor(): Visitor {
  const ua = navigator.userAgent;
  // iPadOS asks for desktop sites and calls itself a Mac; only the touch points give it away
  if (/Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'mobile';
  }
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'win';
  return 'other';
}

/** Every Mac browser says "Intel" in its user agent, so the chip has to come from elsewhere. */
async function detectMacChip(): Promise<Chip> {
  try {
    const uaData = (navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }>;
      };
    }).userAgentData;
    const arch = (await uaData?.getHighEntropyValues(['architecture']))?.architecture;
    if (arch === 'arm') return 'arm64';
    if (arch === 'x86') return 'x64';
  } catch {
    /* fall through to the graphics chip's name */
  }
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    if (/Apple M\d/.test(renderer)) return 'arm64';
    if (/Intel|AMD|Radeon/.test(renderer)) return 'x64';
  } catch {
    /* unknown */
  }
  return null;
}

function formatSize(bytes: number | null): string {
  return bytes ? `${Math.round(bytes / (1024 * 1024))} MB` : '';
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.74c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.71-3.19-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.61 2.25 2.75 2.21 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.15.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.31-.89-2.33-3.54zM14.17 6.27c.61-.74 1.02-1.76.91-2.78-.88.04-1.94.59-2.57 1.32-.56.65-1.06 1.69-.92 2.69.98.08 1.97-.5 2.58-1.23z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
    </svg>
  );
}

function BuildRow({
  label,
  detail,
  href,
  recommended,
}: {
  label: string;
  detail: string;
  href: string | null;
  recommended?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={css.buildRow}>
      <div className={css.buildText}>
        <span className={css.buildLabel}>
          {label}
          {recommended && <span className={css.badge}>{t('download.thisComputer')}</span>}
        </span>
        {detail && <span className={css.buildDetail}>{detail}</span>}
      </div>
      {href ? (
        <a className={css.buildLink} href={href}>
          <DownloadIcon />
          {t('download.download')}
        </a>
      ) : (
        <span className={css.soon}>{t('download.comingSoon')}</span>
      )}
    </div>
  );
}

export function DownloadPageClient({ mac, win }: { mac: MacRelease | null; win: WinRelease | null }) {
  const { t } = useI18n();
  const isDesktopApp = useIsDesktop();
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [chip, setChip] = useState<Chip>(null);

  useEffect(() => {
    // Same default as the home page, and what KloudLogo assumes when choosing its colour
    const stored = window.localStorage.getItem('kloud-theme');
    document.documentElement.setAttribute('data-theme', stored === 'light' ? 'light' : 'dark');
    const seen = detectVisitor();
    setVisitor(seen);
    if (seen === 'mac') void detectMacChip().then(setChip);
  }, []);

  const hasArm64 = !!mac?.hasArm64;
  const hasX64 = !!mac?.hasX64;
  const hasWin = !!win?.available;

  const describe = (version: string | undefined, size: number | null, needs: string) =>
    [version && t('download.version', { version }), formatSize(size), needs].filter(Boolean).join(' · ');

  let primary: { label: string; href: string; icon: React.ReactNode } | null = null;
  let note = '';
  if (visitor === 'win') {
    if (hasWin) primary = { label: t('download.forWindows'), href: WIN_HREF, icon: <WindowsIcon /> };
  } else if (visitor === 'mac') {
    // Not knowing the chip, offer the common one; both are listed right below
    if (chip === 'x64') {
      if (hasX64) primary = { label: t('download.forMacIntel'), href: MAC_X64_HREF, icon: <AppleIcon /> };
      else if (hasArm64) note = t('download.intelNotYet');
    } else if (hasArm64) {
      const label = chip === 'arm64' ? t('download.forMacSilicon') : t('download.forMac');
      primary = { label, href: MAC_ARM64_HREF, icon: <AppleIcon /> };
    } else if (hasX64) {
      primary = { label: t('download.forMacIntel'), href: MAC_X64_HREF, icon: <AppleIcon /> };
    }
    if (!primary && !note) note = t('download.macNotYet');
  } else if (visitor === 'mobile') {
    note = t('download.mobileNote');
  }

  return (
    <div className={css.page}>
      <header className={css.header}>
        <Link href="/" className={css.logoLink} aria-label={t('download.backHome')}>
          <KloudLogo variant="nav" />
        </Link>
        <Link href="/" className={css.joinLink}>
          {t('download.useBrowser')}
        </Link>
      </header>

      <main className={css.main}>
        <section className={css.hero}>
          <img className={css.appIcon} src="/images/kloud-meet-desktop-icon.png" alt="" width="88" height="88" />
          <h1 className={css.title}>{t('download.title')}</h1>
          <p className={css.subtitle}>{t('download.subtitle')}</p>

          <div className={css.heroActions}>
            {primary && (
              <a className={css.primaryBtn} href={primary.href}>
                {primary.icon}
                {primary.label}
              </a>
            )}
            {!isDesktopApp && visitor !== 'mobile' && visitor !== null && (
              <a className={css.secondaryBtn} href="kloudmeet://open">
                {t('download.open')}
              </a>
            )}
            {visitor === 'mobile' && (
              <Link className={css.primaryBtn} href="/">
                {t('download.useBrowser')}
              </Link>
            )}
          </div>
          {note && <p className={css.note}>{note}</p>}
          {primary && !isDesktopApp && (
            <p className={css.hint}>{t('download.openHint')}</p>
          )}
        </section>

        <section className={css.cards} aria-label={t('download.allBuilds')}>
          <div className={css.card}>
            <div className={css.cardHead}>
              <span className={css.cardIcon}>
                <AppleIcon />
              </span>
              <h2 className={css.cardTitle}>macOS</h2>
            </div>
            <BuildRow
              label={t('download.appleSilicon')}
              detail={hasArm64 ? describe(mac?.version, mac?.arm64 ?? null, 'M1+') : 'M1+'}
              href={hasArm64 ? MAC_ARM64_HREF : null}
              recommended={visitor === 'mac' && chip === 'arm64'}
            />
            <BuildRow
              label={t('download.intel')}
              detail={hasX64 ? describe(mac?.version, mac?.x64 ?? null, '') : ''}
              href={hasX64 ? MAC_X64_HREF : null}
              recommended={visitor === 'mac' && chip === 'x64'}
            />
            {(hasArm64 || hasX64) && <p className={css.install}>{t('download.installMac')}</p>}
          </div>

          <div className={css.card}>
            <div className={css.cardHead}>
              <span className={css.cardIcon}>
                <WindowsIcon />
              </span>
              <h2 className={css.cardTitle}>Windows</h2>
            </div>
            <BuildRow
              label={t('download.win64')}
              detail={hasWin ? describe(win?.version, win?.size ?? null, 'Windows 10+') : 'Windows 10+'}
              href={hasWin ? WIN_HREF : null}
              recommended={visitor === 'win'}
            />
            {hasWin && <p className={css.install}>{t('download.installWin')}</p>}
          </div>
        </section>

        {visitor !== 'mobile' && (
          <p className={css.footnote}>
            {t('download.noInstall')} <Link href="/">{t('download.useBrowser')}</Link>
          </p>
        )}
      </main>
    </div>
  );
}
