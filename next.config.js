/** @type {import('next').NextConfig} */
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
};

module.exports = nextConfig;
