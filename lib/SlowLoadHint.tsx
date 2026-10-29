'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import styles from '@/styles/SlowLoadHint.module.css';

/** WeChat's built-in browser. */
export function isWeChatBrowser(): boolean {
  return typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);
}

/**
 * A line under a loading spinner that fades in after a few seconds (a CSS delay, so it also shows
 * while the scripts are still downloading): the network may be slow, and in WeChat the page can
 * be opened in a browser. Until the scripts run, the language and the browser are unknown, so it
 * says both in English and Chinese.
 */
export function SlowLoadHint() {
  const { t } = useI18n();
  const [ready, setReady] = React.useState(false);
  const [weChat, setWeChat] = React.useState(false);

  React.useEffect(() => {
    setReady(true);
    setWeChat(isWeChatBrowser());
  }, []);

  return (
    <div className={styles.hint} role="note">
      {ready ? (
        <>
          <p>{t('loading.slow')}</p>
          {weChat && <p>{t('loading.wechatOpenInBrowser')}</p>}
        </>
      ) : (
        <>
          <p>Still loading. The network may be slow. In WeChat, tap ··· at the top right and choose Open in Browser.</p>
          <p>仍在加载，网络可能较慢。在微信里，可以点右上角 ··· 选择“在浏览器打开”。</p>
        </>
      )}
    </div>
  );
}
