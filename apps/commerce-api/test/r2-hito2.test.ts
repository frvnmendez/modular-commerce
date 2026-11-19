/**
 * Hito 2: cobros por tienda (Stripe Connect), subdominios, diseño de la tienda y emails.
 * Stripe se sustituye por un servidor local; la firma de los avisos es la real (HMAC).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import pg from 'pg';
import nodemailer from 'nodemailer';
import { createStore, makeApp, shutdown, signUp, type Client } from './harness.ts';
import { platformFee, signStripePayload } from '../src/payments.ts';
import { createMailer, renderMail } from '../src/mailer.ts';

const WHSEC = 'whsec_hito2';
const CONNECT_WHSEC = 'whsec_hito2_connect';
const DOMAIN = 'plataforma.test';
const STORE = () => `http://${slug}.${DOMAIN}:3000`;   // mismo puerto que la URL pública de la prueba
const RUN = Date.now().toString(36);
const calls: { method: string; path: string; body: URLSearchParams; idem?: string }[] = [];
const accounts = new Map<string, { charges_enabled: boolean; details_submitted: boolean; payouts_enabled: boolean }>();
let mock: Server;
let seq = 0;
let h: ReturnType<typeof makeApp>;
let owner: Client;
let staff: Client;
let store: { storeId: string };
let slug: string;
let variantId: string;
let accountId: string;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CUSTOMER = { email: 'comprador@example.com', name: 'Comprador', address: { line1: 'Calle 1', city: 'Bilbao', postalCode: '48001' } };

async function adminQuery(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL!.replace(/\/[^/]*$/, `/${process.env.DATABASE_NAME ?? 'modular_commerce'}`) });
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}
const pub = async (url: string, body: unknown, origin = 'http://localhost:3000') => {
  const r = await h.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', origin }, payload: JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const signed = async (url: string, event: unknown, secret: string) => {
  const raw = JSON.stringify(event);
  const r = await h.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(raw, secret) }, payload: raw });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const checkout = (origin?: string) => pub(`/public/stores/${slug}/checkout`, { lines: [{ variantId, quantity: 2 }], customer: CUSTOMER }, origin);

beforeAll(async () => {
  mock = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const path = req.url!;
      calls.push({ method: req.method!, path, body: new URLSearchParams(data), idem: req.headers['idempotency-key'] as string | undefined });
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== 'Bearer sk_test_mock') { res.statusCode = 401; return res.end('{"error":{"message":"bad key"}}'); }
      if (path === '/v1/accounts' && req.method === 'POST') {
        const id = `acct_${RUN}${++seq}x`;
        accounts.set(id, { charges_enabled: false, details_submitted: false, payouts_enabled: false });
        return res.end(JSON.stringify({ id }));
      }
      const acc = /^\/v1\/accounts\/(acct_\w+)(\/login_links)?$/.exec(path);
      if (acc) {
        const a = accounts.get(acc[1]!);
        if (!a) { res.statusCode = 404; return res.end('{}'); }
        return res.end(JSON.stringify(acc[2] ? { url: 'https://connect.stripe.test/express/x' } : { id: acc[1], ...a }));
      }
      if (path === '/v1/account_links') return res.end(JSON.stringify({ url: `https://connect.stripe.test/setup/${++seq}` }));
      if (path === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: `cs_test_${RUN}_${++seq}`, url: `https://checkout.stripe.test/c/${seq}` }));
      if (path === '/v1/refunds') return res.end(JSON.stringify({ id: `re_${++seq}`, status: 'succeeded' }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  const port = (mock.address() as { port: number }).port;
  h = makeApp({
    platformDomain: DOMAIN,
    payments: { provider: 'stripe', secretKey: 'sk_test_mock', webhookSecret: WHSEC, apiBase: `http://127.0.0.1:${port}`,
      connect: { platformFeeBp: 250, webhookSecret: CONNECT_WHSEC } },
  });
  await h.app.ready();
  owner = await signUp(h, 'ConnectOwner');
  staff = await signUp(h, 'ConnectStaff');
  slug = `cx-${RUN}`;
  store = await createStore(owner, slug);
  const inv = await owner.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: staff.email, role: 'staff' });
  await staff.call('POST', '/v1/invitations/accept', { token: inv.body.token });
  await owner.call('PATCH', `/v1/stores/${store.storeId}/sales-settings`, { storefrontPublished: true, shippingFlatAmount: 395, taxRateBp: 2100, contactEmail: 'avisos@tienda.test' });
  const p = await owner.call('POST', `/v1/stores/${store.storeId}/products`, { title: 'Vela', status: 'active', variants: [{ title: 'Lavanda', price: 1490, stock: 10 }] });
  variantId = p.body.variants[0].id;
});
afterAll(async () => { await shutdown(h.app); await new Promise((r) => mock.close(r)); });

describe('Cobros por tienda (Stripe Connect)', () => {
  it('sin cuenta conectada la tienda no vende y no se reserva stock', async () => {
    expect((await owner.call('GET', `/v1/stores/${store.storeId}/payments`)).body).toEqual({ mode: 'connect', platformFeeBp: 250, ready: false, account: null });
    const r = await checkout();
    expect(r).toEqual({ status: 409, body: { error: 'CONFLICT', detail: 'PAYMENTS_NOT_READY' } });
    expect(await adminQuery('SELECT count(*)::int AS n FROM commerce.orders WHERE tenant_id = $1', [store.storeId])).toEqual([{ n: 0 }]);
    const pubStore = await h.app.inject({ method: 'GET', url: `/public/stores/${slug}` });
    expect(JSON.parse(pubStore.body).paymentAccountReady).toBe(false);
  });

  it('el personal no puede conectar la cuenta; el propietario sí, y solo se crea una', async () => {
    expect((await staff.call('POST', `/v1/stores/${store.storeId}/payments/connect`, {})).status).toBe(403);
    calls.length = 0;
    const a = await owner.call('POST', `/v1/stores/${store.storeId}/payments/connect`, {});
    expect(a.status).toBe(200);
    expect(a.body.url).toMatch(/^https:\/\/connect\.stripe\.test\/setup\//);
    const created = calls.find((c) => c.path === '/v1/accounts')!;
    expect(created.idem).toBe(`account-${store.storeId}`);
    expect(created.body.get('type')).toBe('express');
    expect(created.body.get('country')).toBe('ES');
    expect(created.body.get('email')).toBe('avisos@tienda.test');
    const link = calls.find((c) => c.path === '/v1/account_links')!;
    expect(link.body.get('return_url')).toBe(`http://localhost:3000/stores/${store.storeId}/settings?stripe=volver`);
    const again = await owner.call('POST', `/v1/stores/${store.storeId}/payments/connect`, {});
    expect(again.status).toBe(200);
    expect(calls.filter((c) => c.path === '/v1/accounts')).toHaveLength(1);
    accountId = (await adminQuery('SELECT account_id FROM commerce.payment_accounts WHERE tenant_id = $1', [store.storeId]))[0].account_id;
    expect(accountId).toMatch(/^acct_/);
  });

  it('el estado «puede cobrar» solo viene de Stripe: la app no puede escribirlo', async () => {
    expect(await adminQuery(`SELECT has_table_privilege('mc_app', 'commerce.payment_accounts', 'UPDATE') AS u,
      has_column_privilege('mc_app', 'commerce.payment_accounts', 'charges_enabled', 'INSERT') AS i`)).toEqual([{ u: false, i: false }]);
    // Alta sin terminar: sigue sin poder vender.
    const r1 = await owner.call('POST', `/v1/stores/${store.storeId}/payments/refresh`, {});
    expect(r1.body).toMatchObject({ ready: false, account: { chargesEnabled: false } });
    accounts.set(accountId, { charges_enabled: true, details_submitted: true, payouts_enabled: true });
    const r2 = await owner.call('POST', `/v1/stores/${store.storeId}/payments/refresh`, {});
    expect(r2.body).toEqual({ mode: 'connect', platformFeeBp: 250, ready: true, account: { chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: true } });
  });

  let orderId = '';
  let total = 0;
  it('la compra se cobra en la cuenta de la tienda, con la comisión de la plataforma', async () => {
    calls.length = 0;
    const r = await checkout();
    expect(r.status).toBe(201);
    orderId = r.body.orderId; total = r.body.order.total;
    expect(total).toBe(2 * 1490 + 395);
    const s = calls.find((c) => c.path === '/v1/checkout/sessions')!;
    expect(s.body.get('payment_intent_data[transfer_data][destination]')).toBe(accountId);
    expect(s.body.get('payment_intent_data[on_behalf_of]')).toBe(accountId);
    expect(s.body.get('payment_intent_data[application_fee_amount]')).toBe(String(platformFee(total, 250)));
    expect(platformFee(total, 250)).toBe(84);   // 3375 × 2,5 % = 84,375 → 84 (nunca de más)
    // Subdominio: la vuelta del pago va a <slug>.<dominio>.
    expect(s.body.get('success_url')!.startsWith(`${STORE()}/pedido/${orderId}?t=`)).toBe(true);
    expect(s.body.get('cancel_url')).toBe(`${STORE()}/carrito?cancelado=1`);
    expect(await adminQuery('SELECT payment_account_id FROM commerce.orders WHERE id = $1', [orderId])).toEqual([{ payment_account_id: accountId }]);
  });

  it('un pedido no se puede asociar a la cuenta de otra tienda', async () => {
    const other = await signUp(h, 'OtherConnect');
    const os = await createStore(other, `cy-${RUN}`);
    await adminQuery(`INSERT INTO commerce.payment_accounts (tenant_id, provider, account_id, charges_enabled) VALUES ($1, 'stripe', $2, true)`, [os.storeId, `acct_${RUN}other`]);
    const pending = await checkout();
    const c = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL!.replace(/\/[^/]*$/, `/${process.env.DATABASE_NAME ?? 'modular_commerce'}`) });
    await c.connect();
    try {
      await c.query('SET ROLE mc_storefront');
      await expect(c.query(`SELECT storefront.attach_payment_session($1, 'cs_otro', $2)`, [pending.body.orderId, `acct_${RUN}other`])).rejects.toThrow(/PAYMENT_ACCOUNT_MISMATCH/);
      await expect(c.query(`UPDATE commerce.orders SET payment_account_id = $2 WHERE id = $1`, [pending.body.orderId, `acct_${RUN}other`])).rejects.toThrow(/permission denied/);
    } finally { await c.end(); }
  });

  it('el aviso de pago confirma el pedido y el reembolso recupera la transferencia y la comisión', async () => {
    const session = (await adminQuery('SELECT payment_session_id FROM commerce.orders WHERE id = $1', [orderId]))[0].payment_session_id;
    const ev = { id: `evt_${RUN}_paid`, type: 'checkout.session.completed', data: { object: { id: session, payment_status: 'paid', amount_total: total, currency: 'eur', payment_intent: `pi_${RUN}`, metadata: { order_id: orderId } } } };
    expect((await signed('/webhooks/stripe', ev, WHSEC)).body).toEqual({ received: true, result: 'paid' });
    // El aviso llega sin el token del comprador: el email lleva a la tienda, en su subdominio.
    expect(h.orderMail.filter((m) => m.kind === 'order-confirmation').at(-1)).toMatchObject({ to: CUSTOMER.email, url: STORE(), fromName: `Tienda ${slug}` });
    calls.length = 0;
    const f = await owner.call('POST', `/v1/stores/${store.storeId}/orders/${orderId}/refund`, {});
    expect(f.body.status).toBe('refunded');
    const refund = calls.find((c) => c.path === '/v1/refunds')!;
    expect(refund.body.get('payment_intent')).toBe(`pi_${RUN}`);
    expect(refund.body.get('reverse_transfer')).toBe('true');
    expect(refund.body.get('refund_application_fee')).toBe('true');
  });

  it('avisos de las cuentas conectadas: firma propia, actualizan el estado', async () => {
    const ev = (charges: boolean) => ({ id: `evt_${RUN}_acc_${charges}`, type: 'account.updated', account: accountId,
      data: { object: { id: accountId, charges_enabled: charges, details_submitted: true, payouts_enabled: charges } } });
    expect((await signed('/webhooks/stripe/connect', ev(false), WHSEC)).status).toBe(400);   // secreto de la plataforma, no el de Connect
    expect((await signed('/webhooks/stripe/connect', ev(false), CONNECT_WHSEC)).body).toEqual({ received: true, known: true });
    expect((await owner.call('GET', `/v1/stores/${store.storeId}/payments`)).body.ready).toBe(false);
    expect((await checkout()).body.detail).toBe('PAYMENTS_NOT_READY');
    await signed('/webhooks/stripe/connect', ev(true), CONNECT_WHSEC);
    expect((await owner.call('GET', `/v1/stores/${store.storeId}/payments`)).body.ready).toBe(true);
    const unknown = { ...ev(true), id: `evt_${RUN}_x`, data: { object: { id: 'acct_desconocida1', charges_enabled: true } } };
    expect((await signed('/webhooks/stripe/connect', unknown, CONNECT_WHSEC)).body).toEqual({ received: true, known: false });
  });

  it('al marcar como enviado se avisa al comprador por email', async () => {
    const r = await checkout();
    const session = (await adminQuery('SELECT payment_session_id FROM commerce.orders WHERE id = $1', [r.body.orderId]))[0].payment_session_id;
    await signed('/webhooks/stripe', { id: `evt_${RUN}_paid2`, type: 'checkout.session.completed', data: { object: { id: session, payment_status: 'paid',
      amount_total: r.body.order.total, currency: 'eur', payment_intent: `pi_${RUN}_2`, metadata: { order_id: r.body.orderId } } } }, WHSEC);
    expect((await staff.call('POST', `/v1/stores/${store.storeId}/orders/${r.body.orderId}/fulfill`, {})).status).toBe(200);
    const m = h.orderMail.find((x) => x.kind === 'order-shipped' && x.text?.includes(`#${r.body.order.number}`))!;
    expect(m).toMatchObject({ to: CUSTOMER.email, fromName: `Tienda ${slug}`, url: STORE() });
  });
});

describe('Subdominios', () => {
  it('el escaparate en su subdominio puede comprar; otros orígenes no', async () => {
    expect((await checkout(STORE())).status).toBe(201);
    expect((await checkout('http://malo.test:3000')).status).toBe(403);
    expect((await checkout(`http://${slug}.${DOMAIN}`)).status).toBe(403);        // puerto distinto del de la plataforma
    expect((await checkout(`http://${slug}.${DOMAIN}:8080`)).status).toBe(403);
    expect((await checkout(`http://a.b.${DOMAIN}:3000`)).status).toBe(403);
    expect((await checkout(`https://${slug}.${DOMAIN}:3000`)).status).toBe(403);  // esquema distinto
  });

  it('un subdominio de tienda no sirve para las rutas del panel', async () => {
    const r = await owner.call('PATCH', `/v1/stores/${store.storeId}/sales-settings`, { shippingFlatAmount: 1 }, { origin: STORE() });
    expect(r.status).toBe(403);
  });

  it('certificado bajo demanda: solo el dominio y las tiendas publicadas', async () => {
    const check = async (d: string) => (await h.app.inject({ method: 'GET', url: `/internal/tls-check?domain=${encodeURIComponent(d)}` })).statusCode;
    expect(await check(DOMAIN)).toBe(200);
    expect(await check(`www.${DOMAIN}`)).toBe(200);
    expect(await check(`${slug}.${DOMAIN}`)).toBe(200);
    expect(await check(`${slug.toUpperCase()}.${DOMAIN}`)).toBe(200);
    expect(await check(`cy-${RUN}.${DOMAIN}`)).toBe(404);    // existe pero no está publicada
    expect(await check(`no-existe-${RUN}.${DOMAIN}`)).toBe(404);
    expect(await check(`x.${slug}.${DOMAIN}`)).toBe(404);
    expect(await check(`${slug}.otro.test`)).toBe(404);
  });

  it('los nombres reservados de la plataforma no se pueden usar como tienda', async () => {
    const org = await owner.call('POST', '/v1/organizations', { name: 'Org reservada' });
    for (const s of ['www', 'admin', 'api']) {
      const r = await owner.call('POST', `/v1/organizations/${org.body.id}/stores`, { name: `Tienda ${s}`, slug: s, country: 'ES', currency: 'EUR',
        profile: { businessType: 'fashion', productKinds: 'physical', fulfillment: 'own-inventory', markets: ['ES'], shippingNeeds: 'domestic', technicalLevel: 'beginner', goals: ['first-sales'] } });
      expect(r.body).toEqual({ error: 'CONFLICT', detail: 'SLUG_RESERVED' });
    }
  });
});

describe('Diseño de la tienda', () => {
  it('el propietario cambia color, textos, logo y portada; se ven en la tienda pública', async () => {
    const d = await owner.call('PATCH', `/v1/stores/${store.storeId}/design`, { accentColor: '#E11D48', headline: 'Velas hechas a mano', tagline: 'Desde Bilbao' });
    expect(d.body).toMatchObject({ accentColor: '#e11d48', headline: 'Velas hechas a mano', tagline: 'Desde Bilbao', logo: null });
    const up = await h.app.inject({ method: 'POST', url: `/v1/stores/${store.storeId}/design/logo`,
      headers: { cookie: owner.cookie, 'content-type': 'image/png', origin: 'http://localhost:3000' }, payload: PNG });
    expect(up.statusCode).toBe(200);
    const logo = JSON.parse(up.body).logo as string;
    expect(logo).toMatch(new RegExp(`^${store.storeId}/[a-f0-9]{32}\\.png$`));
    const img = await h.app.inject({ method: 'GET', url: `/media/${logo}` });
    expect(img.statusCode).toBe(200);
    const pubStore = JSON.parse((await h.app.inject({ method: 'GET', url: `/public/stores/${slug}` })).body);
    expect(pubStore).toMatchObject({ accentColor: '#e11d48', headline: 'Velas hechas a mano', tagline: 'Desde Bilbao', logo, banner: null });
    // Cambiar el logo borra el fichero anterior.
    const up2 = await h.app.inject({ method: 'POST', url: `/v1/stores/${store.storeId}/design/logo`,
      headers: { cookie: owner.cookie, 'content-type': 'image/png', origin: 'http://localhost:3000' }, payload: PNG });
    expect(JSON.parse(up2.body).logo).not.toBe(logo);
    expect((await h.app.inject({ method: 'GET', url: `/media/${logo}` })).statusCode).toBe(404);
    const del = await owner.call('DELETE', `/v1/stores/${store.storeId}/design/logo`);
    expect(del.body.logo).toBeNull();
  });

  it('validación y permisos', async () => {
    expect((await owner.call('PATCH', `/v1/stores/${store.storeId}/design`, { accentColor: 'red' })).status).toBe(400);
    expect((await owner.call('PATCH', `/v1/stores/${store.storeId}/design`, { headline: 'x'.repeat(121) })).status).toBe(400);
    expect((await staff.call('PATCH', `/v1/stores/${store.storeId}/design`, { headline: 'Hola' })).status).toBe(403);
    const fake = await h.app.inject({ method: 'POST', url: `/v1/stores/${store.storeId}/design/banner`,
      headers: { cookie: owner.cookie, 'content-type': 'image/png', origin: 'http://localhost:3000' }, payload: Buffer.from('<svg onload=alert(1)>') });
    expect(JSON.parse(fake.body)).toMatchObject({ error: 'BAD_REQUEST', detail: 'UNSUPPORTED_IMAGE' });
    const noOrigin = await h.app.inject({ method: 'POST', url: `/v1/stores/${store.storeId}/design/banner`,
      headers: { cookie: owner.cookie, 'content-type': 'image/png' }, payload: PNG });
    expect(noOrigin.statusCode).toBe(403);
    expect((await owner.call('POST', `/v1/stores/${store.storeId}/design/favicon`, {})).status).toBeGreaterThanOrEqual(400);
  });
});

describe('Emails', () => {
  it('se envían por SMTP con el nombre de la tienda pero la dirección de la plataforma, y el HTML va escapado', async () => {
    const sent: { from: unknown; to: unknown; subject: string; html: string; text: string }[] = [];
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const orig = transport.sendMail.bind(transport);
    transport.sendMail = (async (m: any) => { sent.push(m); return orig(m); }) as typeof transport.sendMail;
    const mailer = createMailer({ transport, from: 'Plataforma <no-responder@plataforma.test>', log: () => {}, onError: () => {} });
    await mailer.send({ kind: 'order-confirmation', to: 'a@b.test', subject: 'Pedido #1', url: 'https://x.test/p?t=1&a=<b>', text: '1 × <script>', fromName: 'Tienda "Mala"\r\nBcc: x@y' });
    expect(sent[0]!.from).toEqual({ name: 'Tienda  Mala   Bcc: x@y', address: 'no-responder@plataforma.test' });
    expect(sent[0]!.html).toContain('&lt;script&gt;');
    expect(sent[0]!.html).not.toContain('<script>');
    expect(sent[0]!.html).toContain('href="https://x.test/p?t=1&amp;a=&lt;b&gt;"');
    await mailer.send({ kind: 'verify-email', to: 'a@b.test', subject: 'Verifica tu email', url: 'https://x.test/v' });
    expect(sent[1]!.from).toBe('Plataforma <no-responder@plataforma.test>');
    expect(renderMail({ kind: 'verify-email', to: 'a', subject: 's', url: 'https://u' }).text).toContain('Verificar mi email: https://u');
  });

  it('sin SMTP solo se registran; con SMTP hace falta remitente; un fallo de envío no rompe nada', async () => {
    const logged: string[] = [];
    const off = createMailer({ log: (m) => logged.push(m.kind), onError: () => {} });
    expect(off.enabled).toBe(false);
    await off.send({ kind: 'new-order', to: 'a@b.test', subject: 's', url: 'https://u' });
    expect(logged).toEqual(['new-order']);
    expect(() => createMailer({ smtpUrl: 'smtp://localhost:2525', log: () => {}, onError: () => {} })).toThrow(/MAIL_FROM/);
    const errors: unknown[] = [];
    const broken = createMailer({ smtpUrl: 'smtp://127.0.0.1:1', from: 'x@y.test', log: () => {}, onError: (e) => errors.push(e) });
    await expect(broken.send({ kind: 'new-order', to: 'a@b.test', subject: 's', url: 'https://u' })).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
