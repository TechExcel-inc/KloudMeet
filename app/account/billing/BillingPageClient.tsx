'use client';

/**
 * Plan & billing (prototype ⑩): current plan, usage meters, plan cards with a
 * monthly / yearly toggle, upgrade dialog (Team seats) → Stripe Checkout, hour
 * packs, and the Stripe portal for card, invoices, plan changes and cancelling.
 * Every decision is made server-side; this page only displays and redirects.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { authFetch } from '@/lib/kloudSession';
import { useBillingSummary } from '@/lib/billing/useBillingSummary';
import type { BillingSummary, CatalogPlan } from '@/lib/billing/summary';
import { isSeatPlan, type BillingInterval, type PlanId, type SelfServePlanId } from '@/lib/billing/plans';
import css from '@/styles/Billing.module.css';

type Notice = { kind: 'ok' | 'info' | 'error'; text: string } | null;
type Dialog = { kind: 'upgrade'; plan: SelfServePlanId } | { kind: 'cancel' } | null;

const RANK: Record<PlanId, number> = { FREE: 0, PRO: 1, TEAM: 2, BUSINESS: 3, ENTERPRISE: 4, LEGACY: 4 };

function intlLocale(locale: string): string {
  return locale === 'zh' ? 'zh-CN' : locale;
}

function useFormatters(locale: string) {
  return useMemo(() => {
    const tag = intlLocale(locale);
    const money = (cents: number) =>
      new Intl.NumberFormat(tag, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(cents / 100);
    const moneyExact = (cents: number) =>
      new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD' }).format(cents / 100);
    const date = (iso: string | null | undefined) =>
      iso ? new Intl.DateTimeFormat(tag, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso)) : '';
    const hours = (seconds: number) =>
      new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(seconds / 3600);
    return { money, moneyExact, date, hours };
  }, [locale]);
}

async function postForUrl(path: string, body?: unknown): Promise<{ url?: string; error?: string }> {
  try {
    const res = await authFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  } catch {
    return { error: 'network' };
  }
}

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

export function BillingPageClient() {
  const { t, locale } = useI18n();
  const f = useFormatters(locale);
  const { state, reload } = useBillingSummary();
  const [yearly, setYearly] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [seats, setSeats] = useState(3);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useStoredTheme();

  // Return from Stripe: show the outcome, then refresh while the webhook lands.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const credits = params.get('credits');
    if (!checkout && !credits) return;
    if (checkout === 'success') setNotice({ kind: 'ok', text: t('billing.success.checkout') });
    else if (credits === 'success') setNotice({ kind: 'ok', text: t('billing.success.credits') });
    else setNotice({ kind: 'info', text: t('billing.canceled') });
    window.history.replaceState(null, '', window.location.pathname);
    if (checkout === 'success' || credits === 'success') {
      const timers = [3000, 8000, 15000].map((ms) => window.setTimeout(reload, ms));
      return () => timers.forEach((id) => window.clearTimeout(id));
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = useCallback(
    async (path: string, body?: unknown, opening?: string) => {
      setBusy(true);
      if (opening) setNotice({ kind: 'info', text: opening });
      const res = await postForUrl(path, body);
      if (res.url) {
        window.location.assign(res.url);
        return;
      }
      setBusy(false);
      setDialog(null);
      setNotice({ kind: 'error', text: res.error && res.error !== 'network' ? res.error : t('billing.error.generic') });
    },
    [t],
  );

  const openPortal = useCallback(() => {
    void goTo('/api/billing/portal', undefined, t('billing.opening'));
  }, [goTo, t]);

  const shell = (content: React.ReactNode) => (
    <div className={css.page}>
      <header className={css.header}>
        <Link href="/" className={css.iconBtn} aria-label={t('billing.back')} title={t('billing.back')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className={css.headerTitle}>{t('billing.pageTitle')}</h1>
        <span className={css.spacer} />
      </header>
      <div className={css.layout}>
        <nav className={css.sideNav} aria-label={t('billing.pageTitle')}>
          <span className={`${css.navItem} ${css.navItemActive}`} aria-current="page">
            {t('nav.planBilling')}
          </span>
        </nav>
        <main className={css.main}>{content}</main>
      </div>
    </div>
  );

  if (state.status === 'loading') {
    return shell(<div className={css.center}><span className={css.muted}>{t('billing.loading')}</span></div>);
  }
  if (state.status === 'signed-out') {
    return shell(
      <div className={css.center}>
        <span className={css.muted}>{t('billing.signedOut')}</span>
        <Link href="/" className={`${css.btn} ${css.btnFill}`}>{t('billing.signIn')}</Link>
      </div>,
    );
  }
  if (state.status === 'error') {
    return shell(
      <div className={css.center}>
        <span className={css.muted}>{t('billing.loadError')}</span>
        <button type="button" className={`${css.btn} ${css.btnOutline}`} onClick={reload}>{t('billing.retry')}</button>
      </div>,
    );
  }
  if (!state.summary.enabled) {
    return shell(<div className={css.center}><span className={css.muted}>{t('billing.disabled')}</span></div>);
  }

  const s: BillingSummary = state.summary;
  const interval: BillingInterval = yearly ? 'year' : 'month';
  const manual = s.source === 'MANUAL' || s.plan === 'ENTERPRISE' || s.plan === 'LEGACY';
  const paidStripe = !manual && s.plan !== 'FREE';
  const canManage = s.canManage && !manual;
  const planById = (id: PlanId) => s.catalog.find((p) => p.id === id);

  /* ── current plan card ── */
  const badge = (() => {
    if (manual) return { text: t('billing.badge.managed'), cls: css.badgeTonal };
    if (s.pendingPlan) return { text: t('billing.badge.processing'), cls: css.badgeWarn };
    if (s.plan === 'FREE') return { text: t('billing.badge.free'), cls: css.badgeNeutral };
    if (s.status === 'past_due') return { text: t('billing.badge.pastDue'), cls: css.badgeWarn };
    if (s.cancelAtPeriodEnd) return { text: t('billing.badge.canceling', { date: f.date(s.currentPeriodEnd) }), cls: css.badgeWarn };
    return { text: t('billing.badge.active'), cls: css.badgeOk };
  })();

  const planLine = (() => {
    if (manual) return t('billing.planLine.managed');
    if (s.pendingPlan) return t('billing.planLine.processing', { plan: planById(s.pendingPlan)?.name ?? s.pendingPlan });
    if (s.plan === 'FREE') return t('billing.planLine.free');
    const rate = planById(s.plan)?.prices[s.interval ?? 'month']?.monthlyRateCents ?? 0;
    const period = t(s.interval === 'year' ? 'billing.period.yearly' : 'billing.period.monthly');
    const head =
      isSeatPlan(s.plan)
        ? t('billing.planLine.team', { seats: s.seats, price: f.money(rate), period })
        : t('billing.planLine.pro', { price: f.money(rate), period });
    const tail = s.currentPeriodEnd
      ? t(s.cancelAtPeriodEnd ? 'billing.planLine.ends' : 'billing.planLine.renews', { date: f.date(s.currentPeriodEnd) })
      : '';
    return tail ? `${head} · ${tail}` : head;
  })();

  /* ── usage meters ── */
  type Meter = { label: string; value: string; pct: number; hint: string; warn?: boolean };
  const meters: Meter[] = [];
  const replayIncluded = s.replay.includedSeconds;
  meters.push({
    label: t('billing.meter.replayHours'),
    value:
      replayIncluded === null
        ? t('billing.meter.unlimited')
        : t('billing.meter.replayHoursValue', { used: f.hours(s.replay.usedSeconds), total: f.hours(replayIncluded) }),
    pct: replayIncluded ? Math.min(100, (s.replay.usedSeconds / replayIncluded) * 100) : 0,
    warn: replayIncluded !== null && s.replay.usedSeconds >= replayIncluded,
    hint:
      s.replay.creditSeconds > 0
        ? `${t('billing.meter.replayHoursHint', { date: f.date(s.window.end) })} ${t('billing.meter.credits', { hours: f.hours(s.replay.creditSeconds) })}`
        : t('billing.meter.replayHoursHint', { date: f.date(s.window.end) }),
  });
  meters.push({
    label: t('billing.meter.aiSummaries'),
    value:
      s.aiSummaries.limit === null
        ? t('billing.meter.unlimited')
        : t('billing.meter.aiValue', { used: s.aiSummaries.used, limit: s.aiSummaries.limit }),
    pct: s.aiSummaries.limit ? Math.min(100, (s.aiSummaries.used / s.aiSummaries.limit) * 100) : 0,
    warn: s.aiSummaries.limit !== null && s.aiSummaries.used >= s.aiSummaries.limit,
    hint: s.aiSummaries.limit === null ? t('billing.meter.aiHintUnlimited') : t('billing.meter.aiHint'),
  });
  meters.push({
    label: t('billing.meter.replays'),
    value:
      s.replays.limit === null
        ? t('billing.meter.replaysValueUnlimited', { kept: s.replays.kept })
        : t('billing.meter.replaysValue', { kept: Math.min(s.replays.kept, s.replays.limit), limit: s.replays.limit }),
    pct: s.replays.limit ? Math.min(100, (s.replays.kept / s.replays.limit) * 100) : 0,
    warn: s.replays.limit !== null && s.replays.kept >= s.replays.limit,
    hint:
      s.replays.archived > 0
        ? t('billing.meter.replaysArchived', { n: s.replays.archived })
        : t('billing.meter.replaysHint'),
  });
  meters.push({
    label: t('billing.meter.meetingLength'),
    value:
      s.limits.maxMeetingMinutes === null
        ? t('billing.meter.unlimited')
        : s.limits.maxMeetingMinutes >= 60
          ? t('billing.meter.meetingLengthValueHours', { hours: Math.round(s.limits.maxMeetingMinutes / 60) })
          : t('billing.meter.meetingLengthValue', { minutes: s.limits.maxMeetingMinutes }),
    pct: s.plan === 'FREE' ? 100 : 15,
    hint: t('billing.meter.meetingLengthHint'),
  });
  if (isSeatPlan(s.plan)) {
    meters.push({
      label: t('billing.meter.seats'),
      value: t('billing.meter.seatsValue', { used: s.seatsUsed, total: s.seats }),
      pct: s.seats ? Math.min(100, (s.seatsUsed / s.seats) * 100) : 0,
      hint: t('billing.dlg.seatsHint'),
    });
  }
  const replaysFull = s.replays.limit !== null && s.replays.kept >= s.replays.limit;

  /* ── plan cards ── */
  const features: Record<'FREE' | SelfServePlanId, string[]> = {
    FREE: [1, 2, 3, 4].map((n) => t(`billing.feat.free.${n}`)),
    PRO: [1, 2, 3, 4].map((n) => t(`billing.feat.pro.${n}`)),
    TEAM: [1, 2, 3, 4].map((n) => t(`billing.feat.team.${n}`)),
    BUSINESS: [1, 2, 3, 4].map((n) => t(`billing.feat.business.${n}`)),
  };

  const planCard = (p: CatalogPlan) => {
    const id = p.id as 'FREE' | SelfServePlanId;
    const price = p.prices[interval];
    const isCurrent = id === s.plan;
    const up = RANK[id] > RANK[s.plan];
    const available = id === 'FREE' || Boolean(price?.available);
    let label: string;
    let onClick: (() => void) | undefined;
    let cls = `${css.btn} ${css.btnOutline}`;
    if (isCurrent) {
      label = t('billing.currentPlanBtn');
    } else if (manual) {
      label = t('billing.switchTo', { plan: p.name });
    } else if (id === 'FREE') {
      label = t('billing.switchTo', { plan: p.name });
      onClick = () => setDialog({ kind: 'cancel' });
    } else if (paidStripe) {
      // Plan changes on a live subscription go through the Stripe portal (proration handled there).
      label = up ? t('billing.upgradeTo', { plan: p.name }) : t('billing.switchTo', { plan: p.name });
      cls = up ? `${css.btn} ${css.btnFill}` : cls;
      onClick = openPortal;
    } else {
      label = available ? t('billing.upgradeTo', { plan: p.name }) : t('billing.notAvailable');
      cls = `${css.btn} ${css.btnFill}`;
      onClick = available ? () => setDialog({ kind: 'upgrade', plan: id as SelfServePlanId }) : undefined;
    }
    const disabled = isCurrent || !onClick || !canManage || busy;
    let note = '';
    if (price) {
      note = yearly
        ? t('billing.billedYearly', { amount: f.money(price.amountCents) })
        : t('billing.billedMonthly');
      if (p.minSeats > 1) note = `${note} · ${t('billing.minSeats', { n: p.minSeats })}`;
    }
    return (
      <div key={id} className={`${css.plan} ${isCurrent ? css.planCurrent : ''}`}>
        <div className={css.planTitle}>
          <span>{p.name}</span>
          {isCurrent && <span className={`${css.badge} ${css.badgeTonal}`}>{t('billing.current')}</span>}
        </div>
        <div>
          <span className={css.price}>{price ? f.money(price.monthlyRateCents) : f.money(0)}</span>{' '}
          <span className={css.small}>
            {price ? (p.minSeats > 1 ? t('billing.perSeatMonth') : t('billing.perMonth')) : t('billing.forever')}
          </span>
        </div>
        <span className={css.small} style={{ minHeight: 16 }}>{note}</span>
        {features[id].map((feat) => (
          <div key={feat} className={css.feat}>{feat}</div>
        ))}
        <span className={css.grow} />
        <button type="button" className={cls} onClick={onClick} disabled={disabled}>
          {label}
        </button>
      </div>
    );
  };

  /* ── upgrade dialog ── */
  const dialogPlan = dialog?.kind === 'upgrade' ? planById(dialog.plan) : undefined;
  const dialogPrice = dialogPlan?.prices[interval];
  const qty = dialog?.kind === 'upgrade' && isSeatPlan(dialog.plan) ? Math.max(dialogPlan?.minSeats ?? 3, seats) : 1;
  const total = (dialogPrice?.amountCents ?? 0) * qty;

  const intervalToggle = (
    <div role="radiogroup" aria-label={t('billing.billingPeriod')} className={css.segGroup}>
      <button type="button" role="radio" aria-checked={!yearly} className={`${css.seg} ${!yearly ? css.segOn : ''}`} onClick={() => setYearly(false)}>
        {t('billing.monthly')}
      </button>
      <button type="button" role="radio" aria-checked={yearly} className={`${css.seg} ${yearly ? css.segOn : ''}`} onClick={() => setYearly(true)}>
        {t('billing.yearly')}
      </button>
    </div>
  );

  return shell(
    <>
      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`${css.notice} ${notice.kind === 'ok' ? css.noticeOk : notice.kind === 'error' ? css.noticeError : css.noticeInfo}`}
        >
          <span>{notice.text}</span>
          <span className={css.spacer} />
          <button type="button" className={css.iconBtn} onClick={() => setNotice(null)} aria-label={t('billing.dismiss')} style={{ color: 'inherit' }}>
            ✕
          </button>
        </div>
      )}

      <section className={`${css.card} ${css.cardRow}`}>
        <div className={css.planHead}>
          <span className={css.eyebrow}>{t('billing.currentPlan')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className={css.planName}>{s.planName}</h2>
            <span className={`${css.badge} ${badge.cls}`}>{badge.text}</span>
          </div>
          <span className={css.muted}>{planLine}</span>
          {!s.canManage && <span className={css.small}>{t('billing.adminOnly')}</span>}
        </div>
        <div className={css.actions}>
          {s.plan === 'FREE' && !manual && (
            <button
              type="button"
              className={`${css.btn} ${css.btnFill}`}
              disabled={!canManage || busy || !planById('PRO')?.prices[interval]?.available}
              onClick={() => setDialog({ kind: 'upgrade', plan: 'PRO' })}
            >
              {t('billing.upgradeToPro')}
            </button>
          )}
          {paidStripe && (
            <>
              <button type="button" className={`${css.btn} ${css.btnOutline}`} disabled={!canManage || busy} onClick={openPortal}>
                {t('billing.managePayment')}
              </button>
              <button type="button" className={`${css.btn} ${css.btnOutline}`} disabled={!canManage || busy} onClick={openPortal}>
                {t('billing.changePlan')}
              </button>
            </>
          )}
        </div>
      </section>

      <section className={css.card}>
        <div className={css.sectionHead}>
          <h2 className={css.h2}>{t('billing.usageTitle')}</h2>
          <span className={css.small}>{t('billing.usagePeriod', { start: f.date(s.window.start), end: f.date(s.window.end) })}</span>
        </div>
        <div className={css.meters}>
          {meters.map((m) => (
            <div key={m.label} className={css.meter}>
              <div className={css.meterHead}>
                <b>{m.label}</b>
                <span className={css.meterValue}>{m.value}</span>
              </div>
              <div className={css.track} aria-hidden="true">
                <div className={`${css.fill} ${m.warn ? css.fillWarn : ''}`} style={{ width: `${m.pct}%` }} />
              </div>
              <span className={css.small}>{m.hint}</span>
            </div>
          ))}
        </div>
        {replaysFull && !manual && (
          <div className={`${css.notice} ${css.noticeWarn}`}>
            <span>{t('billing.replaysFull', { kept: s.replays.kept, limit: s.replays.limit ?? 0 })}</span>
            <span className={css.spacer} />
            <button
              type="button"
              className={`${css.btn} ${css.btnText}`}
              style={{ height: 32 }}
              disabled={!canManage || busy}
              onClick={() => setDialog({ kind: 'upgrade', plan: 'PRO' })}
            >
              {t('billing.keepAllReplays')}
            </button>
          </div>
        )}
        {s.hoursPack.available && (
          <div className={css.row}>
            <span className={css.muted}>{t('billing.hoursPackHint')}</span>
            <button
              type="button"
              className={`${css.btn} ${css.btnOutline}`}
              disabled={!canManage || busy}
              onClick={() => void goTo('/api/billing/credits', { packs: 1 })}
            >
              {t('billing.buyHours', { price: f.money(s.hoursPack.amountCents) })}
            </button>
          </div>
        )}
      </section>

      <section className={css.card}>
        <div className={css.sectionHead}>
          <h2 className={css.h2}>{t('billing.plansTitle')}</h2>
          {intervalToggle}
        </div>
        <div className={css.plans}>{s.catalog.map(planCard)}</div>
        <span className={css.muted} style={{ fontSize: 13 }}>{t('billing.contactSales')}</span>
      </section>

      {paidStripe && (
        <>
          <section className={css.card}>
            <div className={css.row}>
              <h2 className={css.h2}>{t('billing.paymentTitle')}</h2>
              <button type="button" className={`${css.btn} ${css.btnText}`} disabled={!canManage || busy} onClick={openPortal}>
                {t('billing.update')}
              </button>
            </div>
            <span className={css.muted}>{t('billing.paymentHint')}</span>
          </section>
          <section className={css.card}>
            <div className={css.row}>
              <h2 className={css.h2}>{t('billing.invoicesTitle')}</h2>
              <button type="button" className={`${css.btn} ${css.btnText}`} disabled={!canManage || busy} onClick={openPortal}>
                {t('billing.viewInvoices')}
              </button>
            </div>
            <span className={css.muted}>{t('billing.invoicesHint')}</span>
            <div className={css.row} style={{ color: 'var(--km-text-muted)', fontSize: 13 }}>
              <span>
                {s.currentPeriodEnd
                  ? t(s.cancelAtPeriodEnd ? 'billing.planLine.ends' : 'billing.planLine.renews', { date: f.date(s.currentPeriodEnd) })
                  : ''}
              </span>
              {!s.cancelAtPeriodEnd && (
                <button
                  type="button"
                  className={`${css.btn} ${css.btnText} ${css.btnDangerText}`}
                  disabled={!canManage || busy}
                  onClick={() => setDialog({ kind: 'cancel' })}
                >
                  {t('billing.cancelPlan')}
                </button>
              )}
            </div>
          </section>
        </>
      )}

      {dialog?.kind === 'upgrade' && dialogPlan && (
        <div className={css.scrim} onClick={() => !busy && setDialog(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('billing.dlg.upgradeTitle', { plan: dialogPlan.name })}
            className={css.dialog}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={css.dialogTitle}>{t('billing.dlg.upgradeTitle', { plan: dialogPlan.name })}</h2>
            {intervalToggle}
            {isSeatPlan(dialog.plan) && (
              <>
                <div className={css.stepper}>
                  <b style={{ flex: 1 }}>{t('billing.dlg.seats')}</b>
                  <button
                    type="button"
                    className={css.step}
                    aria-label={t('billing.dlg.removeSeat')}
                    disabled={qty <= dialogPlan.minSeats}
                    onClick={() => setSeats(Math.max(dialogPlan.minSeats, qty - 1))}
                  >
                    −
                  </button>
                  <span className={css.seatCount} aria-live="polite">{qty}</span>
                  <button type="button" className={css.step} aria-label={t('billing.dlg.addSeat')} onClick={() => setSeats(qty + 1)}>
                    +
                  </button>
                </div>
                <span className={css.small} style={{ marginTop: -8 }}>{t('billing.dlg.seatsHint')}</span>
              </>
            )}
            <div className={css.totals}>
              <div className={css.totalsLine}>
                <span>
                  {[
                    dialogPlan.name,
                    isSeatPlan(dialog.plan) ? t('billing.dlg.seatsCount', { n: qty }) : null,
                    t(yearly ? 'billing.dlg.months12' : 'billing.dlg.month1'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <b>{f.moneyExact(total)}</b>
              </div>
              <div className={css.totalsLine} style={{ color: 'var(--km-text-muted)' }}>
                <span>{t('billing.dlg.tax')}</span>
                <span>{t('billing.dlg.taxHint')}</span>
              </div>
              <div className={css.divider} />
              <div className={css.totalsLine} style={{ fontSize: 16 }}>
                <b>{t('billing.dlg.dueToday')}</b>
                <b>{f.moneyExact(total)}</b>
              </div>
            </div>
            <p className={css.small} style={{ margin: 0, lineHeight: 1.6 }}>{t('billing.dlg.stripeNote')}</p>
            <div className={css.dialogFoot}>
              <button type="button" className={`${css.btn} ${css.btnText}`} disabled={busy} onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={`${css.btn} ${css.btnFill}`}
                disabled={busy || !dialogPrice?.available}
                onClick={() => void goTo('/api/billing/checkout', { plan: dialog.plan, interval, seats: qty })}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V8a4 4 0 018 0v3" />
                </svg>
                {busy ? t('billing.dlg.redirecting') : t('billing.dlg.continue')}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog?.kind === 'cancel' && (
        <div className={css.scrim} onClick={() => !busy && setDialog(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('billing.dlg.cancelTitle')}
            className={css.dialog}
            style={{ maxWidth: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={css.dialogTitle}>{t('billing.dlg.cancelTitle')}</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>{t('billing.dlg.cancelText', { plan: s.planName })}</p>
            <div className={css.dialogFoot}>
              <button type="button" className={`${css.btn} ${css.btnText}`} disabled={busy} onClick={() => setDialog(null)}>
                {t('billing.dlg.keepPlan')}
              </button>
              <button
                type="button"
                className={`${css.btn} ${css.btnDanger}`}
                disabled={busy}
                onClick={() => {
                  setDialog(null);
                  openPortal();
                }}
              >
                {t('billing.dlg.continueToCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
  );
}
