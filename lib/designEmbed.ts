/**
 * Design mode: can a site be shown inside the meeting? Sites opt out of being framed with
 * X-Frame-Options or a Content-Security-Policy frame-ancestors directive; the browser then shows
 * its own "refused to connect" page in the frame. These rules follow the HTML and CSP specs so
 * the server can tell before the link is shared.
 */

export type DesignEmbedStatus = 'ok' | 'blocked' | 'unknown';

export interface DesignEmbedCheck {
  embed: DesignEmbedStatus;
  /** Which header said no */
  reason?: 'xfo' | 'csp';
}

export function parseDesignEmbedCheck(value: unknown): DesignEmbedCheck {
  if (!value || typeof value !== 'object') return { embed: 'unknown' };
  const v = value as Record<string, unknown>;
  const embed = v.embed === 'ok' || v.embed === 'blocked' ? v.embed : 'unknown';
  return { embed, ...(v.reason === 'xfo' || v.reason === 'csp' ? { reason: v.reason } : {}) };
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

function portOf(url: URL): string {
  return url.port || DEFAULT_PORTS[url.protocol] || '';
}

/** Does one frame-ancestors source expression allow `ancestor` (the meeting's origin)? */
function sourceMatches(source: string, ancestor: URL, framed: URL): boolean {
  const expr = source.toLowerCase();
  if (expr === '*') return ancestor.protocol === 'http:' || ancestor.protocol === 'https:';
  if (expr === "'self'") return ancestor.origin === framed.origin;
  if (expr.startsWith("'")) return false; // 'none', nonces, hashes and other keywords match nothing
  // scheme-source, e.g. "https:"
  if (/^[a-z][a-z0-9+.-]*:$/.test(expr)) {
    return expr === ancestor.protocol || (expr === 'http:' && ancestor.protocol === 'https:');
  }
  // host-source: [scheme://]host[:port][/path]
  const m = expr.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+)(?::(\*|\d+))?(?:\/.*)?$/);
  if (!m) return false;
  const [, scheme, host, port] = m;
  if (scheme) {
    const ok = `${scheme}:` === ancestor.protocol || (scheme === 'http' && ancestor.protocol === 'https:');
    if (!ok) return false;
  } else if (!(ancestor.protocol === framed.protocol || (framed.protocol === 'http:' && ancestor.protocol === 'https:'))) {
    return false;
  }
  const ancestorHost = ancestor.hostname.toLowerCase();
  if (host === '*') {
    // "*" alone is handled above; "https://*" matches any host
  } else if (host.startsWith('*.')) {
    if (!ancestorHost.endsWith(host.slice(1))) return false;
  } else if (host !== ancestorHost) {
    return false;
  }
  if (port === '*') return true;
  const wanted = port || DEFAULT_PORTS[scheme ? `${scheme}:` : ancestor.protocol] || '';
  const actual = portOf(ancestor);
  // An http source without a port also allows the https default port (upgrade)
  return wanted === actual || (!port && scheme === 'http' && ancestor.protocol === 'https:' && actual === '443');
}

/**
 * frame-ancestors in the enforced CSP headers: null when no policy has the directive,
 * otherwise whether every policy that has it allows the ancestor.
 */
export function frameAncestorsAllow(cspHeaders: string[], ancestorOrigin: string, framedUrl: string): boolean | null {
  let ancestor: URL;
  let framed: URL;
  try {
    ancestor = new URL(ancestorOrigin);
    framed = new URL(framedUrl);
  } catch {
    return null;
  }
  let found = false;
  for (const header of cspHeaders) {
    // Several policies can arrive in one header, separated by commas
    for (const policy of header.split(',')) {
      const directive = policy
        .split(';')
        .map((d) => d.trim().split(/[\t\n\f\r ]+/).filter(Boolean))
        .find((tokens) => tokens.length > 0 && tokens[0].toLowerCase() === 'frame-ancestors');
      if (!directive) continue;
      found = true;
      const sources = directive.slice(1);
      if (!sources.some((source) => sourceMatches(source, ancestor, framed))) return false;
    }
  }
  return found ? true : null;
}

/** X-Frame-Options as the HTML spec reads it, for a frame whose parent is another site. */
export function xFrameOptionsAllow(value: string | null): boolean {
  if (!value) return true;
  const values = new Set(
    value
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
  if (values.size === 0) return true;
  if (values.size > 1) return !(values.has('deny') || values.has('allowall') || values.has('sameorigin'));
  const [only] = Array.from(values);
  // ALLOW-FROM and unknown values are ignored by browsers
  return only !== 'deny' && only !== 'sameorigin';
}

/** Decide from a page's response headers whether `ancestorOrigin` may show it in a frame. */
export function embedFromHeaders(
  headers: { xFrameOptions: string | null; csp: string[] },
  ancestorOrigin: string,
  framedUrl: string,
): DesignEmbedCheck {
  // When CSP has frame-ancestors, browsers ignore X-Frame-Options
  const csp = frameAncestorsAllow(headers.csp, ancestorOrigin, framedUrl);
  if (csp === false) return { embed: 'blocked', reason: 'csp' };
  if (csp === true) return { embed: 'ok' };
  return xFrameOptionsAllow(headers.xFrameOptions) ? { embed: 'ok' } : { embed: 'blocked', reason: 'xfo' };
}
