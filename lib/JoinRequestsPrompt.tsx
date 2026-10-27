'use client';

/**
 * Host and co-hosts: people knocking on a Protected meeting (screen s5 of the access design).
 * A card at the top right — name, email, "Not in <company>", Admit / Deny — with a short chime
 * when someone new asks. It stays until answered; with several waiting, "View all" opens the
 * list with Admit all. Refresh is driven by the meeting heartbeat; a knock also nudges the room.
 */
import React from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import { Check, X } from 'lucide-react';
import styles from '@/styles/MeetingAccess.module.css';
import { useI18n } from './i18n';
import { getInitials } from './getInitials';
import { JOIN_REQUESTS_TOPIC } from './meetingAccess';
import { answerKnocks, fetchWaitingList, type WaitingPerson } from './meetingAccessClient';

export interface JoinRequestsPromptProps {
  room: Room;
  canAdmit: boolean;
  /** Only Protected meetings take knocks; Public / Private never fetch. */
  acceptsKnocks: boolean;
  /** Meeting heartbeat (5s) calls this to refresh the waiting list. */
  refreshRef?: React.MutableRefObject<(() => void) | null>;
}

/** Two soft notes, no audio file needed. Browsers may block it before the first click. */
function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
    window.setTimeout(() => void ctx.close().catch(() => undefined), 900);
  } catch {
    /* ignore */
  }
}

function Avatar({ person, size = 40 }: { person: WaitingPerson; size?: number }) {
  return (
    <span className={styles.hostAvatar} aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : getInitials(person.displayName)}
    </span>
  );
}

export function JoinRequestsPrompt({
  room,
  canAdmit,
  acceptsKnocks,
  refreshRef,
}: JoinRequestsPromptProps) {
  const { t } = useI18n();
  const [waiting, setWaiting] = React.useState<WaitingPerson[]>([]);
  const [companyName, setCompanyName] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const seenRef = React.useRef<Set<number>>(new Set());
  const roomName = room.name;

  const refresh = React.useCallback(async () => {
    if (!roomName || !acceptsKnocks) return;
    const data = await fetchWaitingList(roomName);
    if (!data) return;
    setCompanyName(data.companyName);
    setWaiting(data.requests);
    const fresh = data.requests.some((r) => !seenRef.current.has(r.id));
    data.requests.forEach((r) => seenRef.current.add(r.id));
    if (fresh) playChime();
  }, [roomName, acceptsKnocks]);

  React.useEffect(() => {
    if (!canAdmit || !acceptsKnocks) {
      setWaiting([]);
      if (refreshRef) refreshRef.current = null;
      return;
    }
    void refresh();
    if (refreshRef) refreshRef.current = () => { void refresh(); };
    const onData = (_payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic === JOIN_REQUESTS_TOPIC) void refresh();
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      if (refreshRef) refreshRef.current = null;
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [canAdmit, acceptsKnocks, room, refresh, refreshRef]);

  React.useEffect(() => {
    if (waiting.length <= 1) setShowAll(false);
  }, [waiting.length]);

  const answer = async (action: 'admit' | 'deny', target: { ids: number[] } | { all: true }) => {
    setBusy(true);
    const ids = 'ids' in target ? new Set(target.ids) : null;
    // Take them off the list right away; the next refresh corrects it if the call failed.
    setWaiting((list) => (ids ? list.filter((p) => !ids.has(p.id)) : []));
    await answerKnocks(roomName, action, target);
    setBusy(false);
    void refresh();
  };

  if (!canAdmit || waiting.length === 0) return null;
  const first = waiting[0];
  const outsideTag = companyName ? t('access.notInCompanyTag', { company: companyName }) : null;

  return (
    <div className={styles.prompt} role="dialog" aria-live="polite" aria-label={t('access.waitingToJoin', { n: waiting.length })}>
      {showAll ? (
        <>
          <div className={styles.listHead}>
            <span>{t('access.waitingToJoin', { n: waiting.length })}</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button type="button" className={styles.smallPrimary} disabled={busy} onClick={() => void answer('admit', { all: true })}>
                {t('access.admitAll')}
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                aria-label={t('access.hideList')}
                onClick={() => setShowAll(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </span>
          </div>
          <ul className={styles.list}>
            {waiting.map((person) => (
              <li key={person.id} className={styles.listItem}>
                <Avatar person={person} size={32} />
                <span className={styles.listText}>
                  <div className={styles.listName}>{person.displayName}</div>
                  {person.email && <div className={styles.listEmail}>{person.email}</div>}
                </span>
                <button
                  type="button"
                  className={styles.iconBtn}
                  disabled={busy}
                  aria-label={t('access.denyPerson', { name: person.displayName })}
                  onClick={() => void answer('deny', { ids: [person.id] })}
                >
                  <X size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.iconBtnAdmit}`}
                  disabled={busy}
                  aria-label={t('access.admitPerson', { name: person.displayName })}
                  onClick={() => void answer('admit', { ids: [person.id] })}
                >
                  <Check size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className={styles.promptBody}>
            <Avatar person={first} />
            <div style={{ minWidth: 0 }}>
              <p className={styles.promptTitle}>{t('access.wantsToJoin', { name: first.displayName })}</p>
              {first.email && <p className={styles.promptEmail}>{first.email}</p>}
              {outsideTag && <span className={styles.outsideTag}>{outsideTag}</span>}
            </div>
          </div>
          <div className={styles.promptActions}>
            <button type="button" className={styles.smallBtn} disabled={busy} onClick={() => void answer('deny', { ids: [first.id] })}>
              {t('access.deny')}
            </button>
            <button type="button" className={styles.smallPrimary} disabled={busy} onClick={() => void answer('admit', { ids: [first.id] })}>
              {t('access.admit')}
            </button>
          </div>
          {waiting.length > 1 && (
            <div className={styles.promptMore}>
              <span>{t('access.moreWaiting', { n: waiting.length - 1 })}</span>
              <button type="button" className={styles.linkBtn} onClick={() => setShowAll(true)}>
                {t('access.viewAll')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
