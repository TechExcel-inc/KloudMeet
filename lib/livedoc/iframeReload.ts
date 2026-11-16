/** 挂上 iframe 后这么久仍未就绪，才给出手动重载。不自动重载。 */
export const LIVEDOC_IFRAME_SLOW_MS = 60_000;

export const LIVEDOC_IFRAME_RELOAD_EVENT = 'kloud-livedoc-iframe-reload';

/** requestLiveDocIframeReload — 让 LiveDocView 按「重新加载」重挂 iframe。视图遮罩与 Doc AI 弹窗共用。 */
export function requestLiveDocIframeReload(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(LIVEDOC_IFRAME_RELOAD_EVENT));
}
