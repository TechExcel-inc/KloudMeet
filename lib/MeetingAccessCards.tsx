'use client';

/**
 * Pre-join screens for meeting access levels (lib/meetingAccess.ts): the meeting card, "Sign in
 * to join", "Asking to join…", "The meeting hasn't started yet", the two refusal pages, and the
 * host's Private invite box.
 * They show the meeting's title and host only — never who is in it.
 */
import React from 'react';
import Link from 'next/link';
import { AlertTriangle, Ban, Globe, Info, Lock, LogIn, ShieldCheck, UserPlus, X } from 'lucide-react';
import styles from '@/styles/MeetingAccess.module.css';
import { useI18n } from './i18n';
import { getInitials } from './getInitials';
import { fetchCompanyPeople, signInHref, type AccessLevelValue, type MeetingAccessState } from './meetingAccessClient';

type T = ReturnType<typeof useI18n>['t'];

function levelLabel(t: T, level: AccessLevelValue | null): { label: string; Icon: typeof Globe } | null {
  switch (level) {
    case 'PUBLIC':
      return { label: t('prejoin.accessLevelPublic'), Icon: Globe };
    case 'PROTECTED':
      return { label: t('prejoin.accessLevelProtected'), Icon: ShieldCheck };
    case 'PRIVATE':
      return { label: t('prejoin.accessLevelPrivate'), Icon: Lock };
    default:
      return null;
  }
}

export function MeetingAccessCard({
  access,
  meta,
}: {
  access: Pick<MeetingAccessState, 'level' | 'meeting'>;
  /** Replaces "Hosted by …" (e.g. with a head count while waiting). */
  meta?: string;
}) {
  const { t } = useI18n();
  const level = levelLabel(t, access.level);
  const { meeting } = access;
  return (
    <div className={styles.meetingCard}>
      <span className={styles.hostAvatar} aria-hidden="true">
        {meeting.hostAvatarUrl ? <img src={meeting.hostAvatarUrl} alt="" /> : getInitials(meeting.hostName)}
      </span>
      <span className={styles.meetingText}>
        <span className={styles.meetingTitle}>{meeting.title || t('access.untitledMeeting')}</span>
        <span className={styles.meetingMeta}>{meta ?? t('access.hostedBy', { name: meeting.hostName })}</span>
      </span>
      {level && (
        <span className={styles.levelBadge}>
          <level.Icon size={13} aria-hidden="true" />
          {level.label}
        </span>
      )}
    </div>
  );
}

/** Protected / Private link opened while signed out (screen s3). */
export function AccessSignInCard({ access, roomName }: { access: MeetingAccessState; roomName: string }) {
  const { t } = useI18n();
  const company = access.meeting.companyName;
  const text =
    access.level === 'PRIVATE'
      ? t('access.signInPrivateText')
      : company
        ? t('access.signInProtectedText', { company })
        : t('access.signInProtectedTextNoCompany');
  return (
    <div className={styles.panelCard}>
      <span className={styles.cardIcon} aria-hidden="true">
        <LogIn size={26} />
      </span>
      <h1 className={styles.cardTitle}>{t('access.signInTitle')}</h1>
      <p className={styles.cardText}>{text}</p>
      <MeetingAccessCard access={access} />
      <div className={styles.cardActions}>
        <a className={styles.primary} href={signInHref(roomName)}>
          {t('access.signIn')}
        </a>
        <a className={styles.secondary} href={signInHref(roomName, { signup: true })}>
          {t('access.createAccount')}
        </a>
      </div>
      {access.level === 'PROTECTED' && <p className={styles.fineprint}>{t('access.invitedByEmailHint')}</p>}
    </div>
  );
}

/** After "Ask to join": waiting for the host (screen s4). Leaving the page cancels the request. */
export function AccessWaitingCard({
  access,
  displayName,
  email,
  hostPresent,
  participantCount,
  onCancel,
}: {
  access: MeetingAccessState;
  displayName: string;
  email: string | null;
  hostPresent: boolean | null;
  participantCount: number | null;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const meta =
    participantCount && participantCount > 0
      ? t('access.hostedByWithCount', { name: access.meeting.hostName, n: participantCount })
      : undefined;
  return (
    <div className={styles.panelCard} role="status" aria-live="polite">
      <span className={styles.waitAvatar} aria-hidden="true">
        <span>{getInitials(displayName)}</span>
      </span>
      <h1 className={styles.cardTitle}>
        {t('access.askingTitle')}
        <span className={styles.dots} aria-hidden="true" />
      </h1>
      <p className={styles.cardText}>
        {hostPresent === false ? t('access.askingHostAway') : t('access.askingText')}
      </p>
      <MeetingAccessCard access={access} meta={meta} />
      <div className={styles.infoRow}>
        <Info size={15} aria-hidden="true" />
        <span>
          {t('access.joiningAs')} <strong>{displayName}</strong>
          {email ? ` · ${email}` : ''}
        </span>
      </div>
      <div className={styles.cardActions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** The host hasn't started the meeting yet: wait here, joining automatically once they have. */
export function HostNotStartedCard({
  access,
  displayName,
  email,
  onCancel,
}: {
  access: MeetingAccessState;
  displayName: string;
  email: string | null;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.panelCard} role="status" aria-live="polite">
      <span className={styles.waitAvatar} aria-hidden="true">
        <span>{getInitials(displayName)}</span>
      </span>
      <h1 className={styles.cardTitle}>
        {t('access.notStartedTitle')}
        <span className={styles.dots} aria-hidden="true" />
      </h1>
      <p className={styles.cardText}>{t('access.notStartedText', { name: access.meeting.hostName })}</p>
      <MeetingAccessCard access={access} />
      <div className={styles.infoRow}>
        <Info size={15} aria-hidden="true" />
        <span>
          {t('access.joiningAs')} <strong>{displayName}</strong>
          {email ? ` · ${email}` : ''}
        </span>
      </div>
      <div className={styles.cardActions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Can't get in (screen s6): a Private meeting you aren't invited to, or the host said no. */
export function AccessRefusedPage({
  access,
  reason,
  retryInMs,
  asking,
  onAskAgain,
  onSwitchAccount,
}: {
  access: MeetingAccessState;
  reason: 'NOT_INVITED' | 'DENIED';
  /** DENIED: ms until "Ask again" is allowed (one request a minute). */
  retryInMs: number;
  asking: boolean;
  onAskAgain: () => void;
  onSwitchAccount: () => void;
}) {
  const { t } = useI18n();
  const company = access.meeting.companyName;
  const waitSeconds = Math.ceil(retryInMs / 1000);
  return (
    <section className={styles.refusal}>
      {reason === 'NOT_INVITED' ? (
        <>
          <span className={`${styles.cardIcon} ${styles.cardIconWarn}`} aria-hidden="true">
            <Lock size={26} />
          </span>
          <h1 className={styles.cardTitle}>{t('access.privateTitle')}</h1>
          <p className={styles.cardText}>
            {company ? t('access.privateText', { company }) : t('access.privateTextNoCompany')}
          </p>
          <MeetingAccessCard access={access} />
          {access.signedInAs && (
            <div className={styles.infoRow}>
              <Info size={15} aria-hidden="true" />
              <span>
                {t('access.signedInAs')} <strong>{access.signedInAs.email || access.signedInAs.name}</strong>
                {' · '}
                <button type="button" className={styles.linkBtn} onClick={onSwitchAccount}>
                  {t('access.switchAccount')}
                </button>
              </span>
            </div>
          )}
        </>
      ) : (
        <>
          <span className={`${styles.cardIcon} ${styles.cardIconDanger}`} aria-hidden="true">
            <Ban size={26} />
          </span>
          <h1 className={styles.cardTitle}>{t('access.deniedTitle')}</h1>
          <p className={styles.cardText}>{t('access.deniedText')}</p>
          <MeetingAccessCard access={access} />
        </>
      )}
      <div className={styles.cardActions}>
        {reason === 'DENIED' && (
          <button
            type="button"
            className={styles.primary}
            onClick={onAskAgain}
            disabled={asking || retryInMs > 0}
          >
            {retryInMs > 0 ? t('access.askAgainIn', { n: waitSeconds }) : t('access.askAgain')}
          </button>
        )}
        <Link className={styles.secondary} href="/">
          {t('access.backHome')}
        </Link>
      </div>
    </section>
  );
}

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

export interface InviteChip {
  email: string;
  name?: string;
}

/**
 * Host picks people to invite when Private is selected (screen s2). Suggestions come from
 * the host's company; an address outside it is kept but flagged — it can't join a private meeting.
 */
export function PrivateInviteBox({
  value,
  onChange,
  companyName,
}: {
  value: InviteChip[];
  onChange: (next: InviteChip[]) => void;
  companyName: string | null;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<Array<{ name: string; email: string; avatarUrl: string | null }>>([]);
  const [active, setActive] = React.useState(0);
  /** Company addresses among the chosen ones, for the list they were checked against. */
  const [checked, setChecked] = React.useState<{ key: string; emails: Set<string> }>({ key: '', emails: new Set() });
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  // Which chosen addresses are in the company (checked again whenever the list changes).
  const emailsKey = value.map((c) => c.email).join(',');
  React.useEffect(() => {
    if (!emailsKey) return;
    let cancelled = false;
    void fetchCompanyPeople({ check: emailsKey.split(',') }).then((data) => {
      if (!cancelled && data) setChecked({ key: emailsKey, emails: new Set(data.companyEmails) });
    });
    return () => {
      cancelled = true;
    };
  }, [emailsKey]);

  React.useEffect(() => {
    const q = draft.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      void fetchCompanyPeople({ q }).then((data) => {
        if (cancelled || !data) return;
        const chosen = new Set(value.map((c) => c.email));
        setSuggestions(data.people.filter((p) => !chosen.has(p.email.toLowerCase())));
        setActive(0);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [draft, value]);

  const add = (chip: InviteChip) => {
    const email = chip.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || value.some((c) => c.email === email)) {
      setDraft('');
      return;
    }
    onChange([...value, { ...chip, email }]);
    setDraft('');
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive((i) => (e.key === 'ArrowDown' ? Math.min(suggestions.length - 1, i + 1) : Math.max(0, i - 1)));
      return;
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && draft.trim())) {
      if (!draft.trim()) return;
      e.preventDefault();
      const pick = suggestions[active];
      if (pick) add({ email: pick.email, name: pick.name });
      else add({ email: draft });
      return;
    }
    if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
    if (e.key === 'Escape') setSuggestions([]);
  };

  // Flag only once the current list has been checked (no flash while the check runs).
  const isOutside = (email: string) => checked.key === emailsKey && !checked.emails.has(email);
  const outsiders = value.filter((c) => isOutside(c.email));
  const company = companyName ?? '';

  return (
    <div className={styles.inviteGroup}>
      <label className={styles.inviteLabel} htmlFor={`${listId}-input`}>
        {t('access.inviteLabel')}
      </label>
      <div className={styles.inviteBox} onClick={() => inputRef.current?.focus()}>
        {value.map((chip) => {
          const outside = isOutside(chip.email);
          return (
            <span key={chip.email} className={`${styles.chip}${outside ? ` ${styles.chipWarn}` : ''}`}>
              {outside ? (
                <AlertTriangle size={14} aria-hidden="true" style={{ marginLeft: 4 }} />
              ) : (
                <span className={styles.chipAvatar} aria-hidden="true">
                  {getInitials(chip.name || chip.email)}
                </span>
              )}
              <span className={styles.chipText} title={chip.email}>
                {chip.name || chip.email}
              </span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={t('access.removeInvitee', { name: chip.name || chip.email })}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((c) => c.email !== chip.email));
                }}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          );
        })}
        <UserPlus size={16} aria-hidden="true" style={{ color: 'var(--km-text-muted)' }} />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          className={styles.inviteInput}
          value={draft}
          placeholder={value.length ? '' : t('access.invitePlaceholder')}
          autoComplete="off"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={suggestions.length ? listId : undefined}
          aria-autocomplete="list"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(() => setSuggestions([]), 150)}
        />
      </div>
      {suggestions.length > 0 && (
        <ul id={listId} role="listbox" className={styles.suggest}>
          {suggestions.map((p, i) => (
            <li
              key={p.email}
              role="option"
              aria-selected={i === active}
              className={`${styles.suggestItem}${i === active ? ` ${styles.suggestItemActive}` : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                add({ email: p.email, name: p.name });
              }}
            >
              <span className={styles.hostAvatar} aria-hidden="true" style={{ width: 30, height: 30, fontSize: 11 }}>
                {p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : getInitials(p.name)}
              </span>
              <span>
                <div className={styles.suggestName}>{p.name}</div>
                <div className={styles.suggestEmail}>{p.email}</div>
              </span>
            </li>
          ))}
        </ul>
      )}
      {outsiders.length > 0 && (
        <p className={styles.inviteWarn} role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          {outsiders.length === 1
            ? t('access.notInCompanyOne', { email: outsiders[0].email, company })
            : t('access.notInCompanyMany', { n: outsiders.length, company })}
        </p>
      )}
      <p className={styles.fineprint}>{t('access.inviteEmailNote')}</p>
    </div>
  );
}
