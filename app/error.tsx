'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import { isWeChatBrowser } from '@/lib/SlowLoadHint';
import styles from '@/styles/SlowLoadHint.module.css';

/**
 * A page that failed to load its code or crashed: say so, show the error (so a screenshot tells
 * us what happened) and offer a full reload, instead of Next's near-blank default.
 */
export default function PageError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  const [weChat, setWeChat] = React.useState(false);

  React.useEffect(() => {
    setWeChat(isWeChatBrowser());
    console.error('[page error]', error);
  }, [error]);

  return (
    <div className={styles.errorPage} role="alert">
      <h1 className={styles.errorTitle}>{t('loading.errorTitle')}</h1>
      <p className={styles.errorText}>{t('loading.errorHint')}</p>
      {weChat && <p className={styles.errorText}>{t('loading.wechatOpenInBrowser')}</p>}
      <p className={styles.errorDetail}>{error.message || error.digest || error.name}</p>
      <button type="button" className={styles.reload} onClick={() => window.location.reload()}>
        {t('loading.reload')}
      </button>
    </div>
  );
}
