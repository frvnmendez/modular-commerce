import type { NextConfig } from 'next';

const api = process.env.API_URL ?? 'http://127.0.0.1:4000';

// El panel y la API comparten origen vía rewrites: las cookies de sesión son de primera parte (SameSite=Lax).
const config: NextConfig = {
  async rewrites() {
    return [
      { source: '/api/auth/:path*', destination: `${api}/api/auth/:path*` },
      { source: '/v1/:path*', destination: `${api}/v1/:path*` },
    ];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
  poweredByHeader: false,
};
export default config;
