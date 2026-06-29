const DEFAULT_MEETING_SERVER = 'https://wss.peertime.cn/MeetingServer';
const DEFAULT_PEER_TIME = 'https://api.peertime.cn';

function parseLoopbackFlag(): boolean | null {
  const raw = process.env.LIVEDOC_SERVER_USE_LOOPBACK?.trim().toLowerCase();
  if (!raw) return null;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  return null;
}

/**
 * meet.kloud.cn and wss/api.peertime.cn share one host (74.208.27.19).
 * Node fetch via public DNS hairpins to the same box and often times out.
 * Default to loopback in production unless explicitly disabled.
 */
function shouldUseProductionLoopback(): boolean {
  const explicit = parseLoopbackFlag();
  if (explicit !== null) return explicit;
  return process.env.NODE_ENV === 'production';
}

export function getMeetingServerBase(): string {
  if (process.env.LIVEDOC_SERVER_API_BASE_URL) {
    return process.env.LIVEDOC_SERVER_API_BASE_URL;
  }
  if (shouldUseProductionLoopback()) {
    // Java often runs behind nginx/Docker — :8080 is not exposed on the host (ECONNREFUSED).
    // Default: local nginx on :80 with Host: wss.peertime.cn (see loopbackHostHeaders).
    // Override with LIVEDOC_MEETING_SERVER_PORT=8080 only when Tomcat listens on the host.
    const directPort = process.env.LIVEDOC_MEETING_SERVER_PORT?.trim();
    if (directPort) {
      return `http://127.0.0.1:${directPort}/MeetingServer`;
    }
    return 'http://127.0.0.1/MeetingServer';
  }
  return DEFAULT_MEETING_SERVER;
}

export function getPeerTimeApiBase(): string {
  if (process.env.PEER_TIME_API_BASE_URL) {
    return process.env.PEER_TIME_API_BASE_URL;
  }
  if (shouldUseProductionLoopback()) {
    return 'http://127.0.0.1';
  }
  return DEFAULT_PEER_TIME;
}

/**
 * nginx vhost routes need Host; direct Java on :8080 does not.
 */
function loopbackHostHeaders(base: string, publicHost: string): Record<string, string> {
  try {
    const parsed = new URL(base.includes('://') ? base : `http://${base}`);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      return {};
    }
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (port !== '80' && port !== '443') {
      return {};
    }
    return { Host: publicHost };
  } catch {
    return {};
  }
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
