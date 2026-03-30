/** @type {import('next').NextConfig} */

// Read remote API URL from .env.local — set it locally for dev proxy, leave empty on server.
const REMOTE_API = (process.env.NEXT_PUBLIC_REMOTE_API || '').trim();
if (REMOTE_API) console.log(`[next.config] API proxy → ${REMOTE_API}`);

const nextConfig = {
  reactStrictMode: false,
  // Disable Next.js Dev Tools indicator (bottom-left "N" / Turbopack menu) in development.
  devIndicators: false,
  /** Ship a minimal Node server for Electron / self-host (see scripts/prepare-standalone.js). */
  output: 'standalone',
  productionBrowserSourceMaps: true,
  images: {
    formats: ['image/webp'],
  },
  serverExternalPackages: ['better-sqlite3'],
  webpack: (config, { buildId, dev, isServer, defaultLoaders, nextRuntime, webpack }) => {
    // Important: return the modified config
    config.module.rules.push({
      test: /\.mjs$/,
      enforce: 'pre',
      use: ['source-map-loader'],
    });

    return config;
  },
  headers: async () => {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          // No Cross-Origin-Embedder-Policy: embedding third-party iframes (e.g. LiveDoc on kloud.cn)
          // requires their CORP headers or omitting COEP on the parent; we omit COEP for compatibility.
        ],
      },
    ];
  },
  // Proxy /api/* to remote server — beforeFiles ensures this runs BEFORE local API routes
  rewrites: async () => {
    if (!REMOTE_API) return [];
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${REMOTE_API}/api/:path*`,
        },
      ],
    };
  },
};

module.exports = nextConfig;
