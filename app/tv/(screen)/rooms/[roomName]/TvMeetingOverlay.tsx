'use client';

import React from 'react';
import {
  Captions,
  CaptionsOff,
  Check,
  FileText,
  Hand,
  LayoutGrid,
  Mic,
  MicOff,
  PenTool,
  PhoneOff,
  ScreenShare,
  Smartphone,
  SquareUserRound,
  Users,
  Video,
  VideoOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { getInitials } from '@/lib/getInitials';
import type { TvMeetingState, TvView } from '@/lib/tv/protocol';
import type { TvRoomActions, TvRoomSnapshot } from '@/lib/tv/tvRoomBridge';
import { useTvCommands, useTvKeys, useTvShell } from '../../TvShell';
import { focusDefault, focusElement, focusInRoot } from '../../useSpatialNav';
import { TvStage } from '../../../components/TvStage';
import styles from '@/styles/Tv.module.css';

const HIDE_AFTER_MS = 7000;

const VIEW_ICON: Record<TvView, LucideIcon> = {
  webcam: Video,
  liveDoc: FileText,
  shareScreen: ScreenShare,
  design: PenTool,
};

function elapsed(from: number, now: number): string {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

export function TvMeetingOverlay({
  actionsRef,
  snapshot,
  code,
  title,
  joinedAt,
}: {
  actionsRef: React.MutableRefObject<TvRoomActions | null>;
  snapshot: TvRoomSnapshot | null;
  code: string;
  title: string;
  joinedAt: number;
}) {
  const { t } = useI18n();
  const shell = useTvShell();
  const [barVisible, setBarVisible] = React.useState(true);
  const [panel, setPanel] = React.useState<'people' | null>(null);
  const [menu, setMenu] = React.useState<'view' | null>(null);
  /** Where the View button is on the 1920-wide canvas: the menu opens right above it */
  const [menuX, setMenuX] = React.useState<number | null>(null);
  const [confirm, setConfirm] = React.useState<'leave' | 'endForAll' | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapRef = React.useRef(snapshot);
  snapRef.current = snapshot;

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const busy = panel !== null || menu !== null || confirm !== null;
  const poke = React.useCallback(() => {
    setBarVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setBarVisible(false);
      (document.activeElement as HTMLElement | null)?.blur?.();
    }, HIDE_AFTER_MS);
  }, []);
  React.useEffect(() => {
    if (busy) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setBarVisible(true);
    } else poke();
  }, [busy, poke]);
  React.useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  // Captions move up while the bar is showing (styles/tvRoom.css)
  React.useEffect(() => {
    document.documentElement.classList.toggle('km-tv-bar', barVisible);
    return () => document.documentElement.classList.remove('km-tv-bar');
  }, [barVisible]);

  // Focus: the bar's first button when it appears, the dialog / menu / panel when they open,
  // and back to the button that opened them when they close
  const openerRef = React.useRef<HTMLElement | null>(null);
  const wasBusyRef = React.useRef(false);
  React.useEffect(() => {
    const wasBusy = wasBusyRef.current;
    wasBusyRef.current = busy;
    if (busy && !wasBusy) openerRef.current = document.activeElement as HTMLElement | null;
    if (!busy && wasBusy) {
      const opener = openerRef.current;
      openerRef.current = null;
      setTimeout(() => {
        if (!opener || !document.contains(opener) || !focusElement(opener)) focusDefault();
      });
      return;
    }
    if (barVisible || busy) setTimeout(() => focusDefault());
  }, [barVisible, busy, confirm, menu, panel]);

  // The meeting may move focus while it connects: put it back on the bar once connected
  const connected = snapshot?.connected ?? false;
  React.useEffect(() => {
    if (connected && !focusInRoot()) setTimeout(() => focusDefault());
  }, [connected]);

  // What the phone remote sees
  React.useEffect(() => {
    const meeting: TvMeetingState | null = snapshot
      ? {
          code,
          title,
          joinedAt,
          mic: snapshot.mic,
          cam: snapshot.cam,
          captions: snapshot.captions,
          hand: snapshot.hand,
          view: snapshot.view,
          views: snapshot.views,
          layout: snapshot.layout,
          isHost: snapshot.isHost || snapshot.canEndForAll,
          recording: snapshot.recording,
          panel,
          peopleCount: snapshot.peopleCount,
          people: snapshot.people,
        }
      : null;
    shell.report({ screen: 'meeting', pendingCode: code, pendingTitle: title, meeting, confirm });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, panel, confirm, code, title, joinedAt]);

  const act = actionsRef.current;

  const askLeave = React.useCallback((kind: 'leave' | 'endForAll') => {
    setMenu(null);
    setConfirm(kind);
  }, []);

  // A key while the bar is hidden only wakes it up
  useTvKeys((e, key) => {
    if (!key) return false;
    const nav = key.key === 'up' || key.key === 'down' || key.key === 'left' || key.key === 'right' || key.key === 'ok';
    if (!barVisible && !busy && nav) {
      poke();
      return true;
    }
    poke();
    return false;
  });

  useTvCommands((cmd) => {
    const s = snapRef.current;
    const a = actionsRef.current;
    if (cmd.type !== 'key') poke();
    switch (cmd.type) {
      case 'key':
        if (cmd.key !== 'back') {
          if (!barVisible && !busy) {
            poke();
            return true;
          }
          poke();
          return false; // D-pad moves focus as usual
        }
        if (confirm) setConfirm(null);
        else if (menu) setMenu(null);
        else if (panel) setPanel(null);
        else askLeave('leave');
        return true;
      case 'mic':
        a?.setMic(cmd.on ?? !s?.mic);
        return true;
      case 'cam':
        a?.setCam(cmd.on ?? !s?.cam);
        return true;
      case 'captions':
        a?.setCaptions(cmd.on ?? !s?.captions);
        return true;
      case 'hand':
        a?.setHand(cmd.on ?? !s?.hand);
        return true;
      case 'layout':
        a?.setLayout(cmd.mode);
        return true;
      case 'view':
        if (s && !s.views.includes(cmd.view)) {
          shell.feedback(t('tv.fb.viewUnavailable'), false);
          return true;
        }
        a?.setView(cmd.view);
        setMenu(null);
        return true;
      case 'panel':
        if (cmd.panel === 'chat') {
          shell.feedback(t('tv.fb.chatOnPhone'), false);
          return true;
        }
        setPanel(cmd.panel);
        return true;
      case 'leave':
        if (cmd.confirmed) a?.leave();
        else askLeave('leave');
        return true;
      case 'endForAll':
        if (!s?.canEndForAll) {
          shell.feedback(t('tv.fb.hostOnly'), false);
          return true;
        }
        if (cmd.confirmed) a?.endForAll();
        else askLeave('endForAll');
        return true;
      case 'home':
        askLeave('leave');
        return true;
      case 'confirm':
        if (confirm === 'leave') a?.leave();
        else if (confirm === 'endForAll') a?.endForAll();
        else return false;
        setConfirm(null);
        return true;
      case 'cancel':
        setConfirm(null);
        setMenu(null);
        return true;
      case 'join':
        shell.feedback(t('tv.fb.leaveFirst'), false);
        return true;
      default:
        return false;
    }
  });

  const s = snapshot;
  const micOn = s?.mic ?? false;
  const camOn = s?.cam ?? false;
  const ViewIcon = VIEW_ICON[s?.view ?? 'webcam'];

  return (
    <TvStage layer>
      {/* Top-left: meeting, time, people, recording (REC never hides) */}
      <div className={`${styles.meetInfo} ${barVisible ? '' : styles.meetInfoQuiet}`}>
        {s?.recording && (
          <span className={styles.recChip}>
            <span className={styles.recDot} />
            REC
          </span>
        )}
        <div className={styles.meetInfoText}>
          <span className={styles.meetInfoTitle}>{title}</span>
          <span className={styles.meetInfoMeta}>
            {elapsed(joinedAt, now)} · {t((s?.peopleCount ?? 1) === 1 ? 'tv.peopleOne' : 'tv.peopleCount', { n: s?.peopleCount ?? 1 })}
            {shell.remotes.length > 0 && (
              <span className={styles.meetInfoRemote}>
                <Smartphone size={22} />
                {shell.remotes.length}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* People */}
      {panel === 'people' && s && (
        <aside className={styles.peoplePanel} data-tv-modal aria-label={t('tv.people')}>
          <div className={styles.peopleHeader}>
            <h2 className={styles.h3}>{t((s.peopleCount) === 1 ? 'tv.peopleOne' : 'tv.peopleCount', { n: s.peopleCount })}</h2>
            <button type="button" className={styles.iconBtn} onClick={() => setPanel(null)} aria-label={t('common.close')}>
              <X size={32} />
            </button>
          </div>
          <ul className={styles.peopleList}>
            {s.people.map((p, i) => (
              <li
                key={p.id}
                className={styles.personRow}
                tabIndex={0}
                data-tv-focusable
                {...(i === 0 ? { 'data-tv-autofocus': true } : {})}
              >
                <span className={styles.personAvatar}>{getInitials(p.name)}</span>
                <span className={styles.personName}>
                  {p.name}
                  {(p.me || p.host) && (
                    <span className={styles.personTag}>
                      {[p.me ? t('tv.thisTv') : null, p.host ? t('tv.host') : null].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                {p.hand && <Hand size={30} className={styles.personHand} />}
                {p.mic ? <Mic size={28} className={styles.personMicOn} /> : <MicOff size={28} className={styles.personMicOff} />}
              </li>
            ))}
          </ul>
          {s.peopleCount > s.people.length && (
            <p className={styles.settingsNote}>{t('tv.peopleMore', { n: s.peopleCount - s.people.length })}</p>
          )}
        </aside>
      )}

      {/* View menu */}
      {menu === 'view' && s && (
        <div
          className={styles.viewMenu}
          data-tv-modal
          role="menu"
          style={menuX != null ? { left: Math.max(300, Math.min(1620, menuX)) } : undefined}
        >
          {s.views.map((v, i) => {
            const Icon = VIEW_ICON[v];
            return (
              <button
                key={v}
                type="button"
                role="menuitemradio"
                aria-checked={s.view === v}
                className={`${styles.menuItem} ${s.view === v ? styles.menuItemOn : ''}`}
                onClick={() => {
                  act?.setView(v);
                  setMenu(null);
                }}
                {...(s.view === v || (i === 0 && !s.views.includes(s.view)) ? { 'data-tv-autofocus': true } : {})}
              >
                <Icon size={32} />
                <span>{t(`tv.view.${v}`)}</span>
                {s.view === v && <Check size={30} className={styles.menuCheck} />}
              </button>
            );
          })}
          <p className={styles.menuNote}>{s.isHost || s.canEndForAll ? t('tv.view.forEveryone') : t('tv.view.onlyThisTv')}</p>
        </div>
      )}

      {/* Control bar */}
      <div className={`${styles.controlBar} ${barVisible ? '' : styles.controlBarHidden}`} aria-hidden={!barVisible}>
        <ControlButton
          label={micOn ? t('tv.ctl.mute') : t('tv.ctl.unmute')}
          tone={micOn ? 'live' : 'off'}
          onClick={() => act?.setMic(!micOn)}
          autofocus
        >
          {micOn ? <Mic size={40} /> : <MicOff size={40} />}
        </ControlButton>
        <ControlButton label={camOn ? t('tv.ctl.stopVideo') : t('tv.ctl.startVideo')} tone={camOn ? 'live' : 'off'} onClick={() => act?.setCam(!camOn)}>
          {camOn ? <Video size={40} /> : <VideoOff size={40} />}
        </ControlButton>
        <span className={styles.barDivider} />
        <ControlButton
          label={t(`tv.view.${s?.view ?? 'webcam'}`)}
          onClick={(e) => {
            const stage = e.currentTarget.closest('[data-tv-canvas]');
            if (stage) {
              const sr = stage.getBoundingClientRect();
              const br = e.currentTarget.getBoundingClientRect();
              setMenuX(((br.left + br.width / 2 - sr.left) * 1920) / sr.width);
            }
            setMenu(menu ? null : 'view');
          }}
          pressed={menu === 'view'}
        >
          <ViewIcon size={40} />
        </ControlButton>
        <ControlButton
          label={s?.layout === 'spotlight' ? t('tv.view.speaker') : t('tv.view.grid')}
          onClick={() => act?.setLayout(s?.layout === 'spotlight' ? 'tile' : 'spotlight')}
        >
          {s?.layout === 'spotlight' ? <SquareUserRound size={40} /> : <LayoutGrid size={40} />}
        </ControlButton>
        <ControlButton label={t('tv.ctl.captions')} onClick={() => act?.setCaptions(!s?.captions)} pressed={s?.captions}>
          {s?.captions ? <Captions size={40} /> : <CaptionsOff size={40} />}
        </ControlButton>
        <ControlButton label={s?.hand ? t('tv.ctl.lowerHand') : t('tv.ctl.raiseHand')} onClick={() => act?.setHand(!s?.hand)} pressed={s?.hand}>
          <Hand size={40} />
        </ControlButton>
        <ControlButton label={t('tv.people')} onClick={() => setPanel(panel ? null : 'people')} pressed={panel === 'people'}>
          <Users size={40} />
        </ControlButton>
        <span className={styles.barDivider} />
        <ControlButton label={t('tv.ctl.leave')} tone="danger" onClick={() => askLeave('leave')}>
          <PhoneOff size={40} />
        </ControlButton>
      </div>

      {/* Leave / end */}
      {confirm && (
        <div className={styles.scrim} data-tv-modal>
          <div className={styles.dialog} role="alertdialog" aria-labelledby="tv-leave-title">
            <h2 id="tv-leave-title" className={styles.dialogTitle}>
              {confirm === 'leave' ? t('tv.confirm.leaveTitle') : t('tv.confirm.endTitle')}
            </h2>
            <p className={styles.dialogBody}>
              {confirm === 'leave' ? t('tv.confirm.leaveBody', { title }) : t('tv.confirm.endBody')}
            </p>
            <div className={styles.dialogActions}>
              {confirm === 'leave' ? (
                <button type="button" className={styles.btnDanger} data-tv-autofocus onClick={() => act?.leave()}>
                  {t('tv.leave')}
                </button>
              ) : null}
              {(confirm === 'endForAll' || s?.canEndForAll) && (
                <button
                  type="button"
                  className={confirm === 'endForAll' ? styles.btnDanger : styles.btnSecondary}
                  {...(confirm === 'endForAll' ? { 'data-tv-autofocus': true } : {})}
                  onClick={() => act?.endForAll()}
                >
                  {t('tv.endForAll')}
                </button>
              )}
              <button type="button" className={styles.btnSecondary} onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </TvStage>
  );
}

function ControlButton({
  label,
  tone,
  pressed,
  autofocus,
  onClick,
  children,
}: {
  label: string;
  tone?: 'live' | 'off' | 'danger';
  pressed?: boolean;
  autofocus?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'live' ? styles.ctlLive : tone === 'off' ? styles.ctlOff : tone === 'danger' ? styles.ctlDanger : pressed ? styles.ctlPressed : '';
  return (
    <button
      type="button"
      className={`${styles.ctl} ${toneClass}`}
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      {...(autofocus ? { 'data-tv-autofocus': true } : {})}
    >
      <span className={styles.ctlIcon}>{children}</span>
      <span className={styles.ctlLabel}>{label}</span>
    </button>
  );
}
