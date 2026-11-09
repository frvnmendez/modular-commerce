import { defineConfig } from '@playwright/test';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * E2E reproducible: arranca la API y el servidor del panel (que debe estar compilado: `pnpm --filter
 * @mc/merchant-admin build`) contra la BD ya migrada. El límite de intentos va ACTIVADO y la cadena de
 * confianza es la de producción en una sola máquina: navegador → panel (127.0.0.1:3000) → API, que solo
 * confía en 127.0.0.1. Los emails se leen de MAIL_OUTBOX_FILE.
 */
export const OUTBOX = fileURLToPath(new URL('./test-results/outbox.jsonl', import.meta.url));
rmSync(OUTBOX, { force: true });
const root = fileURLToPath(new URL('../../', import.meta.url));
const env = { ...process.env, AUTH_RATE_LIMIT: 'on', TRUST_PROXY: '127.0.0.1', PANEL_TRUST_PROXY: '', MAIL_OUTBOX_FILE: OUTBOX,
  AUTH_BASE_URL: 'http://localhost:3000', ALLOWED_ORIGINS: 'http://localhost:3000' } as Record<string, string>;

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'node apps/commerce-api/src/server.ts', cwd: root, env: { ...env, PORT: '4000', HOST: '127.0.0.1' },
      url: 'http://127.0.0.1:4000/health', reuseExistingServer: false, stdout: 'pipe', timeout: 30_000 },
    { command: 'node server.mjs', cwd: `${root}apps/merchant-admin`, env: { ...env, PORT: '3000', HOSTNAME: '127.0.0.1' },
      url: 'http://127.0.0.1:3000/login', reuseExistingServer: false, timeout: 60_000 },
  ],
});
