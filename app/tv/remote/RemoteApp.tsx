'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Captions,
  CaptionsOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  Hand,
  House,
  Keyboard,
  LayoutGrid,
  LoaderCircle,
  Mic,
  MicOff,
  PenTool,
  PhoneOff,
  ScreenShare,
  SquareUserRound,
  Tv,
  Users,
  Video,
  VideoOff,
  Volume1,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { authFetch, authHeaders, getKloudSessionBearer } from '@/lib/kloudSession';
import { getInitials } from '@/lib/getInitials';
import {
  loadLastTv,
  loadRemoteIdentity,
  saveLastTv,
  saveRemoteIdentity,
  type LastTv,
  type RemoteIdentity,
} from '@/lib/tv/deviceIdentity';
import { formatPairCode, isPairCode, normalizeMeetingCode, type TvCommand, type TvState, type TvView } from '@/lib/tv/protocol';
import { useSpeechCapture } from '@/lib/tv/useSpeechCapture';
import { useRemoteLink } from './useRemoteLink';
import styles from '@/styles/TvRemote.module.css';

const VIEW_ICON: Record<TvView, LucideIcon> = {
  webcam: Video,
  liveDoc: FileText,
  shareScreen: ScreenShare,
  design: PenTool,
};

const RECONNECT_WINDOW_MS = 30 * 60_000;

function signedInName(): string {
  try {
    const raw = localStorage.getItem('kloudUser') ?? sessionStorage.getItem('kloudUser');
    const u = raw ? JSON.parse(raw) : null;
    return typeof u?.displayName === 'string' ? u.displayName : typeof u?.username === 'string' ? u.username : '';
  } catch {
    return '';
  }
}

function elapsed(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function RemoteApp() {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const [identity, setIdentity] = React.useState<RemoteIdentity | null>(null);
  const [lastTv, setLastTv] = React.useState<LastTv | null>(null);
  const link = useRemoteLink(identity);
  const [codeInput, setCodeInput] = React.useState('');
  const [nameInput, setNameInput] = React.useState('');
  const autoRef = React.useRef(false);

  React.useEffect(() => {
    const id = loadRemoteIdentity();
    const name = signedInName() || id.name;
    const withName = { ...id, name };
    setIdentity(withName);
    setNameInput(name);
    setLastTv(loadLastTv());
  }, []);

  // Opened from the TV's QR code: connect right away and drop the secret from the address bar.
  // Reopened (or reloaded) soon after using a TV: reconnect to it.
  React.useEffect(() => {
    if (!identity || autoRef.current) return;
    const c = params?.get('c');
    const s = params?.get('s') ?? undefined;
    if (isPairCode(c)) {
      autoRef.current = true;
      window.history.replaceState(null, '', '/tv/remote');
      void link.connect(c, s);
      return;
    }
    const last = loadLastTv();
    if (last?.at && Date.now() - last.at < RECONNECT_WINDOW_MS) {
      autoRef.current = true;
      // quiet: if the TV is restarting too, keep looking for it instead of "TV not found"
      void link.connect(last.code, last.secret, true);
    }
  }, [identity, params, link]);

  const startPair = (code: string, secret?: string) => {
    if (!identity) return;
    const name = nameInput.trim().slice(0, 40);
    const next = { ...identity, name };
    saveRemoteIdentity(next);
    setIdentity(next);
    // useRemoteLink reads the identity through a ref; give React a tick to update it
    setTimeout(() => void link.connect(code, secret), 0);
  };

  const { status, state } = link;
  const connected = status === 'connected' && state;

  return (
    <div className={styles.app} data-theme-remote="dark">
      <header className={styles.header}>
        <span className={styles.headerIcon}>
          <Tv size={20} />
        </span>
        <div className={styles.headerText}>
          <span className={styles.headerTitle}>{link.tvName || 'Kloud Meet TV'}</span>
          <span className={styles.headerStatus}>
            <span
              className={`${styles.dot} ${
                status === 'connected' ? styles.dotLive : status === 'lost' || status === 'pending' || status === 'connecting' ? styles.dotWarn : ''
              }`}
            />
            {t(`tv.remote.status.${status}`)}
          </span>
        </div>
        {status !== 'idle' && (
          <button type="button" className={styles.headerClose} onClick={link.disconnect} aria-label={t('tv.remote.disconnect')}>
            <X size={20} />
          </button>
        )}
      </header>

      {(status === 'idle' || status === 'notFound' || status === 'error' || status === 'denied') && (
        <PairForm
          code={codeInput}
          setCode={setCodeInput}
          name={nameInput}
          setName={setNameInput}
          error={status === 'idle' ? null : t(`tv.remote.err.${status}`)}
          lastTv={lastTv}
          onConnect={(c) => startPair(c)}
          onReconnect={(l) => startPair(l.code, l.secret)}
          onForget={() => {
            saveLastTv(null);
            setLastTv(null);
          }}
        />
      )}

      {(status === 'connecting' || status === 'pending' || (status === 'connected' && !state)) && (
        <div className={styles.waiting}>
          <LoaderCircle className={styles.spin} size={36} />
          <p className={styles.waitingTitle}>{status === 'pending' ? t('tv.remote.confirmOnTv') : t('tv.remote.connecting')}</p>
          {status === 'pending' && <p className={styles.waitingBody}>{t('tv.remote.confirmOnTvBody')}</p>}
        </div>
      )}

      {status === 'lost' && (
        <div className={styles.waiting}>
          <LoaderCircle className={styles.spin} size={36} />
          <p className={styles.waitingTitle}>{t('tv.remote.lost')}</p>
          <p className={styles.waitingBody}>{t('tv.remote.lostBody')}</p>
        </div>
      )}

      {connected && (state.screen === 'meeting' && state.meeting ? (
        <MeetingRemote state={state} send={link.send} />
      ) : (
        <LobbyRemote state={state} send={link.send} />
      ))}

      {connected && <VoiceDock locale={locale} send={link.send} />}
      <FeedbackSnack feedback={link.feedback} />
    </div>
  );
}

function PairForm({
  code,
  setCode,
  name,
  setName,
  error,
  lastTv,
  onConnect,
  onReconnect,
  onForget,
}: {
  code: string;
  setCode: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  error: string | null;
  lastTv: LastTv | null;
  onConnect: (code: string) => void;
  onReconnect: (last: LastTv) => void;
  onForget: () => void;
}) {
  const { t } = useI18n();
  const [host, setHost] = React.useState('meet.kloud.cn');
  React.useEffect(() => setHost(window.location.host), []);
  const digits = code.replace(/\D/g, '').slice(0, 6);
  return (
    <main className={styles.pair}>
      <h1 className={styles.pairTitle}>{t('tv.remote.pairTitle')}</h1>
      <p className={styles.pairBody}>
        {t('tv.remote.pairBody', { host })}
      </p>
      <form
        className={styles.pairForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (digits.length === 6) onConnect(digits);
        }}
      >
        <label className={styles.fieldLabel} htmlFor="tv-code">
          {t('tv.pair.codeLabel')}
        </label>
        <input
          id="tv-code"
          className={styles.codeInput}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123 456"
          value={formatPairCode(digits)}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={Boolean(error)}
        />
        <label className={styles.fieldLabel} htmlFor="tv-name">
          {t('tv.remote.yourName')}
        </label>
        <input
          id="tv-name"
          className={styles.textInput}
          placeholder={t('tv.remote.namePlaceholder')}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={styles.primary} disabled={digits.length !== 6}>
          {t('tv.remote.connect')}
        </button>
      </form>
      {lastTv && (
        <div className={styles.lastTv}>
          <button type="button" className={styles.lastTvBtn} onClick={() => onReconnect(lastTv)}>
            <Tv size={20} />
            <span>
              {t('tv.remote.reconnect', { name: lastTv.tvName || 'TV' })}
              <small>{formatPairCode(lastTv.code)}</small>
            </span>
          </button>
          <button type="button" className={styles.linkBtn} onClick={onForget}>
            {t('tv.remote.forget')}
          </button>
        </div>
      )}
    </main>
  );
}

interface MyMeeting {
  roomName: string;
  title: string | null;
  isActive: boolean;
  scheduledFor: string | null;
}

function useMyMeetings(): MyMeeting[] | null {
  const [list, setList] = React.useState<MyMeeting[] | null>(null);
  React.useEffect(() => {
    if (!getKloudSessionBearer()) return;
    let cancelled = false;
    authFetch('/api/account/meetings?page=1&pageSize=20', { headers: authHeaders(), cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { meetings?: Array<Record<string, unknown>> } | null) => {
        if (cancelled || !data?.meetings) return;
        const now = Date.now();
        const rows = data.meetings
          .map((m) => ({
            roomName: String(m.roomName ?? ''),
            title: typeof m.title === 'string' && m.title.trim() ? m.title : null,
            isActive: m.isActive === true,
            scheduledFor: typeof m.scheduledFor === 'string' ? m.scheduledFor : null,
            status: String(m.status ?? ''),
          }))
          .filter((m) => m.roomName && m.status !== 'ENDED' && m.status !== 'CANCELLED')
          .filter((m) => m.isActive || (m.scheduledFor && new Date(m.scheduledFor).getTime() > now - 30 * 60_000 && new Date(m.scheduledFor).getTime() < now + 24 * 3600_000))
          .sort((a, b) => Number(b.isActive) - Number(a.isActive) || (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))
          .slice(0, 5);
        setList(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return list;
}

function LobbyRemote({ state, send }: { state: TvState; send: (c: TvCommand) => void }) {
  const { t, locale } = useI18n();
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const mine = useMyMeetings();
  const waiting = ['checking', 'prejoin', 'waitingForHost', 'knocking', 'connecting', 'refused'].includes(state.screen);

  const joinCode = (raw: string) => {
    const c = normalizeMeetingCode(raw);
    if (!c) {
      setError(t('tv.join.invalid'));
      return;
    }
    setError(null);
    setCode('');
    send({ type: 'join', code: c });
  };

  return (
    <main className={styles.body}>
      {waiting && (
        <section className={styles.statusCard}>
          <p className={styles.statusEyebrow}>{state.pendingCode}</p>
          <p className={styles.statusTitle}>{state.pendingTitle || state.pendingCode}</p>
          <p className={styles.statusLine}>{t(`tv.remote.screen.${state.screen}`)}</p>
          <div className={styles.statusActions}>
            {state.screen === 'prejoin' && (
              <button type="button" className={styles.primary} onClick={() => send({ type: 'confirm' })}>
                {t('tv.prejoin.join')}
              </button>
            )}
            <button type="button" className={styles.secondary} onClick={() => send({ type: 'cancel' })}>
              {t('common.cancel')}
            </button>
          </div>
        </section>
      )}

      {!waiting && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{t('tv.remote.joinTitle')}</h2>
          <form
            className={styles.joinRow}
            onSubmit={(e) => {
              e.preventDefault();
              joinCode(code);
            }}
          >
            <input
              className={styles.textInput}
              placeholder={t('tv.remote.joinPlaceholder')}
              value={code}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit" className={styles.primary} disabled={!code.trim()}>
              {t('tv.remote.joinOnTv')}
            </button>
          </form>
          {error && <p className={styles.error}>{error}</p>}
        </section>
      )}

      {!waiting && mine && mine.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{t('tv.remote.myMeetings')}</h2>
          <ul className={styles.list}>
            {mine.map((m) => (
              <li key={m.roomName} className={styles.listRow}>
                <div className={styles.listText}>
                  <span className={styles.listTitle}>{m.title || m.roomName}</span>
                  <span className={styles.listMeta}>
                    {m.isActive ? (
                      <span className={styles.liveTag}>{t('tv.remote.live')}</span>
                    ) : m.scheduledFor ? (
                      new Date(m.scheduledFor).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
                    ) : null}
                    {m.title ? ` · ${m.roomName}` : ''}
                  </span>
                </div>
                <button type="button" className={styles.smallBtn} onClick={() => send({ type: 'join', code: m.roomName })}>
                  {t('tv.remote.onTv')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!waiting && state.recents.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{t('tv.remote.recentOnTv')}</h2>
          <div className={styles.chips}>
            {state.recents.slice(0, 4).map((r) => (
              <button key={r.code} type="button" className={styles.chip} onClick={() => send({ type: 'join', code: r.code })}>
                {r.title || r.code}
              </button>
            ))}
          </div>
        </section>
      )}

      <DPad send={send} />
      <VolumeRow state={state} send={send} />
    </main>
  );
}

function MeetingRemote({ state, send }: { state: TvState; send: (c: TvCommand) => void }) {
  const { t } = useI18n();
  const m = state.meeting!;
  const [now, setNow] = React.useState(() => Date.now());
  const [sheet, setSheet] = React.useState(false);
  const [showPeople, setShowPeople] = React.useState(false);
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className={styles.body}>
      <section className={styles.meetHead}>
        <div className={styles.meetHeadText}>
          <span className={styles.meetTitle}>{m.title || m.code}</span>
          <span className={styles.meetMeta}>
            {m.recording && <span className={styles.recTag}>REC</span>}
            {elapsed(m.joinedAt, now)} · {t((m.peopleCount) === 1 ? 'tv.peopleOne' : 'tv.peopleCount', { n: m.peopleCount })}
          </span>
        </div>
      </section>

      <div className={styles.bigRow}>
        <button
          type="button"
          className={`${styles.bigBtn} ${m.mic ? styles.live : styles.off}`}
          onClick={() => send({ type: 'mic', on: !m.mic })}
          aria-pressed={m.mic}
        >
          {m.mic ? <Mic size={34} /> : <MicOff size={34} />}
          <span>{m.mic ? t('tv.ctl.mute') : t('tv.ctl.unmute')}</span>
        </button>
        <button
          type="button"
          className={`${styles.bigBtn} ${m.cam ? styles.live : styles.off}`}
          onClick={() => send({ type: 'cam', on: !m.cam })}
          aria-pressed={m.cam}
        >
          {m.cam ? <Video size={34} /> : <VideoOff size={34} />}
          <span>{m.cam ? t('tv.ctl.stopVideo') : t('tv.ctl.startVideo')}</span>
        </button>
      </div>

      <div className={styles.grid4}>
        <button type="button" className={`${styles.tool} ${m.captions ? styles.toolOn : ''}`} onClick={() => send({ type: 'captions', on: !m.captions })}>
          {m.captions ? <Captions size={24} /> : <CaptionsOff size={24} />}
          <span>{t('tv.ctl.captions')}</span>
        </button>
        <button type="button" className={`${styles.tool} ${m.hand ? styles.toolOn : ''}`} onClick={() => send({ type: 'hand', on: !m.hand })}>
          <Hand size={24} />
          <span>{m.hand ? t('tv.ctl.lowerHand') : t('tv.ctl.raiseHand')}</span>
        </button>
        <button
          type="button"
          className={styles.tool}
          onClick={() => send({ type: 'layout', mode: m.layout === 'spotlight' ? 'tile' : 'spotlight' })}
        >
          {m.layout === 'spotlight' ? <SquareUserRound size={24} /> : <LayoutGrid size={24} />}
          <span>{m.layout === 'spotlight' ? t('tv.view.speaker') : t('tv.view.grid')}</span>
        </button>
        <button
          type="button"
          className={`${styles.tool} ${showPeople ? styles.toolOn : ''}`}
          onClick={() => {
            setShowPeople((v) => !v);
            send({ type: 'panel', panel: showPeople ? null : 'people' });
          }}
        >
          <Users size={24} />
          <span>{t('tv.people')}</span>
        </button>
      </div>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{t('tv.remote.onScreen')}</h2>
        <div className={styles.segmented} role="radiogroup">
          {m.views.map((v) => {
            const Icon = VIEW_ICON[v];
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={m.view === v}
                className={`${styles.seg} ${m.view === v ? styles.segOn : ''}`}
                onClick={() => send({ type: 'view', view: v })}
              >
                <Icon size={18} />
                <span>{t(`tv.view.${v}`)}</span>
              </button>
            );
          })}
        </div>
        <p className={styles.note}>{m.isHost ? t('tv.view.forEveryone') : t('tv.view.onlyThisTv')}</p>
      </section>

      <VolumeRow state={state} send={send} />

      {showPeople && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>{t((m.peopleCount) === 1 ? 'tv.peopleOne' : 'tv.peopleCount', { n: m.peopleCount })}</h2>
          <ul className={styles.list}>
            {m.people.map((p) => (
              <li key={p.id} className={styles.personRow}>
                <span className={styles.avatar}>{getInitials(p.name)}</span>
                <span className={styles.personName}>
                  {p.name}
                  {(p.me || p.host) && (
                    <small>{[p.me ? t('tv.thisTv') : null, p.host ? t('tv.host') : null].filter(Boolean).join(' · ')}</small>
                  )}
                </span>
                {p.hand && <Hand size={18} className={styles.handIcon} />}
                {p.mic ? <Mic size={18} className={styles.micOn} /> : <MicOff size={18} className={styles.micOff} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <DPad send={send} compact />

      <button type="button" className={styles.leave} onClick={() => setSheet(true)}>
        <PhoneOff size={22} />
        {t('tv.remote.leaveOnTv')}
      </button>

      {(sheet || state.confirm) && (
        <div className={styles.sheetScrim} onClick={() => setSheet(false)}>
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="rc-leave">
            <h2 id="rc-leave" className={styles.sheetTitle}>
              {state.confirm === 'endForAll' ? t('tv.confirm.endTitle') : t('tv.confirm.leaveTitle')}
            </h2>
            <p className={styles.sheetBody}>{t('tv.confirm.leaveBody', { title: m.title || m.code })}</p>
            <button
              type="button"
              className={styles.danger}
              onClick={() => {
                setSheet(false);
                send({ type: 'leave', confirmed: true });
              }}
            >
              {t('tv.leave')}
            </button>
            {m.isHost && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setSheet(false);
                  send({ type: 'endForAll', confirmed: true });
                }}
              >
                {t('tv.endForAll')}
              </button>
            )}
            <button
              type="button"
              className={styles.ghost}
              onClick={() => {
                setSheet(false);
                if (state.confirm) send({ type: 'cancel' });
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function VolumeRow({ state, send }: { state: TvState; send: (c: TvCommand) => void }) {
  const { t } = useI18n();
  const Icon = state.muted || state.volume === 0 ? VolumeX : state.volume < 50 ? Volume1 : Volume2;
  return (
    <section className={styles.volume} aria-label={t('tv.volume')}>
      <button
        type="button"
        className={`${styles.volIcon} ${state.muted ? styles.toolOn : ''}`}
        onClick={() => send({ type: 'volume', muted: !state.muted })}
        aria-label={state.muted ? t('tv.fb.soundOn') : t('tv.fb.soundOff')}
      >
        <Icon size={22} />
      </button>
      <button type="button" className={styles.volStep} onClick={() => send({ type: 'volume', delta: -10 })} aria-label={t('tv.remote.volDown')}>
        −
      </button>
      <div className={styles.volTrack}>
        <div className={styles.volFill} style={{ width: `${state.muted ? 0 : state.volume}%` }} />
      </div>
      <button type="button" className={styles.volStep} onClick={() => send({ type: 'volume', delta: 10 })} aria-label={t('tv.remote.volUp')}>
        +
      </button>
    </section>
  );
}

function DPad({ send, compact = false }: { send: (c: TvCommand) => void; compact?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(!compact);
  const key = (k: 'up' | 'down' | 'left' | 'right' | 'ok' | 'back') => send({ type: 'key', key: k });
  if (!open) {
    return (
      <button type="button" className={styles.expand} onClick={() => setOpen(true)}>
        <Keyboard size={18} />
        {t('tv.remote.navigation')}
      </button>
    );
  }
  return (
    <section className={styles.dpadWrap} aria-label={t('tv.remote.navigation')}>
      <div className={styles.dpad}>
        <button type="button" className={`${styles.dKey} ${styles.dUp}`} onClick={() => key('up')} aria-label="Up">
          <ChevronUp size={28} />
        </button>
        <button type="button" className={`${styles.dKey} ${styles.dLeft}`} onClick={() => key('left')} aria-label="Left">
          <ChevronLeft size={28} />
        </button>
        <button type="button" className={styles.dOk} onClick={() => key('ok')}>
          OK
        </button>
        <button type="button" className={`${styles.dKey} ${styles.dRight}`} onClick={() => key('right')} aria-label="Right">
          <ChevronRight size={28} />
        </button>
        <button type="button" className={`${styles.dKey} ${styles.dDown}`} onClick={() => key('down')} aria-label="Down">
          <ChevronDown size={28} />
        </button>
      </div>
      <div className={styles.dRow}>
        <button type="button" className={styles.roundSmall} onClick={() => key('back')}>
          <ArrowLeft size={20} />
          <span>{t('tv.keys.back')}</span>
        </button>
        <button type="button" className={styles.roundSmall} onClick={() => send({ type: 'home' })}>
          <House size={20} />
          <span>{t('tv.home')}</span>
        </button>
      </div>
    </section>
  );
}

function VoiceDock({ locale, send }: { locale: string; send: (c: TvCommand) => void }) {
  const { t } = useI18n();
  const [typing, setTyping] = React.useState(false);
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const voice = useSpeechCapture(
    locale,
    (heard) => send({ type: 'voice', text: heard }),
    (reason) => {
      setError(t(`tv.voice.err.${reason}`));
      if (reason === 'unsupported' || reason === 'denied') setTyping(true);
    },
  );

  return (
    <div className={styles.voiceDock}>
      {typing ? (
        <form
          className={styles.typeRow}
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send({ type: 'voice', text: text.trim() });
            setText('');
          }}
        >
          <input
            className={styles.textInput}
            placeholder={t('tv.remote.typeCommand')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <button type="submit" className={styles.primary} disabled={!text.trim()}>
            {t('tv.remote.send')}
          </button>
          <button type="button" className={styles.iconGhost} onClick={() => setTyping(false)} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </form>
      ) : (
        <div className={styles.voiceRow}>
          <button
            type="button"
            className={`${styles.micBtn} ${voice.listening ? styles.micLive : ''}`}
            onClick={() => {
              setError(null);
              if (voice.listening) voice.stop();
              else if (voice.supported) voice.start();
              else {
                setError(t('tv.voice.err.unsupported'));
                setTyping(true);
              }
            }}
            aria-pressed={voice.listening}
          >
            <Mic size={26} />
            <span>{voice.listening ? voice.interim || t('tv.voice.listening') : t('tv.remote.speak')}</span>
          </button>
          <button type="button" className={styles.iconGhost} onClick={() => setTyping(true)} aria-label={t('tv.remote.typeCommand')}>
            <Keyboard size={22} />
          </button>
        </div>
      )}
      {error && !voice.listening && <p className={styles.voiceError}>{error}</p>}
    </div>
  );
}

function FeedbackSnack({ feedback }: { feedback: { id: number; heard: string; text: string; ok: boolean } | null }) {
  const [shown, setShown] = React.useState(feedback);
  React.useEffect(() => {
    if (!feedback) return;
    setShown(feedback);
    const id = setTimeout(() => setShown(null), feedback.ok ? 2600 : 4500);
    return () => clearTimeout(id);
  }, [feedback]);
  if (!shown) return null;
  return (
    <div className={`${styles.snack} ${shown.ok ? '' : styles.snackWarn}`} role="status">
      {shown.heard && <span className={styles.snackHeard}>“{shown.heard}”</span>}
      <span>{shown.text}</span>
    </div>
  );
}
