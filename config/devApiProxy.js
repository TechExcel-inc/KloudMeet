/**
 * Local dev API routing when NEXT_PUBLIC_REMOTE_API is set.
 *
 * Problem: a catch-all /api/* → remote rewrite bypasses local route.ts handlers.
 * That is correct for SkyMeet DB routes (use production code + DB), but wrong for
 * routes that proxy to third-party services (PeerTime, LiveKit, AssemblyAI, …) when
 * the remote server cannot reach them or must use this machine's .env.local secrets.
 *
 * Rule of thumb when adding a new app/api route:
 * - Uses prisma / KloudMeet DB only        → remote (default, no entry here)
 * - Proxies to external API (BFF)          → add prefix to LOCAL_API_PREFIXES
 * - Hybrid (DB + external) + external must egress from dev machine → add prefix here
 *
 * Override / extend without code changes:
 *   NEXT_PUBLIC_LOCAL_API_PREFIXES=foo,bar/baz
 */

/** @type {readonly string[]} */
const LOCAL_API_PREFIXES = [
  // PeerTime LiveDoc BFF — remote SkyMeet often cannot reach wss/api.peertime.cn
  'livedoc',
  // SSO validates kloud.cn cookie via PeerTime UserProfile API
  'auth/sso',
];

/**
 * @param {string | undefined | null} raw
 * @returns {string[]}
 */
function parseEnvPrefixList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function getLocalApiPrefixes(env = process.env) {
  const extra = parseEnvPrefixList(env.NEXT_PUBLIC_LOCAL_API_PREFIXES);
  return [...new Set([...LOCAL_API_PREFIXES, ...extra])];
}

/**
 * @param {string[]} prefixes
 * @returns {string}
 */
function buildProxiedApiPathParam(prefixes) {
  if (!prefixes.length) return ':path*';
  const escaped = prefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `:path((?!${escaped.join('(?:/|$)|')}(?:/|$)).*)`;
}

/**
 * @param {string} remoteApi
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ beforeFiles: Array<{ source: string; destination: string }> }}
 */
function buildDevApiRewrites(remoteApi, env = process.env) {
  const base = remoteApi.replace(/\/$/, '');
  const localPrefixes = getLocalApiPrefixes(env);
  const pathParam = buildProxiedApiPathParam(localPrefixes);

  if (localPrefixes.length) {
    console.log(
      `[next.config] API proxy → ${base} (local-only: ${localPrefixes.join(', ')})`,
    );
  } else {
    console.log(`[next.config] API proxy → ${base}`);
  }

  return {
    beforeFiles: [
      {
        source: `/api/${pathParam}`,
        destination: `${base}/api/:path`,
      },
    ],
  };
}

module.exports = {
  LOCAL_API_PREFIXES,
  getLocalApiPrefixes,
  buildProxiedApiPathParam,
  buildDevApiRewrites,
};
