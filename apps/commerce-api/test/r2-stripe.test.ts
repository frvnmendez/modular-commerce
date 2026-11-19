/**
 * Pagos con Stripe (Hito 1): sesión de pago, avisos firmados, importes que no cuadran, pagos tardíos y reembolsos.
 * Stripe se sustituye por un servidor local que imita sus respuestas; la firma de los avisos es la real (HMAC).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import pg from 'pg';
import { createStore, makeApp, shutdown, signUp, type Client } from './harness.ts';
import { checkoutLineItems, signStripePayload, stripeForm, verifyStripeSignature } from '../src/payments.ts';

const WHSEC = 'whsec_test_secret';
const calls: { path: string; body: URLSearchParams; idem: string | undefined }[] = [];
let mock: Server;
let mockSeq = 0;
const RUN = Date.now().toString(36);
let h: ReturnType<typeof makeApp>;
let owner: Client;
let store: { storeId: string };
let slug: string;
let variantId: string;

const pub = async (url: string, body: unknown) => {
  const r = await h.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, payload: JSON.stringify(body) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const webhook = async (event: unknown, secret = WHSEC, t?: number) => {
  const raw = JSON.stringify(event);
  const r = await h.app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(raw, secret, t) }, payload: raw });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const CUSTOMER = { email: 'c@example.com', name: 'Cliente', address: { line1: 'Calle 1', city: 'Sevilla', postalCode: '41001' } };
async function adminQuery(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL!.replace(/\/[^/]*$/, `/${process.env.DATABASE_NAME ?? 'modular_commerce'}`) });
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}
let seq = 0;
async function checkout(qty = 1) {
  const r = await pub(`/public/stores/${slug}/checkout`, { lines: [{ variantId, quantity: qty }], customer: CUSTOMER });
  expect({ status: r.status, detail: r.body.detail }).toEqual({ status: 201, detail: undefined });
  return r.body as { orderId: string; redirectUrl: string; order: { total: number } };
}
const sessionOf = async (orderId: string) => (await adminQuery('SELECT payment_session_id FROM commerce.orders WHERE id = $1', [orderId]))[0].payment_session_id as string;
const completed = (orderId: string, session: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id: `evt_${RUN}_${++seq}`, type: 'checkout.session.completed',
  data: { object: { id: session, payment_status: 'paid', amount_total: amount, currency: 'eur', payment_intent: `pi_${orderId.slice(0, 8)}`, metadata: { order_id: orderId }, ...extra } },
});

beforeAll(async () => {
  mock = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      calls.push({ path: req.url!, body: new URLSearchParams(data), idem: req.headers['idempotency-key'] as string | undefined });
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== 'Bearer sk_test_mock') { res.statusCode = 401; return res.end('{"error":{"message":"bad key"}}'); }
      if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: `cs_test_${RUN}_${++mockSeq}`, url: `https://checkout.stripe.test/c/${mockSeq}` }));
      if (req.url === '/v1/refunds') return res.end(JSON.stringify({ id: `re_${++mockSeq}`, status: 'succeeded' }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  const port = (mock.address() as { port: number }).port;
  h = makeApp({ payments: { provider: 'stripe', secretKey: 'sk_test_mock', webhookSecret: WHSEC, apiBase: `http://127.0.0.1:${port}` } });
  await h.app.ready();
  owner = await signUp(h, 'StripeOwner');
  slug = `st-${Date.now().toString(36)}`;
  store = await createStore(owner, slug);
  await owner.call('PATCH', `/v1/stores/${store.storeId}/sales-settings`, { storefrontPublished: true, shippingFlatAmount: 300, taxRateBp: 2100 });
  const p = await owner.call('POST', `/v1/stores/${store.storeId}/products`, { title: 'Taza', status: 'active', variants: [{ title: 'Blanca', price: 1250, stock: 10 }] });
  variantId = p.body.variants[0].id;
});
afterAll(async () => { await shutdown(h.app); await new Promise((r) => mock.close(r)); });

describe('Utilidades de Stripe', () => {
  it('codifica formularios anidados como Stripe', () => {
    expect(stripeForm({ a: 1, b: { c: 'x y' }, d: [{ e: 2 }], m: { k: undefined } })).toEqual(['a=1', 'b%5Bc%5D=x%20y', 'd%5B0%5D%5Be%5D=2']);
  });
  it('las líneas de pago suman exactamente el total, o falla', () => {
    const o = { orderId: 'x', number: 1, currency: 'EUR', email: 'a@b.c', storeName: 'S', total: 2800, shippingTotal: 300, taxTotal: 486, pricesIncludeTax: true,
      lines: [{ productTitle: 'Taza', variantTitle: 'Blanca', unitPrice: 1250, quantity: 2 }] };
    expect(checkoutLineItems(o).map((i) => i.price_data.unit_amount * i.quantity)).toEqual([2500, 300]);
    expect(() => checkoutLineItems({ ...o, total: 2799 })).toThrow();
  });
  it('rechaza firmas falsas, alteradas o antiguas', () => {
    const raw = Buffer.from('{"id":"evt_1"}');
    const now = Date.now();
    expect(verifyStripeSignature(raw, signStripePayload(raw.toString(), WHSEC), WHSEC)).toMatchObject({ id: 'evt_1' });
    expect(verifyStripeSignature(raw, signStripePayload(raw.toString(), 'whsec_otro'), WHSEC)).toBeNull();
    expect(verifyStripeSignature(Buffer.from('{"id":"evt_2"}'), signStripePayload(raw.toString(), WHSEC), WHSEC)).toBeNull();
    expect(verifyStripeSignature(raw, signStripePayload(raw.toString(), WHSEC, Math.floor(now / 1000) - 600), WHSEC, now)).toBeNull();
    expect(verifyStripeSignature(raw, undefined, WHSEC)).toBeNull();
    expect(verifyStripeSignature(raw, 't=1,v1=zz', WHSEC)).toBeNull();
  });
});

describe('Compra con Stripe', () => {
  it('crea la sesión de pago con los importes de la BD y redirige a Stripe', async () => {
    calls.length = 0;
    const r = await checkout(2);
    expect(r.redirectUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const s = calls.find((c) => c.path === '/v1/checkout/sessions')!;
    expect(s.idem).toBe(`checkout-${r.orderId}`);
    expect(s.body.get('line_items[0][price_data][unit_amount]')).toBe('1250');
    expect(s.body.get('line_items[0][quantity]')).toBe('2');
    expect(s.body.get('line_items[1][price_data][unit_amount]')).toBe('300');
    expect(s.body.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(s.body.get('metadata[order_id]')).toBe(r.orderId);
    expect(s.body.get('success_url')).toContain(`/tienda/${slug}/pedido/${r.orderId}?t=`);
    expect(Number(s.body.get('expires_at')) - Date.now() / 1000).toBeGreaterThan(30 * 60);
    expect(await sessionOf(r.orderId)).toMatch(/^cs_test_/);
  });

  it('un aviso sin firma válida no cambia nada', async () => {
    const r = await checkout();
    const s = await sessionOf(r.orderId);
    expect((await webhook(completed(r.orderId, s, r.order.total), 'whsec_falso')).status).toBe(400);
    const raw = JSON.stringify(completed(r.orderId, s, r.order.total));
    const noSig = await h.app.inject({ method: 'POST', url: '/webhooks/stripe', headers: { 'content-type': 'application/json' }, payload: raw });
    expect(noSig.statusCode).toBe(400);
    expect((await owner.call('GET', `/v1/stores/${store.storeId}/orders/${r.orderId}`)).body.status).toBe('pending');
  });

  it('un aviso con otro importe, otra moneda u otra sesión no marca el pedido como pagado', async () => {
    const r = await checkout();
    const s = await sessionOf(r.orderId);
    expect((await webhook(completed(r.orderId, s, r.order.total - 1))).body.result).toBe('mismatch');
    expect((await webhook(completed(r.orderId, s, r.order.total, { currency: 'usd' }))).body.result).toBe('mismatch');
    expect((await webhook(completed(r.orderId, 'cs_test_otra', r.order.total))).body.result).toBe('mismatch');
    expect((await owner.call('GET', `/v1/stores/${store.storeId}/orders/${r.orderId}`)).body.status).toBe('pending');
  });

  it('un aviso correcto marca el pedido como pagado una sola vez y envía los emails', async () => {
    const r = await checkout();
    const s = await sessionOf(r.orderId);
    const ev = completed(r.orderId, s, r.order.total);
    expect((await webhook(ev)).body.result).toBe('paid');
    expect((await webhook(ev)).body.result).toBe('duplicate');
    expect((await webhook({ ...ev, id: `evt_${RUN}_${++seq}` })).body.result).toBe('duplicate');
    const o = (await owner.call('GET', `/v1/stores/${store.storeId}/orders/${r.orderId}`)).body;
    expect(o.status).toBe('paid');
    expect(o.paymentEvents.map((e: { result: string }) => e.result)).toEqual(['paid', 'duplicate']);
    expect(h.orderMail.filter((m) => m.kind === 'order-confirmation' && m.subject.includes(`#${o.number}`))).toHaveLength(1);
  });

  it('una sesión caducada cancela el pedido y devuelve el stock', async () => {
    const r = await checkout(3);
    const s = await sessionOf(r.orderId);
    const before = (await adminQuery('SELECT on_hand FROM commerce.inventory_levels WHERE variant_id = $1', [variantId]))[0].on_hand;
    const e = await webhook({ id: `evt_${RUN}_${++seq}`, type: 'checkout.session.expired', data: { object: { id: s, metadata: { order_id: r.orderId } } } });
    expect(e.body.result).toBe('cancelled');
    const after = (await adminQuery('SELECT on_hand FROM commerce.inventory_levels WHERE variant_id = $1', [variantId]))[0].on_hand;
    expect(after).toBe(before + 3);
  });

  it('un pago que llega tras caducar la reserva se reembolsa automáticamente', async () => {
    const r = await checkout();
    const s = await sessionOf(r.orderId);
    await adminQuery(`UPDATE commerce.orders SET checkout_expires_at = now() - interval '1 minute' WHERE id = $1`, [r.orderId]);
    await adminQuery('SELECT payments.expire_overdue()');
    calls.length = 0;
    expect((await webhook(completed(r.orderId, s, r.order.total))).body.result).toBe('late');
    expect(calls.map((c) => c.path)).toEqual(['/v1/refunds']);
    expect(calls[0]!.body.get('payment_intent')).toBe(`pi_${r.orderId.slice(0, 8)}`);
    expect((await owner.call('GET', `/v1/stores/${store.storeId}/orders/${r.orderId}`)).body.status).toBe('cancelled');
  });

  it('reembolsar desde el panel llama a Stripe con clave de idempotencia y marca el pedido', async () => {
    const r = await checkout();
    const s = await sessionOf(r.orderId);
    await webhook(completed(r.orderId, s, r.order.total));
    calls.length = 0;
    const ref = await owner.call('POST', `/v1/stores/${store.storeId}/orders/${r.orderId}/refund`, {});
    expect(ref.status).toBe(200);
    expect(ref.body.status).toBe('refunded');
    expect(calls).toEqual([expect.objectContaining({ path: '/v1/refunds', idem: `refund-${r.orderId}` })]);
  });

  it('si Stripe no responde, la compra falla con 502 y la reserva queda para caducar', async () => {
    const bad = makeApp({ payments: { provider: 'stripe', secretKey: 'sk_test_otra', webhookSecret: WHSEC, apiBase: `http://127.0.0.1:${(mock.address() as { port: number }).port}` } });
    await bad.app.ready();
    const r = await bad.app.inject({ method: 'POST', url: `/public/stores/${slug}/checkout`, headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      payload: JSON.stringify({ lines: [{ variantId, quantity: 1 }], customer: CUSTOMER }) });
    expect(r.statusCode).toBe(502);
    await bad.app.close();
  });
});
