'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Keyboard,
  LoaderCircle,
  Mic,
  Settings,
  Smartphone,
  Video,
} from 'lucide-react';
import { LOCALE_OPTIONS, useI18n } from '@/lib/i18n';
import { formatPairCode, normalizeMeetingCode } from '@/lib/tv/protocol';
import { TV_NAME_PRESETS, loadMediaPrefs, saveMediaPrefs } from '@/lib/tv/deviceIdentity';
import { lookupMeeting } from '@/lib/tv/meetingLookup';
import { useTvCommands, useTvKeys, useTvShell } from './TvShell';
import { focusDefault } from './useSpatialNav';
import { TvStage } from '../components/TvStage';
import { QrCode } from '../components/QrCode';
import { OnScreenKeyboard } from '../components/OnScreenKeyboard';
import { TvBrand, TvClock, TvKeyLegend } from '../components/TvChrome';
import styles from '@/styles/Tv.module.css';

type Sub = 'home' | 'join' | 'settings';

function timeAgo(at: number, t: (k: string, p?: Record<string, string | number>) => string): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return t('tv.time.justNow');
  if (min < 60) return t('tv.time.minutes', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('tv.time.hours', { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? t('tv.time.yesterday') : t('tv.time.days', { n: d });
}

export function TvHome() {
  const { t } = useI18n();
  const shell = useTvShell();
  const router = useRouter();
  const params = useSearchParams();
  const [sub, setSub] = React.useState<Sub>(() => (params?.get('screen') === 'join' ? 'join' : 'home'));
  const [phoneHint, setPhoneHint] = React.useState(false);

  React.useEffect(() => {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (coarse && window.innerWidth < 900) setPhoneHint(true);
  }, []);

  React.useEffect(() => {
    shell.report({ screen: sub });
    setTimeout(() => focusDefault());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  useTvCommands((cmd) => {
    if (cmd.type === 'key' && cmd.key === 'back') {
      if (sub !== 'home') setSub('home');
      return true;
    }
    if (cmd.type === 'home') {
      setSub('home');
      return true;
    }
    return false;
  });

  if (phoneHint) {
    return (
      <div className={styles.phoneHint}>
        <Smartphone size={40} />
        <h1>{t('tv.phoneHint.title')}</h1>
        <p>{t('tv.phoneHint.body')}</p>
        <button type="button" className={styles.phoneHintPrimary} onClick={() => router.push('/tv/remote')}>
          {t('tv.phoneHint.remote')}
        </button>
        <button type="button" className={styles.phoneHintSecondary} onClick={() => setPhoneHint(false)}>
          {t('tv.phoneHint.stay')}
        </button>
      </div>
    );
  }

  return (
    <TvStage>
      <div className={styles.screen}>
        {sub === 'home' && <HomeScreen onJoin={() => setSub('join')} onSettings={() => setSub('settings')} />}
        {sub === 'join' && <JoinScreen onBack={() => setSub('home')} initialCode={params?.get('code') ?? ''} />}
        {sub === 'settings' && <SettingsScreen onBack={() => setSub('home')} />}
      </div>
    </TvStage>
  );
}

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 5) return 'tv.home.evening';
  if (h < 12) return 'tv.home.morning';
  if (h < 18) return 'tv.home.afternoon';
  return 'tv.home.evening';
}

function HomeScreen({ onJoin, onSettings }: { onJoin: () => void; onSettings: () => void }) {
  const { t } = useI18n();
  const shell = useTvShell();
  const router = useRouter();
  const { identity, remotes, pairStatus } = shell;

  return (
    <>
      <header className={styles.topBar}>
        <TvBrand name={identity.name} />
        <TvClock />
      </header>

      <main className={styles.homeGrid}>
        <section className={styles.homeLeft}>
          <p className={styles.eyebrow}>{t(greetingKey())}</p>
          <h1 className={styles.display}>{t('tv.home.title')}</h1>

          <div className={styles.tileRow}>
            <button type="button" className={`${styles.tile} ${styles.tilePrimary}`} onClick={onJoin} data-tv-autofocus>
              <span className={styles.tileIcon}><Keyboard size={44} /></span>
              <span className={styles.tileLabel}>{t('tv.home.enterCode')}</span>
              <span className={styles.tileSub}>{t('tv.home.enterCodeSub')}</span>
            </button>
            <button type="button" className={styles.tile} onClick={shell.startVoice}>
              <span className={styles.tileIcon}><Mic size={44} /></span>
              <span className={styles.tileLabel}>{t('tv.home.voice')}</span>
              <span className={styles.tileSub}>{shell.tvVoice ? t('tv.home.voiceSub') : t('tv.home.voiceSubPhone')}</span>
            </button>
            <button type="button" className={styles.tile} onClick={onSettings}>
              <span className={styles.tileIcon}><Settings size={44} /></span>
              <span className={styles.tileLabel}>{t('tv.settings')}</span>
              <span className={styles.tileSub}>{t('tv.home.settingsSub')}</span>
            </button>
          </div>

          <h2 className={styles.sectionTitle}>{t('tv.home.recent')}</h2>
          {shell.recents.length === 0 ? (
            <p className={styles.emptyLine}>{t('tv.home.recentEmpty')}</p>
          ) : (
            <div className={styles.recentRow}>
              {shell.recents.slice(0, 3).map((r) => (
                <button
                  key={r.code}
                  type="button"
                  className={styles.recentCard}
                  onClick={() => router.push(`/tv/rooms/${encodeURIComponent(r.code)}`)}
                >
                  <span className={styles.recentTitle}>{r.title || r.code}</span>
                  <span className={styles.recentMeta}>
                    {r.title ? `${r.code} · ` : ''}
                    {timeAgo(r.at, t)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className={styles.phonePanel} aria-label={t('tv.pair.title')}>
          <h2 className={styles.panelTitle}>{t('tv.pair.title')}</h2>
          <div className={styles.qrBox}>
            <QrCode value={shell.qrUrl} label={t('tv.pair.qrLabel')} />
          </div>
          <p className={styles.pairStep}>{t('tv.pair.scan')}</p>
          <p className={styles.pairStepMuted}>
            {t('tv.pair.orOpen')} <strong className={styles.pairUrl}>{shell.remoteUrl}</strong>
          </p>
          <div className={styles.pairCodeRow}>
            <span className={styles.pairCodeLabel}>{t('tv.pair.codeLabel')}</span>
            <span className={styles.pairCode}>{formatPairCode(identity.code)}</span>
          </div>
          <div className={styles.pairStatus}>
            {pairStatus !== 'online' ? (
              <span className={styles.statusMuted}>
                <span className={`${styles.dot} ${styles.dotWarn}`} />
                {pairStatus === 'connecting' ? t('tv.pair.connecting') : t('tv.pair.offline')}
              </span>
            ) : remotes.length === 0 ? (
              <span className={styles.statusMuted}>
                <span className={styles.dot} />
                {t('tv.pair.none')}
              </span>
            ) : (
              remotes.slice(0, 3).map((r) => (
                <span key={r.identity} className={styles.statusLive}>
                  <span className={`${styles.dot} ${styles.dotLive}`} />
                  {t('tv.pair.connected', { name: r.name, device: r.device })}
                </span>
              ))
            )}
          </div>
        </aside>
      </main>

      <TvKeyLegend voice />
    </>
  );
}

function JoinScreen({ onBack, initialCode }: { onBack: () => void; initialCode: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = React.useState(initialCode);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const add = (ch: string) => {
    setError(null);
    setCode((c) => (c.length < 40 ? c + ch : c));
  };

  const submit = React.useCallback(async () => {
    const normalized = normalizeMeetingCode(code);
    if (!normalized) {
      setError(t('tv.join.invalid'));
      return;
    }
    if (busy) return;
    setBusy(true);
    const found = await lookupMeeting(normalized);
    setBusy(false);
    if (!found.ok) {
      setError(t(`tv.join.${found.reason}`));
      return;
    }
    router.push(`/tv/rooms/${encodeURIComponent(found.roomName)}`);
  }, [busy, code, router, t]);

  useTvKeys((e, key) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (/^[a-zA-Z0-9-]$/.test(e.key)) {
      add(e.key.toLowerCase());
      return true;
    }
    if (key?.key === 'digit' && typeof key.digit === 'number') {
      add(String(key.digit));
      return true;
    }
    if (e.key === 'Backspace') {
      if (!code) return false; // Back
      setCode((c) => c.slice(0, -1));
      return true;
    }
    return false;
  });

  return (
    <>
      <header className={styles.subHeader}>
        <button type="button" className={styles.backChip} onClick={onBack}>
          <ArrowLeft size={30} />
          {t('common.back')}
        </button>
        <h1 className={styles.h1}>{t('tv.join.title')}</h1>
      </header>

      <div className={styles.joinGrid}>
        <div className={styles.joinLeft}>
          <div className={`${styles.codeField} ${error ? styles.codeFieldError : ''}`} aria-live="polite">
            {code ? <span className={styles.codeValue}>{code}</span> : <span className={styles.codePlaceholder}>{t('tv.join.placeholder')}</span>}
            <span className={styles.caret} aria-hidden="true" />
            {busy && <LoaderCircle className={styles.spin} size={40} />}
          </div>
          <p className={styles.fieldError} role="alert">{error ?? ''}</p>
          <OnScreenKeyboard
            onKey={add}
            onDelete={() => setCode((c) => c.slice(0, -1))}
            onClear={() => {
              setCode('');
              setError(null);
            }}
            onSubmit={() => void submit()}
            submitLabel={busy ? t('common.joining') : t('tv.join.submit')}
            clearLabel={t('tv.join.clear')}
            deleteLabel={t('tv.join.delete')}
            canSubmit={Boolean(code)}
          />
        </div>
        <aside className={styles.joinAside}>
          <span className={styles.asideIcon}><Smartphone size={40} /></span>
          <h2 className={styles.h3}>{t('tv.join.phoneTitle')}</h2>
          <p className={styles.asideBody}>{t('tv.join.phoneBody')}</p>
          <div className={styles.examples}>
            <span className={styles.examplesLabel}>{t('tv.join.examples')}</span>
            <span className={styles.exampleCode}>abc-defg-hij</span>
            <span className={styles.exampleCode}>m5888</span>
          </div>
        </aside>
      </div>
      <TvKeyLegend voice />
    </>
  );
}

function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { t, locale, setLocale } = useI18n();
  const shell = useTvShell();
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [prefs, setPrefs] = React.useState(loadMediaPrefs);

  const refreshDevices = React.useCallback(async (ask: boolean) => {
    try {
      if (ask) {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        s.getTracks().forEach((tr) => tr.stop());
      }
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch {
      /* no devices / not allowed */
    }
  }, []);
  React.useEffect(() => {
    void refreshDevices(false);
  }, [refreshDevices]);

  const cams = devices.filter((d) => d.kind === 'videoinput');
  const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
  const labelsHidden = devices.length > 0 && devices.every((d) => !d.label);
  const pick = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveMediaPrefs(next);
  };

  return (
    <>
      <header className={styles.subHeader}>
        <button type="button" className={styles.backChip} onClick={onBack} data-tv-autofocus>
          <ArrowLeft size={30} />
          {t('common.back')}
        </button>
        <h1 className={styles.h1}>{t('tv.settings')}</h1>
      </header>
      <div className={styles.settingsGrid}>
        <section className={styles.settingsCard}>
          <h2 className={styles.h3}>{t('tv.settings.name')}</h2>
          <p className={styles.settingsValue}>{shell.identity.name}</p>
          <div className={styles.chipWrap}>
            {TV_NAME_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={`${styles.chip} ${shell.identity.name === n ? styles.chipOn : ''}`}
                onClick={() => shell.rename(n)}
              >
                {shell.identity.name === n && <Check size={24} />}
                {n}
              </button>
            ))}
          </div>
          <p className={styles.settingsNote}>{t('tv.settings.nameNote')}</p>
        </section>

        <section className={styles.settingsCard}>
          <h2 className={styles.h3}>{t('tv.settings.devices')}</h2>
          {labelsHidden || devices.length === 0 ? (
            <button type="button" className={styles.btnSecondary} onClick={() => void refreshDevices(true)}>
              {t('tv.settings.showDevices')}
            </button>
          ) : null}
          <DeviceList
            icon={<Video size={26} />}
            label={t('tv.settings.camera')}
            empty={t('tv.settings.noCamera')}
            list={cams}
            selected={prefs.videoDeviceId}
            onPick={(id) => pick({ videoDeviceId: id })}
          />
          <DeviceList
            icon={<Mic size={26} />}
            label={t('tv.settings.mic')}
            empty={t('tv.settings.noMic')}
            list={mics}
            selected={prefs.audioDeviceId}
            onPick={(id) => pick({ audioDeviceId: id })}
          />
        </section>

        <section className={styles.settingsCard}>
          <h2 className={styles.h3}>{t('tv.settings.remote')}</h2>
          <div className={styles.pairCodeRow}>
            <span className={styles.pairCodeLabel}>{t('tv.pair.codeLabel')}</span>
            <span className={styles.pairCode}>{formatPairCode(shell.identity.code)}</span>
          </div>
          <ul className={styles.remoteList}>
            {shell.remotes.length === 0 ? (
              <li className={styles.statusMuted}>{t('tv.pair.none')}</li>
            ) : (
              shell.remotes.map((r) => (
                <li key={r.identity} className={styles.statusLive}>
                  <span className={`${styles.dot} ${styles.dotLive}`} />
                  {t('tv.pair.connected', { name: r.name, device: r.device })}
                </li>
              ))
            )}
          </ul>
          <button type="button" className={styles.btnSecondary} onClick={shell.resetPairing}>
            {t('tv.settings.newCode')}
          </button>
          <p className={styles.settingsNote}>{t('tv.settings.newCodeNote')}</p>
        </section>

        <section className={styles.settingsCard}>
          <h2 className={styles.h3}>{t('tv.settings.language')}</h2>
          <div className={styles.chipWrap}>
            {LOCALE_OPTIONS.map((o) => (
              <button
                key={o.code}
                type="button"
                className={`${styles.chip} ${locale === o.code ? styles.chipOn : ''}`}
                onClick={() => setLocale(o.code)}
              >
                {locale === o.code && <Check size={24} />}
                {o.label}
              </button>
            ))}
          </div>
        </section>
      </div>
      <TvKeyLegend />
    </>
  );
}

function DeviceList({
  icon,
  label,
  empty,
  list,
  selected,
  onPick,
}: {
  icon: React.ReactNode;
  label: string;
  empty: string;
  list: MediaDeviceInfo[];
  selected?: string;
  onPick: (id: string) => void;
}) {
  const current = selected && list.some((d) => d.deviceId === selected) ? selected : list[0]?.deviceId;
  return (
    <div className={styles.deviceGroup}>
      <div className={styles.deviceLabel}>
        {icon}
        {label}
      </div>
      {list.length === 0 ? (
        <p className={styles.settingsNote}>{empty}</p>
      ) : (
        list.slice(0, 4).map((d, i) => (
          <button
            key={d.deviceId || i}
            type="button"
            className={`${styles.deviceRow} ${current === d.deviceId ? styles.deviceRowOn : ''}`}
            onClick={() => onPick(d.deviceId)}
          >
            <span className={styles.radio} aria-hidden="true" />
            <span className={styles.deviceName}>{d.label || `${label} ${i + 1}`}</span>
          </button>
        ))
      )}
    </div>
  );
}
