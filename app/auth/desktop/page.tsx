'use client';

import React, { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import styles from '../../../styles/Home.module.css';
import { AuthShell } from '../../home/components/ui';

/**
 * Last browser step of desktop Google sign-in: hands the one-time code to the app via
 * kloudmeet://auth (the app exchanges it together with its PKCE verifier).
 */
function DesktopAuthContent() {
  const { t } = useI18n();
  const router = useRouter();
  const code = useSearchParams().get('code');
  const deepLink = code ? `kloudmeet://auth?${new URLSearchParams({ code }).toString()}` : null;

  useEffect(() => {
    if (!deepLink) return;
    const timer = setTimeout(() => {
      window.location.href = deepLink;
    }, 300);
    return () => clearTimeout(timer);
  }, [deepLink]);

  return (
    <AuthShell
      onBack={() => router.replace('/')}
      title={deepLink ? t('desktopAuth.title') : t('desktopAuth.expiredTitle')}
      subtitle={deepLink ? t('desktopAuth.subtitle') : t('desktopAuth.expiredSubtitle')}
    >
      {deepLink && (
        <>
          <a className={`${styles.btn} ${styles.btnFill} ${styles.btnFlat}`} href={deepLink}>
            {t('desktopAuth.open')}
          </a>
          <p className={styles.authSub}>{t('desktopAuth.closeHint')}</p>
        </>
      )}
    </AuthShell>
  );
}

export default function DesktopAuthPage() {
  return (
    <Suspense fallback={null}>
      <DesktopAuthContent />
    </Suspense>
  );
}
