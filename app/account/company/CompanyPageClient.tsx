'use client';

/**
 * Company settings, for a company's owners and admins. First section, Camera backgrounds: images
 * everyone in the company can use (shown first in their background picker), the background members
 * start with, and whether they may also use the built-in scenes and their own images. Every change
 * saves at once; the server checks who may make it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { authFetch, getKloudSessionBearer } from '@/lib/kloudSession';
import { AddBackgroundError, prepareBackgroundImage, type AddBackgroundProblem } from '@/lib/customBackgrounds';
import { refreshCompanyBackgrounds } from '@/lib/companyBackgrounds';
import css from '@/styles/Billing.module.css';
import cs from '@/styles/CompanySettings.module.css';

interface Background {
  id: number;
  name: string;
  imageUrl: string;
  thumbUrl: string;
}

interface Company {
  id: number;
  name: string;
  companyOnly: boolean;
  defaultBackgroundId: number | null;
  backgrounds: Background[];
  max: number;
}

interface Payload {
  companies: { id: number; name: string }[];
  company: Company | null;
}

type State =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'forbidden' }
  | { status: 'error' }
  | { status: 'ready'; data: Payload };

type Notice = { kind: 'ok' | 'error'; text: string } | null;

const API = '/api/account/company/backgrounds';

const UPLOAD_PROBLEM_KEY: Record<AddBackgroundProblem | 'server', string> = {
  full: 'company.bg.full',
  size: 'background.addTooBig',
  type: 'background.addFailed',
  unreadable: 'background.addFailed',
  storage: 'background.addFailed',
  server: 'company.bg.uploadFailed',
};

/* Follow the theme chosen on the home page (pre-meeting pages share html[data-theme]). */
function useStoredTheme() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.hasAttribute('data-theme')) return;
    try {
      const stored = window.localStorage.getItem('kloud-theme');
      if (stored === 'dark' || stored === 'light') root.setAttribute('data-theme', stored);
    } catch {
      /* ignore */
    }
  }, []);
}

function fileTitle(file: File): string {
  return file.name.replace(/\.[a-z0-9]{2,5}$/i, '').trim().slice(0, 80);
}

/** A name that saves when you leave it or press Enter; Esc puts the old one back. */
function NameField({ value, label, onSave }: { value: string; label: string; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const name = draft.trim();
    if (!name) setDraft(value);
    else if (name !== value) onSave(name);
  };
  return (
    <input
      className={cs.name}
      value={draft}
      maxLength={80}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

export function CompanyPageClient() {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [accountId, setAccountId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirm, setConfirm] = useState<Background | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useStoredTheme();

  const load = useCallback(async (id: number | null) => {
    if (!getKloudSessionBearer()) {
      setState({ status: 'signed-out' });
      return;
    }
    try {
      const res = await authFetch(id ? `${API}?accountId=${id}` : API);
      if (res.status === 401) return setState({ status: 'signed-out' });
      if (res.status === 403) return setState({ status: 'forbidden' });
      if (!res.ok) return setState({ status: 'error' });
      const data = (await res.json()) as Payload;
      setState({ status: 'ready', data });
      if (data.company) setAccountId(data.company.id);
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  /** Sends a change; the reply is the whole section again, so the page always shows the truth. */
  const send = useCallback(
    async (path: string, init: RequestInit, saved = t('company.saved')): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await authFetch(path, init);
        const body = (await res.json().catch(() => ({}))) as Partial<Payload> & { error?: string };
        if (!res.ok || !body.company) {
          setNotice({
            kind: 'error',
            text: body.error === 'full' ? t('company.bg.full') : t('company.saveFailed'),
          });
          return false;
        }
        setState({ status: 'ready', data: { companies: body.companies ?? [], company: body.company } });
        setNotice({ kind: 'ok', text: saved });
        // Your own picker on this device shows the change straight away.
        void refreshCompanyBackgrounds();
        return true;
      } catch {
        setNotice({ kind: 'error', text: t('company.saveFailed') });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (notice?.kind !== 'ok') return;
    const id = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(id);
  }, [notice]);

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !accountId) return;
    setUploading(true);
    setNotice(null);
    try {
      const { image, thumb } = await prepareBackgroundImage(file);
      const form = new FormData();
      form.set('accountId', String(accountId));
      form.set('name', fileTitle(file) || t('company.bg.untitled'));
      form.set('image', image, 'image.jpg');
      form.set('thumb', thumb, 'thumb.jpg');
      await send(API, { method: 'POST', body: form }, t('company.bg.added'));
    } catch (error) {
      const problem = error instanceof AddBackgroundError ? error.problem : 'server';
      setNotice({ kind: 'error', text: t(UPLOAD_PROBLEM_KEY[problem]) });
    } finally {
      setUploading(false);
    }
  };

  const shell = (content: React.ReactNode) => (
    <div className={css.page}>
      <header className={css.header}>
        <Link href="/" className={css.iconBtn} aria-label={t('billing.back')} title={t('billing.back')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className={css.headerTitle}>{t('company.pageTitle')}</h1>
        <span className={css.spacer} />
      </header>
      <div className={css.layout}>
        <nav className={css.sideNav} aria-label={t('company.pageTitle')}>
          <span className={`${css.navItem} ${css.navItemActive}`} aria-current="page">
            {t('company.nav.backgrounds')}
          </span>
        </nav>
        <main className={css.main}>{content}</main>
      </div>
    </div>
  );

  if (state.status === 'loading') {
    return shell(<div className={css.center}><span className={css.muted}>{t('company.loading')}</span></div>);
  }
  if (state.status === 'signed-out') {
    return shell(
      <div className={css.center}>
        <span className={css.muted}>{t('company.signedOut')}</span>
        <Link href="/" className={`${css.btn} ${css.btnFill}`}>{t('billing.signIn')}</Link>
      </div>,
    );
  }
  if (state.status === 'forbidden') {
    return shell(<div className={css.center}><span className={css.muted}>{t('company.forbidden')}</span></div>);
  }
  if (state.status === 'error' || !state.data.company) {
    return shell(
      <div className={css.center}>
        <span className={css.muted}>{t('company.loadError')}</span>
        <button type="button" className={`${css.btn} ${css.btnOutline}`} onClick={() => void load(accountId)}>
          {t('billing.retry')}
        </button>
      </div>,
    );
  }

  const { companies, company } = state.data;
  const full = company.backgrounds.length >= company.max;
  const none = company.backgrounds.length === 0;

  return shell(
    <>
      {notice && (
        <div className={`${css.notice} ${notice.kind === 'ok' ? css.noticeOk : css.noticeError}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
        </div>
      )}

      <section className={css.card} aria-labelledby="company-backgrounds-title">
        <div className={css.row}>
          <div className={cs.titleBlock}>
            <h2 id="company-backgrounds-title" className={css.h2}>{t('company.bg.title')}</h2>
            <span className={css.muted}>{t('company.bg.intro', { company: company.name })}</span>
          </div>
          {companies.length > 1 && (
            <label className={cs.companyPick}>
              <span className={css.small}>{t('company.company')}</span>
              <select
                className={cs.select}
                value={company.id}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setAccountId(id);
                  setState({ status: 'loading' });
                  void load(id);
                }}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <ul className={cs.grid}>
          <li>
            <button
              type="button"
              className={cs.addTile}
              disabled={busy || uploading || full}
              title={full ? t('company.bg.full') : undefined}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <span className={cs.spinner} aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
                  <path d="M12 9v6M9 12h6" />
                </svg>
              )}
              <span>{uploading ? t('company.bg.adding') : t('background.add')}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void onFile(e)} />
          </li>
          {company.backgrounds.map((b) => {
            const isDefault = b.id === company.defaultBackgroundId;
            return (
              <li key={b.id} className={cs.tile}>
                <div className={cs.thumbBox}>
                  <img className={cs.thumb} src={b.thumbUrl} alt="" draggable={false} />
                  {isDefault && <span className={cs.defaultBadge}>{t('company.bg.default')}</span>}
                  <div className={cs.tileActions}>
                    <button
                      type="button"
                      className={cs.tileAction}
                      aria-pressed={isDefault}
                      aria-label={`${t(isDefault ? 'company.bg.unsetDefault' : 'company.bg.setDefault')}: ${b.name}`}
                      title={t(isDefault ? 'company.bg.unsetDefault' : 'company.bg.setDefault')}
                      disabled={busy}
                      onClick={() =>
                        void send(API, json('PUT', { accountId: company.id, defaultBackgroundId: isDefault ? null : b.id }))
                      }
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill={isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={cs.tileAction}
                      aria-label={`${t('company.bg.remove')}: ${b.name}`}
                      title={t('company.bg.remove')}
                      disabled={busy}
                      onClick={() => setConfirm(b)}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <NameField
                  value={b.name}
                  label={t('company.bg.nameLabel')}
                  onSave={(name) => void send(`${API}/${b.id}`, json('PATCH', { name }))}
                />
              </li>
            );
          })}
        </ul>
        <span className={css.small}>{t('company.bg.limits', { n: company.backgrounds.length, max: company.max })}</span>
      </section>

      <section className={css.card} aria-labelledby="company-members-title">
        <h2 id="company-members-title" className={css.h2}>{t('company.bg.membersTitle')}</h2>
        <div className={cs.settingRow}>
          <div className={cs.settingText}>
            <label htmlFor="company-default-background" className={cs.settingLabel}>{t('company.bg.defaultLabel')}</label>
            <span className={css.small}>{t(none ? 'company.bg.needImages' : 'company.bg.defaultHint')}</span>
          </div>
          <select
            id="company-default-background"
            className={cs.select}
            value={company.defaultBackgroundId ?? ''}
            disabled={busy || none}
            onChange={(e) =>
              void send(API, json('PUT', { accountId: company.id, defaultBackgroundId: e.target.value ? Number(e.target.value) : null }))
            }
          >
            <option value="">{t('company.bg.defaultNone')}</option>
            {company.backgrounds.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className={css.divider} />
        <div className={cs.settingRow}>
          <div className={cs.settingText}>
            <span id="company-allow-own" className={cs.settingLabel}>{t('company.bg.allowOwnTitle')}</span>
            <span className={css.small}>
              {t(none ? 'company.bg.needImages' : company.companyOnly ? 'company.bg.allowOwnOff' : 'company.bg.allowOwnOn')}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!company.companyOnly}
            aria-labelledby="company-allow-own"
            className={cs.switch}
            disabled={busy || none}
            onClick={() => void send(API, json('PUT', { accountId: company.id, companyOnly: !company.companyOnly }))}
          >
            <span className={cs.knob} />
          </button>
        </div>
      </section>

      {confirm && (
        <div className={css.scrim} onClick={() => !busy && setConfirm(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="company-remove-title"
            className={css.dialog}
            style={{ maxWidth: 460 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && !busy && setConfirm(null)}
          >
            <h2 id="company-remove-title" className={css.dialogTitle}>{t('company.bg.removeTitle')}</h2>
            <div className={cs.confirmThumb}>
              <img src={confirm.thumbUrl} alt="" />
              <span>{confirm.name}</span>
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
              {t(confirm.id === company.defaultBackgroundId ? 'company.bg.removeTextDefault' : 'company.bg.removeText')}
            </p>
            <div className={css.dialogFoot}>
              <button type="button" className={`${css.btn} ${css.btnText}`} disabled={busy} onClick={() => setConfirm(null)} autoFocus>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={`${css.btn} ${css.btnDanger}`}
                disabled={busy}
                onClick={async () => {
                  if (await send(`${API}/${confirm.id}`, { method: 'DELETE' }, t('company.bg.removed'))) setConfirm(null);
                }}
              >
                {t('company.bg.remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
  );
}
