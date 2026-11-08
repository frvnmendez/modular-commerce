import { closeAuthPools, createAuth, type MailMessage } from '@mc/auth';
import { closePools } from '@mc/db';
import { buildApp } from '../src/app.ts';

process.env.AUTH_RATE_LIMIT ??= 'off';

export function makeApp() {
  const outbox: MailMessage[] = [];
  const auth = createAuth({ mailer: async (m) => { outbox.push(m); }, baseURL: 'http://localhost:4000', secret: 'test-secret-'.padEnd(40, 'x'), trustedOrigins: ['http://localhost:3000'] });
  const app = buildApp({ auth, allowedOrigins: ['http://localhost:3000'], logger: false });
  return { app, outbox };
}

/** Cierra la app y todos los pools (BD de la app y de auth). */
export async function shutdown(app: { close: () => Promise<unknown> }) {
  await app.close();
  await closePools();
  await closeAuthPools();
}

export type App = ReturnType<typeof makeApp>['app'];
export type Client = { cookie: string; email: string; id: string; call: (method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>) => Promise<{ status: number; body: any }> };

let seq = 0;
/** Registra, verifica email e inicia sesión un usuario nuevo. */
export async function signUp(h: ReturnType<typeof makeApp>, name: string): Promise<Client> {
  const email = `${name.toLowerCase()}-${Date.now()}-${seq++}@test.local`;
  const r = await h.app.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: 'contraseña-segura-1', name } });
  if (r.statusCode !== 200) throw new Error(`sign-up ${r.statusCode} ${r.body}`);
  const mail = h.outbox.find((m) => m.to === email && m.kind === 'verify-email');
  if (!mail) throw new Error('sin email de verificación');
  const u = new URL(mail.url);
  const v = await h.app.inject({ method: 'GET', url: u.pathname + u.search });
  const setCookie = ([] as string[]).concat(v.headers['set-cookie'] ?? []);
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  if (!cookie.includes('session_token')) throw new Error(`verificación sin sesión: ${v.statusCode} ${JSON.stringify(v.headers)}`);
  const call: Client['call'] = async (method, url, body, extraHeaders = {}) => {
    const res = await h.app.inject({
      method: method as 'GET', url,
      headers: { cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null };
  };
  const me = await call('GET', '/v1/me');
  return { cookie, email, id: me.body.user.id, call };
}

const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

export const PROFILE = { businessType: 'fashion', productKinds: 'physical', fulfillment: 'own-inventory', markets: ['ES'], shippingNeeds: 'domestic', technicalLevel: 'beginner', goals: ['first-sales'] };

export async function createStore(c: Client, slug: string) {
  const org = await c.call('POST', '/v1/organizations', { name: `Org ${slug}` });
  const store = await c.call('POST', `/v1/organizations/${org.body.id}/stores`, { name: `Tienda ${slug}`, slug, country: 'ES', currency: 'EUR', profile: PROFILE });
  if (store.status !== 201) throw new Error(`create store ${store.status} ${JSON.stringify(store.body)}`);
  return { orgId: org.body.id as string, storeId: store.body.id as string };
}
