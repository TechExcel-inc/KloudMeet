'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '@/styles/Tv.module.css';

const LOCALE_TAG: Record<string, string> = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR' };

export function TvBrand({ name }: { name: string }) {
  return (
    <div className={styles.brand}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/kloud-header-logo-white.svg" alt="Kloud Meet" height={56} className={styles.brandLogo} />
      <span className={styles.brandDivider} aria-hidden="true" />
      <span className={styles.brandName}>{name}</span>
    </div>
  );
}

export function TvClock() {
  const { locale } = useI18n();
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <div className={styles.clock} />;
  const tag = LOCALE_TAG[locale] ?? 'en-US';
  return (
    <div className={styles.clock}>
      <span className={styles.clockTime}>
        {now.toLocaleTimeString(tag, { hour: 'numeric', minute: '2-digit' })}
      </span>
      <span className={styles.clockDate}>
        {now.toLocaleDateString(tag, { weekday: 'short', month: 'short', day: 'numeric' })}
      </span>
    </div>
  );
}

/** Bottom row: what the remote's buttons do on this screen. */
export function TvKeyLegend({ voice = false, meeting = false }: { voice?: boolean; meeting?: boolean }) {
  const { t } = useI18n();
  return (
    <footer className={styles.legend}>
      <span className={styles.legendItem}>
        <span className={styles.keyCap}>◀ ▲ ▼ ▶</span>
        {t('tv.keys.move')}
      </span>
      <span className={styles.legendItem}>
        <span className={styles.keyCap}>OK</span>
        {t('tv.keys.select')}
      </span>
      <span className={styles.legendItem}>
        <span className={styles.keyCap}>Back</span>
        {t('tv.keys.back')}
      </span>
      {meeting && (
        <span className={styles.legendItem}>
          <span className={`${styles.colorKey} ${styles.keyGreen}`} />
          {t('tv.keys.green')}
        </span>
      )}
      {(voice || meeting) && (
        <span className={styles.legendItem}>
          <span className={`${styles.colorKey} ${styles.keyBlue}`} />
          {t('tv.keys.blue')}
        </span>
      )}
      <span className={styles.legendItem}>
        <span className={styles.keyCap}>Menu</span>
        {t('tv.keys.menu')}
      </span>
    </footer>
  );
}
