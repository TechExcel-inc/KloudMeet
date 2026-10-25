/**
 * "Design" stage mode: a link everyone in the meeting views in an embedded frame.
 * Shared by the server (validates before writing room metadata) and the client (validates
 * what arrives over the data channel). The embed URL is always rebuilt from `url` here —
 * never taken from another participant.
 */

export type DesignLinkKind = 'figma' | 'web';
export type FigmaEmbedType = 'design' | 'proto' | 'board' | 'slides' | 'deck';

export interface DesignLink {
  /** Link as pasted (normalized) */
  url: string;
  /** What the frame loads (Figma links become embed.figma.com links) */
  embedUrl: string;
  kind: DesignLinkKind;
  figmaType?: FigmaEmbedType;
  /** Short name for the design bar: Figma file name, or the site's host */
  label: string;
  host: string;
}

/** What room metadata / data-channel messages carry; everything else is derived. */
export interface StoredDesignLink {
  url: string;
  /** LiveKit identity and display name of whoever opened it */
  setBy?: string;
  setByName?: string;
  setAt?: number;
}

/** Locale key (and English fallback) naming what kind of link this is, e.g. "Figma prototype". */
export function designKindKey(link: Pick<DesignLink, 'kind' | 'figmaType'>): { key: string; fallback: string } {
  if (link.kind !== 'figma') return { key: 'design.kindWeb', fallback: 'Web page' };
  if (link.figmaType === 'proto') return { key: 'design.kindFigmaProto', fallback: 'Figma prototype' };
  if (link.figmaType === 'board') return { key: 'design.kindFigmaBoard', fallback: 'FigJam board' };
  if (link.figmaType === 'slides' || link.figmaType === 'deck') return { key: 'design.kindFigmaSlides', fallback: 'Figma slides' };
  return { key: 'design.kindFigmaDesign', fallback: 'Figma design' };
}

export type DesignLinkError = 'empty' | 'tooLong' | 'invalid' | 'notHttps' | 'sameSite' | 'privateHost';

export const DESIGN_EMBED_HOST = 'kloudmeet';
export const MAX_DESIGN_URL_LENGTH = 2048;

const FIGMA_HOSTS = new Set(['figma.com', 'www.figma.com', 'embed.figma.com']);
const FIGMA_TYPES: Record<string, FigmaEmbedType> = {
  file: 'design',
  design: 'design',
  proto: 'proto',
  board: 'board',
  slides: 'slides',
  deck: 'deck',
};
/** Share-link noise that the embed doesn't need */
const FIGMA_DROP_PARAMS = new Set(['t', 'fuid', 'embed-host', 'embed_host', 'client-id']);

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  if (!host.includes('.') && !host.includes(':')) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (host.includes(':')) {
    return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe80/.test(host) || host.startsWith('::ffff:');
  }
  return false;
}

function figmaLabel(slug: string | undefined): string {
  if (!slug) return 'Figma';
  try {
    const text = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
    return text || 'Figma';
  } catch {
    return 'Figma';
  }
}

/**
 * Turn a pasted link into what the stage shows.
 * `appOrigin` (e.g. https://meet.kloud.cn) is refused: the frame allows scripts and same-origin,
 * which would give the page this app's sign-in.
 */
export function parseDesignLink(
  input: string,
  opts: {
    appOrigin?: string | null;
    /** Development only: also accept http://localhost / 127.0.0.1 (other ports than the app) */
    allowLocalHttp?: boolean;
  } = {},
): { ok: true; link: DesignLink } | { ok: false; error: DesignLinkError } {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, error: 'empty' };
  if (raw.length > MAX_DESIGN_URL_LENGTH) return { ok: false, error: 'tooLong' };

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  const localDev =
    !!opts.allowLocalHttp &&
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (parsed.protocol !== 'https:' && !localDev) return { ok: false, error: 'notHttps' };
  if (!parsed.hostname || parsed.username || parsed.password) return { ok: false, error: 'invalid' };
  if (isPrivateHost(parsed.hostname) && !localDev) return { ok: false, error: 'privateHost' };
  if (opts.appOrigin) {
    try {
      if (new URL(opts.appOrigin).host.toLowerCase() === parsed.host.toLowerCase()) {
        return { ok: false, error: 'sameSite' };
      }
    } catch {
      /* ignore a bad app origin */
    }
  }
  parsed.hash = parsed.hash.length > 1 ? parsed.hash : '';
  const url = parsed.toString();
  const host = parsed.hostname.replace(/^www\./, '');

  if (FIGMA_HOSTS.has(parsed.hostname.toLowerCase())) {
    const segments = parsed.pathname.split('/').filter(Boolean);
    const figmaType = FIGMA_TYPES[segments[0]?.toLowerCase() ?? ''];
    const key = segments[1];
    if (figmaType && key && /^[A-Za-z0-9]{6,64}$/.test(key)) {
      const embed = new URL(`https://embed.figma.com/${figmaType}/${key}`);
      parsed.searchParams.forEach((value, name) => {
        if (!FIGMA_DROP_PARAMS.has(name)) embed.searchParams.append(name, value);
      });
      embed.searchParams.set('embed-host', DESIGN_EMBED_HOST);
      return {
        ok: true,
        link: {
          url,
          embedUrl: embed.toString(),
          kind: 'figma',
          figmaType,
          label: figmaLabel(segments[2]),
          host: 'figma.com',
        },
      };
    }
  }

  return { ok: true, link: { url, embedUrl: url, kind: 'web', label: host, host } };
}

/** Read a StoredDesignLink from untrusted JSON (room metadata, data-channel message). */
export function parseStoredDesignLink(value: unknown): StoredDesignLink | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.url !== 'string' || !v.url || v.url.length > MAX_DESIGN_URL_LENGTH) return null;
  return {
    url: v.url,
    ...(typeof v.setBy === 'string' ? { setBy: v.setBy.slice(0, 200) } : {}),
    ...(typeof v.setByName === 'string' ? { setByName: v.setByName.slice(0, 120) } : {}),
    ...(typeof v.setAt === 'number' && Number.isFinite(v.setAt) ? { setAt: v.setAt } : {}),
  };
}

/** Development builds accept local http design servers (see parseDesignLink). */
export const DESIGN_ALLOW_LOCAL_HTTP = process.env.NODE_ENV !== 'production';

/** Viewport the presenter shares: the frame is laid out at base size, then zoomed. */
export interface DesignViewport {
  zoom: number;
  baseWidth: number;
  baseHeight: number;
}

export const DESIGN_ZOOM_MIN = 0.5;
export const DESIGN_ZOOM_MAX = 2;

export function clampDesignZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(DESIGN_ZOOM_MAX, Math.max(DESIGN_ZOOM_MIN, Math.round(zoom * 100) / 100));
}

export function parseDesignViewport(value: unknown): DesignViewport | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const w = Number(v.baseWidth);
  const h = Number(v.baseHeight);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 200 || h < 150 || w > 8000 || h > 8000) return null;
  return { zoom: clampDesignZoom(Number(v.zoom)), baseWidth: Math.round(w), baseHeight: Math.round(h) };
}

/**
 * How the frame is drawn on a stage: laid out at base/zoom CSS pixels, then scaled so the
 * presenter's whole view fits this stage.
 */
export function designFrameLayout(viewport: DesignViewport, stageWidth: number, stageHeight: number) {
  const fit = Math.min(stageWidth / viewport.baseWidth, stageHeight / viewport.baseHeight);
  const safeFit = Number.isFinite(fit) && fit > 0 ? fit : 1;
  return {
    frameWidth: Math.round(viewport.baseWidth / viewport.zoom),
    frameHeight: Math.round(viewport.baseHeight / viewport.zoom),
    scale: safeFit * viewport.zoom,
    boxWidth: Math.round(viewport.baseWidth * safeFit),
    boxHeight: Math.round(viewport.baseHeight * safeFit),
  };
}
