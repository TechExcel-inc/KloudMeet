import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { DESIGN_ALLOW_LOCAL_HTTP, isPrivateHost, parseDesignLink } from '@/lib/designLink';
import { embedFromHeaders, type DesignEmbedCheck } from '@/lib/designEmbed';

const CHECK_TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 4;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;

const cache = new Map<string, { at: number; result: DesignEmbedCheck }>();

/** Resolve like the OS does, but refuse names that point at local-network addresses. */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateHost(a.address))) {
      return callback(Object.assign(new Error('Address not allowed'), { code: 'EADDRNOTALLOWED' }), '', 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

interface HeadResult {
  status: number;
  location: string | null;
  xFrameOptions: string | null;
  csp: string[];
}

/** GET the page and read only the response headers; the body is never downloaded. */
function readHeaders(url: URL, signal: AbortSignal, localDev: boolean): Promise<HeadResult> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'http:' ? http : https;
    const req = client.request(
      url,
      {
        method: 'GET',
        signal,
        // Local development servers are allowed in development only (parseDesignLink decides)
        ...(localDev ? {} : { lookup: publicOnlyLookup }),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KloudMeet-EmbedCheck/1.0; +https://kloudmeet.com)',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          // Some sites only send their framing headers to frame requests
          'Sec-Fetch-Dest': 'iframe',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'cross-site',
        },
      },
      (res) => {
        const raw = res.headers;
        const xfo = raw['x-frame-options'];
        const csp = raw['content-security-policy'];
        resolve({
          status: res.statusCode ?? 0,
          location: typeof raw.location === 'string' ? raw.location : null,
          xFrameOptions: Array.isArray(xfo) ? xfo.join(', ') : (xfo ?? null),
          csp: Array.isArray(csp) ? csp : csp ? [csp] : [],
        });
        res.destroy();
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Which addresses the check may fetch. Outside local development: the link rules (https, no
 * local-network names or addresses), the standard port only (so the check can't be pointed at
 * other services, e.g. on this server's own public address), and every resolved address public.
 */
function fetchable(url: URL): { ok: boolean; localDev: boolean } {
  const localDev = DESIGN_ALLOW_LOCAL_HTTP && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (localDev) return { ok: true, localDev };
  return { ok: url.protocol === 'https:' && (url.port === '' || url.port === '443'), localDev };
}

/**
 * Can `url` be shown in a frame on `appOrigin`? Follows redirects (each hop must pass the same
 * link rules), reads the final page's headers, and answers 'unknown' when the site can't be
 * reached, answers with an error, or isn't one the check may fetch.
 */
export async function checkDesignEmbed(url: string, appOrigin: string): Promise<DesignEmbedCheck> {
  const parsed = parseDesignLink(url, { appOrigin, allowLocalHttp: DESIGN_ALLOW_LOCAL_HTTP });
  if (!parsed.ok) return { embed: 'unknown' };
  // Figma's embed host is made for this
  if (parsed.link.kind === 'figma') return { embed: 'ok' };

  const key = `${appOrigin} ${parsed.link.url}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  let result: DesignEmbedCheck = { embed: 'unknown' };
  try {
    let current = new URL(parsed.link.url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const { ok, localDev } = fetchable(current);
      if (!ok) break;
      const head = await readHeaders(current, controller.signal, localDev);
      if (head.status >= 300 && head.status < 400 && head.location) {
        const next = parseDesignLink(new URL(head.location, current).toString(), {
          appOrigin,
          allowLocalHttp: DESIGN_ALLOW_LOCAL_HTTP,
        });
        if (!next.ok) break;
        current = new URL(next.link.url);
        continue;
      }
      if (head.status >= 200 && head.status < 300) {
        result = embedFromHeaders(head, appOrigin, current.toString());
      }
      break;
    }
  } catch {
    result = { embed: 'unknown' };
  } finally {
    clearTimeout(timer);
  }

  // Only answers are kept: a timeout or a network error is worth trying again
  if (result.embed !== 'unknown') {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), result });
  }
  return result;
}
