'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Mic, Smartphone, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import {
  forgetTrustedRemotes,
  loadRecents,
  loadTvIdentity,
  loadVolume,
  newPairCode,
  randomToken,
  rememberRecent,
  saveTvIdentity,
  saveVolume,
  type TvIdentity,
} from '@/lib/tv/deviceIdentity';
import { formatPairCode, type TvCommand, type TvRecent, type TvState } from '@/lib/tv/protocol';
import { normalizeRemoteKey, registerTvPlatformKeys, type TvKeyPress } from '@/lib/tv/remoteKeys';
import { parseVoiceCommand, VOICE_EXAMPLES } from '@/lib/tv/voiceCommands';
import { useSpeechCapture } from '@/lib/tv/useSpeechCapture';
import { focusDefault, focusInRoot, moveFocus, pressFocused } from './useSpatialNav';
import { useTvPairing, type PairStatus, type PairedRemote } from './useTvPairing';
import { TvStage } from '../components/TvStage';
import { QrCode } from '../components/QrCode';
import styles from '@/styles/Tv.module.css';

export type CommandSource = 'remote' | 'voice' | 'key';
/** Return true when handled; the newest handler (the current screen) goes first. */
export type TvCommandHandler = (cmd: TvCommand, source: CommandSource) => boolean;
export type TvKeyHandler = (e: KeyboardEvent, key: TvKeyPress | null) => boolean;

type ScreenReport = Pick<TvState, 'screen'> & Partial<Pick<TvState, 'pendingCode' | 'pendingTitle' | 'meeting' | 'confirm'>>;

interface TvShellApi {
  identity: TvIdentity;
  rename(name: string): void;
  resetPairing(): void;
  pairStatus: PairStatus;
  remotes: PairedRemote[];
  remoteUrl: string;
  qrUrl: string;
  report(screen: ScreenReport): void;
  run(cmd: TvCommand, source: CommandSource): void;
  addHandler(h: TvCommandHandler): () => void;
  addKeyHandler(h: TvKeyHandler): () => void;
  volume: number;
  muted: boolean;
  recents: TvRecent[];
  addRecent(code: string, title: string | null): void;
  tvVoice: boolean;
  startVoice(): void;
  toast(text: string): void;
  /** Feedback line under a command (voice HUD and the phone that sent it) */
  feedback(text: string, ok?: boolean): void;
  openHelp(): void;
}

const TvShellContext = React.createContext<TvShellApi | null>(null);

export function useTvShell(): TvShellApi {
  const ctx = React.useContext(TvShellContext);
  if (!ctx) throw new Error('useTvShell outside TvShell');
  return ctx;
}

/** Registers the current screen's command handler while it is mounted. */
export function useTvCommands(handler: TvCommandHandler): void {
  const { addHandler } = useTvShell();
  const ref = React.useRef(handler);
  ref.current = handler;
  React.useEffect(() => addHandler((cmd, src) => ref.current(cmd, src)), [addHandler]);
}

/** Raw keys for a screen (typing on the code screen, showing the meeting bar…). */
export function useTvKeys(handler: TvKeyHandler): void {
  const { addKeyHandler } = useTvShell();
  const ref = React.useRef(handler);
  ref.current = handler;
  React.useEffect(() => addKeyHandler((e, k) => ref.current(e, k)), [addKeyHandler]);
}

interface Toast {
  id: number;
  text: string;
}

interface VoiceHud {
  phase: 'listening' | 'result';
  heard: string;
  text: string;
  ok: boolean;
}

function nextVolume(
  cur: { volume: number; muted: boolean },
  cmd: Extract<TvCommand, { type: 'volume' }>,
): { volume: number; muted: boolean } {
  let volume = cur.volume;
  let muted = cur.muted;
  if (typeof cmd.level === 'number') volume = cmd.level;
  if (typeof cmd.delta === 'number') volume = Math.max(0, Math.min(100, volume + cmd.delta));
  if (typeof cmd.muted === 'boolean') muted = cmd.muted;
  else if (typeof cmd.delta === 'number' || typeof cmd.level === 'number') muted = false;
  return { volume, muted };
}

function describe(cmd: TvCommand, t: (k: string, p?: Record<string, string | number>) => string): string {
  switch (cmd.type) {
    case 'mic':
      return cmd.on === false ? t('tv.fb.micOff') : cmd.on ? t('tv.fb.micOn') : t('tv.fb.mic');
    case 'cam':
      return cmd.on === false ? t('tv.fb.camOff') : cmd.on ? t('tv.fb.camOn') : t('tv.fb.cam');
    case 'captions':
      return cmd.on === false ? t('tv.fb.captionsOff') : t('tv.fb.captionsOn');
    case 'hand':
      return cmd.on === false ? t('tv.fb.handDown') : t('tv.fb.handUp');
    case 'layout':
      return cmd.mode === 'tile' ? t('tv.view.grid') : t('tv.view.speaker');
    case 'view':
      return t(`tv.view.${cmd.view}`);
    case 'join':
      return t('tv.fb.joining', { code: cmd.code });
    case 'leave':
      return t('tv.leave');
    case 'endForAll':
      return t('tv.endForAll');
    case 'volume':
      return cmd.muted === true ? t('tv.fb.soundOff') : cmd.muted === false ? t('tv.fb.soundOn') : t('tv.volume');
    case 'panel':
      return cmd.panel === 'people' ? t('tv.people') : cmd.panel === 'chat' ? t('tv.chat') : t('common.close');
    case 'home':
      return t('tv.home');
    case 'help':
      return t('tv.help');
    default:
      return '';
  }
}

export function TvShell({ children }: { children: React.ReactNode }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [identity, setIdentity] = React.useState<TvIdentity | null>(null);
  const [recents, setRecents] = React.useState<TvRecent[]>([]);
  const [{ volume, muted }, setVol] = React.useState({ volume: 80, muted: false });
  const [screen, setScreen] = React.useState<ScreenReport>({ screen: 'home' });
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [hud, setHud] = React.useState<VoiceHud | null>(null);
  const [volumeHud, setVolumeHud] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const handlersRef = React.useRef<TvCommandHandler[]>([]);
  const keyHandlersRef = React.useRef<TvKeyHandler[]>([]);
  /** The remote whose voice command is running: it gets the feedback line too */
  const feedbackToRef = React.useRef<string | null>(null);
  const lastHeardRef = React.useRef('');
  /** A shell dialog (approval, help) is open: it owns the D-pad */
  const shellModalRef = React.useRef(false);
  const pendingRef = React.useRef<PairedRemote | null>(null);
  const pairingRef = React.useRef<ReturnType<typeof useTvPairing> | null>(null) as React.MutableRefObject<ReturnType<typeof useTvPairing>>;

  React.useEffect(() => {
    setIdentity(loadTvIdentity());
    setRecents(loadRecents());
    setVol(loadVolume());
    registerTvPlatformKeys();
  }, []);

  // Mirror focus into [data-tv-focus]: some TV WebViews (and a window in the background)
  // keep document.activeElement but stop painting :focus, and the TV must always show it.
  React.useEffect(() => {
    let marked: Element | null = null;
    const mark = (el: Element | null) => {
      if (marked === el) return;
      marked?.removeAttribute('data-tv-focus');
      marked = el;
      marked?.setAttribute('data-tv-focus', '');
    };
    const onIn = (e: FocusEvent) => mark(e.target instanceof Element ? e.target : null);
    const onOut = () =>
      setTimeout(() => {
        if (document.hasFocus() && (!document.activeElement || document.activeElement === document.body)) mark(null);
      }, 0);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      mark(null);
    };
  }, []);

  const toast = React.useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, text }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 4200);
  }, []);

  const hudTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const showResult = React.useCallback((heard: string, text: string, ok: boolean) => {
    setHud({ phase: 'result', heard, text, ok });
    if (hudTimer.current) clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setHud(null), ok ? 2600 : 5200);
  }, []);

  // ── Volume: every <audio>/<video> on the page, including ones the meeting adds later ──
  React.useEffect(() => {
    const apply = (el: HTMLMediaElement) => {
      el.volume = volume / 100;
      if (el.tagName === 'AUDIO') el.muted = muted;
    };
    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach(apply);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLMediaElement) apply(n);
          else if (n instanceof Element) n.querySelectorAll<HTMLMediaElement>('audio, video').forEach(apply);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [volume, muted]);

  const volRef = React.useRef({ volume, muted });
  volRef.current = { volume, muted };
  const volumeHudTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeVolume = React.useCallback((cmd: Extract<TvCommand, { type: 'volume' }>) => {
    setVol((cur) => {
      const next = nextVolume(cur, cmd);
      saveVolume(next.volume, next.muted);
      return next;
    });
    setVolumeHud(true);
    if (volumeHudTimer.current) clearTimeout(volumeHudTimer.current);
    volumeHudTimer.current = setTimeout(() => setVolumeHud(false), 2200);
  }, []);

  const runRef = React.useRef<(cmd: TvCommand, source: CommandSource) => void>(() => undefined);

  const voice = useSpeechCapture(
    locale,
    (text) => runRef.current({ type: 'voice', text }, 'voice'),
    (reason) => showResult('', t(`tv.voice.err.${reason}`), false),
  );

  const startVoice = React.useCallback(() => {
    if (!voice.supported) {
      showResult('', t('tv.voice.err.unsupported'), false);
      return;
    }
    feedbackToRef.current = null;
    setHud({ phase: 'listening', heard: '', text: '', ok: true });
    voice.start();
  }, [voice, showResult, t]);

  const pairing = useTvPairing({
    identity,
    onIdentityChange: (next) => {
      saveTvIdentity(next);
      setIdentity(next);
    },
    onCommand: (cmd, from) => {
      feedbackToRef.current = from.identity;
      runRef.current(cmd, 'remote');
    },
    onRemoteJoined: (r) => toast(t('tv.toast.remoteOn', { name: r.name, device: r.device })),
    onRemoteLeft: (r) => toast(t('tv.toast.remoteOff', { name: r.name })),
  });

  const feedback = React.useCallback(
    (text: string, ok = true) => {
      const to = feedbackToRef.current;
      if (to) pairing.sendFeedback(to, lastHeardRef.current, text, ok);
      if (lastHeardRef.current || !ok) showResult(lastHeardRef.current, text, ok);
    },
    [pairing, showResult],
  );

  const run = React.useCallback(
    (cmd: TvCommand, source: CommandSource) => {
      if (source !== 'voice' && cmd.type !== 'voice') lastHeardRef.current = '';
      if (cmd.type === 'voice') {
        const match = parseVoiceCommand(cmd.text);
        lastHeardRef.current = cmd.text.trim();
        if (!match) {
          feedback(t('tv.voice.notUnderstood'), false);
          return;
        }
        run(match.command, 'voice');
        return;
      }
      if (cmd.type === 'volume') {
        const next = nextVolume(volRef.current, cmd);
        changeVolume(cmd);
        if (lastHeardRef.current) feedback(next.muted ? t('tv.fb.soundOff') : t('tv.fb.volumeLevel', { n: next.volume }));
        return;
      }
      if (cmd.type === 'help') {
        setHelpOpen(true);
        if (lastHeardRef.current) feedback(describe(cmd, t));
        return;
      }
      // A dialog of the shell (a phone asking to connect, help) is on top: it gets the D-pad
      if (cmd.type === 'key' && shellModalRef.current) {
        const pending = pendingRef.current;
        if (cmd.key === 'ok') pressFocused();
        else if (cmd.key === 'back') {
          if (pending) pairingRef.current.deny(pending.identity);
          else setHelpOpen(false);
        } else moveFocus(cmd.key);
        return;
      }
      for (let i = handlersRef.current.length - 1; i >= 0; i--) {
        if (handlersRef.current[i](cmd, source)) {
          if (lastHeardRef.current) feedback(describe(cmd, t));
          return;
        }
      }
      // Nobody on screen took it: D-pad defaults
      if (cmd.type === 'key') {
        if (cmd.key === 'ok') pressFocused();
        else if (cmd.key === 'back') {
          if (pathname !== '/tv') router.push('/tv');
        } else moveFocus(cmd.key);
        return;
      }
      if (cmd.type === 'home') {
        router.push('/tv');
        return;
      }
      if (cmd.type === 'join') {
        router.push(`/tv/rooms/${encodeURIComponent(cmd.code)}`);
        if (lastHeardRef.current) feedback(describe(cmd, t));
        return;
      }
      feedback(t('tv.fb.notHere'), false);
    },
    [changeVolume, feedback, pathname, router, t],
  );
  runRef.current = run;

  // ── Keys from the TV remote (or a keyboard) ──
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = normalizeRemoteKey(e);
      // Screens don't see raw keys while a shell dialog is up (it would only wake the meeting bar)
      for (let i = shellModalRef.current ? -1 : keyHandlersRef.current.length - 1; i >= 0; i--) {
        if (keyHandlersRef.current[i](e, key)) {
          e.preventDefault();
          return;
        }
      }
      // Keyboard stand-ins for the colour buttons, so a laptop can drive the TV app
      const fkeys: Record<string, TvKeyPress['key']> = { F1: 'red', F2: 'green', F3: 'yellow', F4: 'blue' };
      const k: TvKeyPress | null = key ?? (fkeys[e.key] ? { key: fkeys[e.key] } : e.key === 'v' || e.key === 'BrowserSearch' ? { key: 'blue' } : e.key === '?' ? { key: 'menu' } : null);
      if (!k) return;
      e.preventDefault();
      switch (k.key) {
        case 'up':
        case 'down':
        case 'left':
        case 'right':
        case 'ok':
        case 'back':
          feedbackToRef.current = null;
          run({ type: 'key', key: k.key }, 'key');
          break;
        case 'red':
          run({ type: 'leave' }, 'key');
          break;
        case 'green':
        case 'playPause':
          run({ type: 'mic' }, 'key');
          break;
        case 'yellow':
          run({ type: 'cam' }, 'key');
          break;
        case 'blue':
          startVoice();
          break;
        case 'menu':
          setHelpOpen((o) => !o);
          break;
        case 'home':
          run({ type: 'home' }, 'key');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, startVoice]);

  // Remote approval: a dialog the TV user answers with OK
  const pendingRemote = pairing.pending[0] ?? null;
  pendingRef.current = pendingRemote;
  pairingRef.current = pairing;
  shellModalRef.current = Boolean(pendingRemote) || helpOpen;
  React.useEffect(() => {
    if (!pendingRemote) return;
    const timer = setTimeout(() => pairing.deny(pendingRemote.identity), 30_000);
    setTimeout(() => focusDefault());
    return () => clearTimeout(timer);
  }, [pendingRemote, pairing]);

  React.useEffect(() => {
    if (helpOpen) setTimeout(() => focusDefault());
    else if (!focusInRoot()) setTimeout(() => focusDefault());
  }, [helpOpen]);

  // ── What remotes see ──
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://meet.kloud.cn';
  const remoteUrl = `${origin.replace(/^https?:\/\//, '')}/tv/remote`;
  const qrUrl = identity ? `${origin}/tv/remote?c=${identity.code}&s=${identity.secret}` : '';

  React.useEffect(() => {
    if (!identity) return;
    pairing.publishState({
      name: identity.name,
      screen: screen.screen,
      pendingCode: screen.pendingCode ?? null,
      pendingTitle: screen.pendingTitle ?? null,
      meeting: screen.meeting ?? null,
      volume,
      muted,
      recents,
      tvVoice: voice.supported,
      confirm: screen.confirm ?? null,
    });
  }, [identity, screen, volume, muted, recents, voice.supported, pairing]);

  const api = React.useMemo<TvShellApi | null>(() => {
    if (!identity) return null;
    return {
      identity,
      rename: (name) => {
        const next = { ...identity, name: name.trim().slice(0, 40) || identity.name };
        saveTvIdentity(next);
        setIdentity(next);
      },
      resetPairing: () => {
        forgetTrustedRemotes();
        const next = { ...identity, code: newPairCode(), secret: randomToken(16) };
        saveTvIdentity(next);
        setIdentity(next);
      },
      pairStatus: pairing.status,
      remotes: pairing.remotes,
      remoteUrl,
      qrUrl,
      report: (s) => setScreen((prev) => (JSON.stringify(prev) === JSON.stringify(s) ? prev : s)),
      run,
      addHandler: (h) => {
        handlersRef.current.push(h);
        return () => {
          handlersRef.current = handlersRef.current.filter((x) => x !== h);
        };
      },
      addKeyHandler: (h) => {
        keyHandlersRef.current.push(h);
        return () => {
          keyHandlersRef.current = keyHandlersRef.current.filter((x) => x !== h);
        };
      },
      volume,
      muted,
      recents,
      addRecent: (code, title) => setRecents(rememberRecent(code, title)),
      tvVoice: voice.supported,
      startVoice,
      toast,
      feedback,
      openHelp: () => setHelpOpen(true),
    };
  }, [identity, pairing.status, pairing.remotes, remoteUrl, qrUrl, run, volume, muted, recents, voice.supported, startVoice, toast, feedback]);

  if (!api) return <div className={styles.blank} />;

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  return (
    <TvShellContext.Provider value={api}>
      {children}
      <TvStage layer>
        {/* Toasts */}
        <div className={styles.toasts} aria-live="polite">
          {toasts.map((x) => (
            <div key={x.id} className={styles.toast}>
              <Smartphone size={28} strokeWidth={2} />
              <span>{x.text}</span>
            </div>
          ))}
        </div>

        {/* Volume */}
        {volumeHud && (
          <div className={styles.volumeHud} role="status">
            <VolIcon size={36} />
            <div className={styles.volumeTrack}>
              <div className={styles.volumeFill} style={{ height: `${muted ? 0 : volume}%` }} />
            </div>
            <span className={styles.volumeValue}>{muted ? t('tv.fb.soundOff') : volume}</span>
          </div>
        )}

        {/* Voice */}
        {(hud || voice.listening) && (
          <div className={`${styles.voiceHud} ${hud?.phase === 'result' && !hud.ok ? styles.voiceHudWarn : ''}`} role="status">
            <span className={`${styles.voiceMic} ${voice.listening ? styles.voiceMicLive : ''}`}>
              <Mic size={34} strokeWidth={2.2} />
            </span>
            <div className={styles.voiceText}>
              {voice.listening ? (
                <>
                  <span className={styles.voiceHeard}>{voice.interim || t('tv.voice.listening')}</span>
                  {!voice.interim && <span className={styles.voiceHint}>{t('tv.voice.try')}</span>}
                </>
              ) : (
                <>
                  {hud?.heard && <span className={styles.voiceHint}>“{hud.heard}”</span>}
                  <span className={styles.voiceHeard}>{hud?.text}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* A phone asks to become a remote */}
        {pendingRemote && (
          <div className={styles.scrim} data-tv-modal>
            <div className={styles.dialog} role="alertdialog" aria-labelledby="tv-approve-title">
              <span className={styles.dialogIcon}>
                <Smartphone size={44} />
              </span>
              <h2 id="tv-approve-title" className={styles.dialogTitle}>
                {t('tv.approve.title', { name: pendingRemote.name })}
              </h2>
              <p className={styles.dialogBody}>{t('tv.approve.body', { device: pendingRemote.device })}</p>
              <div className={styles.dialogActions}>
                <button type="button" className={styles.btnPrimary} data-tv-autofocus onClick={() => pairing.approve(pendingRemote.identity, true)}>
                  {t('tv.approve.allow')}
                </button>
                <button type="button" className={styles.btnSecondary} onClick={() => pairing.deny(pendingRemote.identity)}>
                  {t('tv.approve.deny')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Help */}
        {helpOpen && !pendingRemote && (
          <div className={styles.scrim} data-tv-modal>
            <div className={`${styles.dialog} ${styles.helpDialog}`} role="dialog" aria-labelledby="tv-help-title">
              <h2 id="tv-help-title" className={styles.dialogTitle}>{t('tv.help.title')}</h2>
              <div className={styles.helpGrid}>
                <section>
                  <h3 className={styles.helpHeading}>{t('tv.help.remote')}</h3>
                  <ul className={styles.keyList}>
                    <li><span className={styles.keyCap}>◀ ▲ ▼ ▶</span>{t('tv.keys.move')}</li>
                    <li><span className={styles.keyCap}>OK</span>{t('tv.keys.select')}</li>
                    <li><span className={styles.keyCap}>Back</span>{t('tv.keys.back')}</li>
                    <li><span className={`${styles.colorKey} ${styles.keyGreen}`} />{t('tv.keys.green')}</li>
                    <li><span className={`${styles.colorKey} ${styles.keyYellow}`} />{t('tv.keys.yellow')}</li>
                    <li><span className={`${styles.colorKey} ${styles.keyBlue}`} />{t('tv.keys.blue')}</li>
                    <li><span className={`${styles.colorKey} ${styles.keyRed}`} />{t('tv.keys.red')}</li>
                  </ul>
                </section>
                <section>
                  <h3 className={styles.helpHeading}>{t('tv.help.voice')}</h3>
                  <ul className={styles.sayList}>
                    {VOICE_EXAMPLES.map((x) => (
                      <li key={x}>“{x}”</li>
                    ))}
                  </ul>
                  <p className={styles.helpNote}>{voice.supported ? t('tv.help.voiceTv') : t('tv.help.voicePhone')}</p>
                </section>
                <section className={styles.helpPhone}>
                  <h3 className={styles.helpHeading}>{t('tv.help.phone')}</h3>
                  <div className={styles.qrSmall}>
                    <QrCode value={qrUrl} />
                  </div>
                  <p className={styles.helpNote}>
                    {api.remoteUrl} · <strong>{formatPairCode(identity!.code)}</strong>
                  </p>
                </section>
              </div>
              <div className={styles.dialogActions}>
                <button type="button" className={styles.btnPrimary} data-tv-autofocus onClick={() => setHelpOpen(false)}>
                  {t('tv.help.done')}
                </button>
              </div>
            </div>
          </div>
        )}
      </TvStage>
    </TvShellContext.Provider>
  );
}

