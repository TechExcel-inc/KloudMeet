const DEFAULT_MEETING_SERVER = 'https://wss.peertime.cn/MeetingServer';
const DEFAULT_PEER_TIME = 'https://api.peertime.cn';

/** Extra fetch headers when base URL points at local nginx (127.0.0.1) instead of public DNS. */
function loopbackHostHeaders(base: string, publicHost: string): Record<string, string> {
  try {
    const parsed = new URL(base.includes('://') ? base : `http://${base}`);
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
      return { Host: publicHost };
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function getMeetingServerBase(): string {
  return process.env.LIVEDOC_SERVER_API_BASE_URL ?? DEFAULT_MEETING_SERVER;
}

export function getPeerTimeApiBase(): string {
  return process.env.PEER_TIME_API_BASE_URL ?? DEFAULT_PEER_TIME;
}

export function buildMeetingServerUrl(path: string): { url: string; headers: Record<string, string> } {
  const base = getMeetingServerBase().replace(/\/$/, '');
  return {
    url: `${base}${path.startsWith('/') ? path : `/${path}`}`,
    headers: loopbackHostHeaders(base, 'wss.peertime.cn'),
  };
}

export function buildPeerTimeUrl(path: string): { url: string; headers: Record<string, string> } {
  const base = getPeerTimeApiBase().replace(/\/$/, '');
  return {
    url: `${base}${path.startsWith('/') ? path : `/${path}`}`,
    headers: loopbackHostHeaders(base, 'api.peertime.cn'),
  };
}

export function ensureHostBypassesProxy(targetUrl: string): void {
  let host: string;
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    return;
  }
  if (!host) return;

  const appendHost = (current: string | undefined): string => {
    const entries = (current ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!entries.includes(host)) entries.push(host);
    return entries.join(',');
  };

  process.env.NO_PROXY = appendHost(process.env.NO_PROXY);
  process.env.no_proxy = appendHost(process.env.no_proxy);
}

/** ES2020-safe: avoid Error.cause (requires lib es2022). */
export function formatUpstreamFetchError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown upstream error';
  const nested = (error as Error & { cause?: unknown }).cause;
  if (nested instanceof Error && nested.message) {
    return `${error.message} (${nested.message})`;
  }
  return error.message;
}
