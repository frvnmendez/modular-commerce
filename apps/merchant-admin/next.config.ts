import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_SERVER } from 'next/constants';

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

/**
 * En producción el panel solo puede servirse con `server.mjs`, que normaliza la IP del cliente
 * (docs/DEPLOYMENT.md §Cadena de confianza). Con `next start` los rewrites reenviarían a la API el
 * X-Forwarded-For que mande el cliente y el límite de intentos se podría eludir (reproducido: 8×401 sin 429
 * rotando la cabecera). `server.mjs` marca el proceso con MC_PANEL_SERVER=1 antes de arrancar Next.
 */
export default function nextConfig(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_SERVER && process.env.MC_PANEL_SERVER !== '1') {
    throw new Error('El panel debe arrancarse con `node server.mjs` (pnpm start), no con `next start`: ver docs/DEPLOYMENT.md');
  }
  return config;
}
