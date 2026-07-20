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
import styles from '../styles/LiveDocView.module.css';

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
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const livedocRoleRef = React.useRef(livedocRole);
  livedocRoleRef.current = livedocRole;

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
      .then((t) => {
        if (!cancelled) {
          setUserToken(t);
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
  }, [livedocInstanceId]);

  React.useLayoutEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as { type?: unknown } | null;
      if (!data || typeof data !== 'object' || data.type !== 'onkloudloaded') return;
      const cw = iframeRef.current?.contentWindow;
      if (!cw || e.source !== cw) return;
      setPluginLoaded(true);
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

  // 会议中身份变更时实时推送到插件
  React.useEffect(() => {
    if (!pluginLoaded) return;
    const cw = iframeRef.current?.contentWindow;
    if (cw) {
      cw.postMessage({ type: 'onRoleChanged', role: livedocRole }, '*');
    }
    postLivedocRoleToIframe(livedocRole);
  }, [livedocRole, pluginLoaded]);

  if (isHost && hostInitError) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>{t('livedoc.errorTitle')}</p>
          <p className={styles.messageDetail}>{hostInitError}</p>
        </div>
      </div>
    );
  }

  if (!livedocInstanceId) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>
            {isHost && hostInitInProgress
              ? t('livedoc.creating')
              : isHost
                ? t('livedoc.preparing')
                : t('livedoc.waitingHost')}
          </p>
          <p className={styles.messageDetail}>{t('livedoc.room', { room: meetingRoomName })}</p>
        </div>
      </div>
    );
  }

  if (tokenLoading || settingsLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>{t('livedoc.fetchingToken')}</p>
        </div>
      </div>
    );
  }

  if (tokenError || !userToken) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <p className={styles.messageTitle}>{t('livedoc.loadFailed')}</p>
          <p className={styles.messageDetail}>{tokenError ?? t('livedoc.missingToken')}</p>
        </div>
      </div>
    );
  }

  const languageId = locale === 'zh' ? 0 : 1;
  // src 不含 role：身份只走 postMessage(onRoleChanged)，避免身份变更触发 iframe 重载
  const src = buildLiveDocIframeSrc(livedocInstanceId, userToken, languageId, runtimeSettings);
  const baseUrl = resolveLiveDocBaseUrl(runtimeSettings);

  return (
    <div className={styles.container}>
      <iframe
        ref={iframeRef}
        key={`${livedocInstanceId}-${baseUrl}`}
        id="sharedIframePlayer"
        title="LiveDoc"
        src={src}
        className={styles.iframe}
        allow="clipboard-read; clipboard-write;fullscreen *; autoplay *"
        sandbox="allow-scripts allow-forms allow-popups allow-pointer-lock allow-same-origin allow-modals"
      />
      {!pluginLoaded && (
        <div className={styles.loadingOverlay}>
          <div className={styles.message}>
            <p className={styles.messageTitle}>{t('livedoc.loading')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
