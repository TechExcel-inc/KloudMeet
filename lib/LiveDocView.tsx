'use client';

import React from 'react';
import {
  buildLiveDocIframeSrc,
  createOrUpdateInstantAccount,
  resolveLiveDocBaseUrl,
  type LiveDocEmbedRole,
  type LiveDocRuntimeSettings,
} from '@/lib/livedoc/client';
import { useI18n } from '@/lib/i18n';
import { authFetch } from '@/lib/kloudSession';
import {
  isToolbarMobileUserAgent,
  postLivedocRoleToIframe,
} from '@/lib/useToolbarIsMobile';
import styles from '@/styles/LiveDocView.module.css';

/** After this long without onkloudloaded, the loading screen says so and offers a reload. */
const IFRAME_SLOW_LOAD_MS = 60_000;

/* In-meeting surfaces are always dark (2026-10 redesign); the document itself stays white. */
const darkStageStyle: React.CSSProperties = {
  background: 'var(--km-stage, #17181c)',
  fontFamily: 'var(--km-font)',
};
const darkTitleStyle: React.CSSProperties = { color: 'var(--km-stage-text, #e8eaed)' };
const darkDetailStyle: React.CSSProperties = { color: 'var(--km-stage-muted, #9aa0a6)' };
const retryButtonStyle: React.CSSProperties = {
  minHeight: 40,
  padding: '0 20px',
  borderRadius: 999,
  background: 'var(--km-on-dark-accent, #c9c8ff)',
  color: '#1f1d6b',
  fontFamily: 'inherit',
  fontWeight: 700,
};
const loadingDotStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  margin: '0 auto 14px',
  borderRadius: '50%',
  border: '2px solid rgba(255, 255, 255, 0.14)',
  borderTopColor: 'var(--km-on-dark-accent, #c9c8ff)',
  animation: 'km-livedoc-spin 0.8s linear infinite',
};
const spinnerKeyframes = `@keyframes km-livedoc-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .km-livedoc-spinner { animation-duration: 2.4s !important; } }`;

interface LiveDocViewProps {
  meetingRoomName: string;
  participantName?: string;
  livedocInstanceId: string | null;
  hostInitError: string | null;
  hostInitInProgress: boolean;
  isHost: boolean;
  /** SkyMeet 实时身份：host / colhost / presenter / participant */
  livedocRole: LiveDocEmbedRole;
}

export function LiveDocView({
  meetingRoomName,
  participantName,
  livedocInstanceId,
  hostInitError,
  hostInitInProgress,
  isHost,
  livedocRole,
}: LiveDocViewProps) {
  const { t, locale } = useI18n();
  const [userToken, setUserToken] = React.useState<string | null>(null);
  const [tokenError, setTokenError] = React.useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = React.useState(true);
  const [pluginLoaded, setPluginLoaded] = React.useState(false);
  const [runtimeSettings, setRuntimeSettings] = React.useState<LiveDocRuntimeSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = React.useState(true);
  const [iframeReloadKey, setIframeReloadKey] = React.useState(0);
  const [loadSlow, setLoadSlow] = React.useState(false);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const livedocRoleRef = React.useRef(livedocRole);
  livedocRoleRef.current = livedocRole;
  /** iframe 首次加载用的 languageid；之后切语言只走 postMessage，避免重载 */
  const srcLanguageIdRef = React.useRef<0 | 1 | null>(null);

  React.useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      let cancelled = false;
      setSettingsLoading(true);
      authFetch('/api/settings?scope=livedoc')
        .then((res) => (res.ok ? res.json() : ({} as Record<string, unknown>)))
        .then((data) => {
          if (cancelled) return;
          const raw = (data as Record<string, unknown>).livedoc_debug_enabled;
          const debugEnabled =
            raw === true || raw === 'true' || raw === '1' || raw === 1;
          const debugUrl =
            typeof (data as Record<string, unknown>).livedoc_debug_url === 'string'
              ? String((data as Record<string, unknown>).livedoc_debug_url)
              : '';
          setRuntimeSettings({ debugEnabled, debugUrl });
        })
        .catch(() => {
          if (!cancelled) setRuntimeSettings({ debugEnabled: false, debugUrl: '' });
        })
        .finally(() => {
          if (!cancelled) setSettingsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    setRuntimeSettings({ debugEnabled: false, debugUrl: '' });
    setSettingsLoading(false);
  }, []);

  React.useEffect(() => {
    const name = participantName?.trim() || 'Guest';
    let cancelled = false;
    setTokenLoading(true);
    setTokenError(null);
    createOrUpdateInstantAccount(name)
      .then((token) => {
        if (!cancelled) {
          setUserToken(token);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setUserToken(null);
          setTokenError((e as Error).message ?? String(e));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTokenLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [participantName]);

  React.useEffect(() => {
    setPluginLoaded(false);
    srcLanguageIdRef.current = null;
    setIframeReloadKey(0);
    setLoadSlow(false);
  }, [livedocInstanceId, runtimeSettings?.debugEnabled, runtimeSettings?.debugUrl]);

  React.useLayoutEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as { type?: unknown } | null;
      if (!data || typeof data !== 'object' || data.type !== 'onkloudloaded') return;
      const cw = iframeRef.current?.contentWindow;
      if (!cw || e.source !== cw) return;
      setPluginLoaded(true);
      setLoadSlow(false);
      // 移动端与 Dev MainStage created() 一致：默认关闭右侧栏，勿用 Show:1 顶开
      const showPanel = isToolbarMobileUserAgent() ? 0 : 1;
      cw.postMessage({ type: 'Kloud-ShowFilePanel', Show: showPanel }, '*');
      // 插件就绪后同步当前 SkyMeet 身份（批注工具条权限）
      cw.postMessage({ type: 'onRoleChanged', role: livedocRoleRef.current }, '*');
      postLivedocRoleToIframe(livedocRoleRef.current);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // 挂上 iframe 后 60s 仍无 onkloudloaded → 提示"仍在加载"并给出重新加载按钮。
  // 不自动重载：网络慢时自动重载会让加载从头再来，反而更慢。
  React.useEffect(() => {
    if (!livedocInstanceId || !userToken || tokenLoading || settingsLoading || pluginLoaded || loadSlow) {
      return;
    }
    const timer = window.setTimeout(() => setLoadSlow(true), IFRAME_SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [livedocInstanceId, userToken, tokenLoading, settingsLoading, pluginLoaded, iframeReloadKey, loadSlow]);

  // 会议中身份变更时实时推送到插件
  React.useEffect(() => {
    if (!pluginLoaded) return;
    const cw = iframeRef.current?.contentWindow;
    if (cw) {
      cw.postMessage({ type: 'onRoleChanged', role: livedocRole }, '*');
    }
    postLivedocRoleToIframe(livedocRole);
  }, [livedocRole, pluginLoaded]);

  // 切语言：通知 iframe，不改 src（App.vue ReceiveLanguageChange：1=en，其它=cn）
  React.useEffect(() => {
    if (!pluginLoaded) return;
    const cw = iframeRef.current?.contentWindow;
    if (!cw) return;
    const languageid = locale === 'zh' ? 0 : 1;
    cw.postMessage({ type: 'changeLang', languageid }, '*');
  }, [locale, pluginLoaded]);

  const handleManualReload = React.useCallback(() => {
    setLoadSlow(false);
    setPluginLoaded(false);
    setIframeReloadKey((key) => key + 1);
  }, []);

  if (isHost && hostInitError) {
    return (
      <div className={styles.container} style={darkStageStyle}>
        <div className={styles.message} role="alert">
          <p className={styles.messageTitle} style={darkTitleStyle}>{t('livedoc.errorTitle')}</p>
          <p className={styles.messageDetail} style={darkDetailStyle}>{hostInitError}</p>
        </div>
      </div>
    );
  }

  if (!livedocInstanceId) {
    return (
      <div className={styles.container} style={darkStageStyle}>
        <div className={styles.message} role="status">
          <style>{spinnerKeyframes}</style>
          <div className="km-livedoc-spinner" style={loadingDotStyle} aria-hidden />
          <p className={styles.messageTitle} style={darkTitleStyle}>
            {isHost && hostInitInProgress
              ? t('livedoc.creating')
              : isHost
                ? t('livedoc.preparing')
                : t('livedoc.waitingHost')}
          </p>
          <p className={styles.messageDetail} style={darkDetailStyle}>
            {t('livedoc.room', { room: meetingRoomName })}
          </p>
        </div>
      </div>
    );
  }

  if (tokenLoading || settingsLoading) {
    return (
      <div className={styles.container} style={darkStageStyle}>
        <div className={styles.message} role="status">
          <style>{spinnerKeyframes}</style>
          <div className="km-livedoc-spinner" style={loadingDotStyle} aria-hidden />
          <p className={styles.messageTitle} style={darkTitleStyle}>{t('livedoc.fetchingToken')}</p>
        </div>
      </div>
    );
  }

  if (tokenError || !userToken) {
    return (
      <div className={styles.container} style={darkStageStyle}>
        <div className={styles.message} role="alert">
          <p className={styles.messageTitle} style={darkTitleStyle}>{t('livedoc.loadFailed')}</p>
          <p className={styles.messageDetail} style={darkDetailStyle}>
            {tokenError ?? t('livedoc.missingToken')}
          </p>
        </div>
      </div>
    );
  }

  const languageId = locale === 'zh' ? 0 : 1;
  // src 的 languageid / role 都固定在首次加载：后续只走 postMessage，避免 iframe 重载
  if (srcLanguageIdRef.current === null) {
    srcLanguageIdRef.current = languageId;
  }
  const src = buildLiveDocIframeSrc(
    livedocInstanceId,
    userToken,
    srcLanguageIdRef.current,
    runtimeSettings,
  );
  const baseUrl = resolveLiveDocBaseUrl(runtimeSettings);

  return (
    <div className={styles.container} style={darkStageStyle}>
      <iframe
        ref={iframeRef}
        key={`${livedocInstanceId}-${baseUrl}-${iframeReloadKey}`}
        id="sharedIframePlayer"
        title="LiveDoc"
        src={src}
        className={styles.iframe}
        allow="clipboard-read; clipboard-write;fullscreen *; autoplay *"
        sandbox="allow-scripts allow-forms allow-popups allow-pointer-lock allow-same-origin allow-modals"
      />
      {!pluginLoaded && (
        <div className={styles.loadingOverlay} style={darkStageStyle}>
          <div className={styles.message} role="status">
            <style>{spinnerKeyframes}</style>
            <div className="km-livedoc-spinner" style={loadingDotStyle} aria-hidden />
            <p className={styles.messageTitle} style={darkTitleStyle}>
              {loadSlow ? t('livedoc.stillLoading') : t('livedoc.loading')}
            </p>
            {loadSlow && (
              <>
                <p className={styles.messageDetail} style={darkDetailStyle}>{t('livedoc.stillLoadingDetail')}</p>
                <button
                  type="button"
                  className={styles.retryButton}
                  style={retryButtonStyle}
                  onClick={handleManualReload}
                >
                  {t('livedoc.retry')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
