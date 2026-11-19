/**
 * Hito 1 de la R2: catálogo → escaparate → compra → pago → pedido en el panel.
 * Con el proveedor de pagos simulado («fake»); los avisos de Stripe se prueban en r2-stripe.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { withStore } from '@mc/db';
import { createStore, makeApp, shutdown, signUp, type Client } from './harness.ts';
import { expireOverdueCheckouts, rateLimiter } from '../src/storefront.ts';

const h = makeApp();
let owner: Client;
let staff: Client;
let store: { orgId: string; storeId: string };
let slug: string;
let product: { id: string; handle: string; variants: { id: string; title: string; price: number; stock: number }[] };

const pub = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await h.app.inject({
    method: method as 'GET', url,
    headers: { origin: 'http://localhost:3000', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, headers: r.headers };
};
const CUSTOMER = { email: 'Comprador@Example.com', name: 'Laura Compradora', address: { line1: 'Calle Mayor 1', city: 'Madrid', postalCode: '28013' } };
const admin = () => new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL!.replace(/\/[^/]*$/, `/${process.env.DATABASE_NAME ?? 'modular_commerce'}`) });
async function adminQuery(sql: string, params: unknown[] = []) {
  const c = admin(); await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}
const tokenFrom = (url: string) => new URL(url).searchParams.get('t')!;

beforeAll(async () => {
  await h.app.ready();
  owner = await signUp(h, 'R2Owner');
  slug = `r2-${Date.now().toString(36)}`;
  store = await createStore(owner, slug);
  staff = await signUp(h, 'R2Staff');
  const inv = await owner.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: staff.email, role: 'staff' });
  await staff.call('POST', '/v1/invitations/accept', { token: inv.body.token });
});
afterAll(async () => { await shutdown(h.app); });

describe('Catálogo en el panel', () => {
  it('crea un producto con variantes y stock; el identificador de URL se genera solo', async () => {
    const r = await owner.call('POST', `/v1/stores/${store.storeId}/products`, {
      title: 'Camiseta Ñandú', description: 'Algodón orgánico.', status: 'active',
      variants: [{ title: 'S', price: 1999, stock: 3 }, { title: 'M', price: 1999, compareAt: 2499, stock: 1, sku: 'CAM-M' }],
    });
    expect(r.status).toBe(201);
    expect(r.body.handle).toBe('camiseta-nandu');
    expect(r.body.variants.map((v: { stock: number }) => v.stock)).toEqual([3, 1]);
    product = r.body;
    const again = await owner.call('POST', `/v1/stores/${store.storeId}/products`, { title: 'Camiseta Ñandú', variants: [{ title: 'Única', price: 100, stock: 0 }] });
    expect(again.body.handle).toBe('camiseta-nandu-2');
  });

  it('el staff puede editar el catálogo pero no los ajustes de venta', async () => {
    const list = await staff.call('GET', `/v1/stores/${store.storeId}/products`);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(2);
    const draft = await staff.call('POST', `/v1/stores/${store.storeId}/products`, { title: 'Borrador', status: 'draft', variants: [{ title: 'Única', price: 500, stock: 5 }] });
    expect(draft.status).toBe(201);
    expect((await staff.call('PATCH', `/v1/stores/${store.storeId}/sales-settings`, { storefrontPublished: true })).status).toBe(403);
  });

  it('valida precios: «antes» debe ser mayor que el precio; nada de decimales ni negativos', async () => {
    const base = { title: 'Mal', variants: [{ title: 'X', price: 1000, compareAt: 900, stock: 1 }] };
    expect((await owner.call('POST', `/v1/stores/${store.storeId}/products`, base)).status).toBe(400);
    expect((await owner.call('POST', `/v1/stores/${store.storeId}/products`, { ...base, variants: [{ title: 'X', price: 10.5, stock: 1 }] })).status).toBe(400);
    expect((await owner.call('POST', `/v1/stores/${store.storeId}/products`, { ...base, variants: [{ title: 'X', price: -1, stock: 1 }] })).status).toBe(400);
  });

  it('la moneda de la tienda queda bloqueada cuando hay productos', async () => {
    const r = await owner.call('PATCH', `/v1/stores/${store.storeId}`, { currency: 'USD' });
    expect(r.status).toBe(409);
    expect(r.body.detail).toBe('CURRENCY_LOCKED');
  });
});

describe('Escaparate público', () => {
  it('una tienda sin publicar no existe para el público', async () => {
    expect((await pub('GET', `/public/stores/${slug}`)).status).toBe(404);
    expect((await pub('GET', `/public/stores/${slug}/products`)).status).toBe(404);
  });

  it('al publicarla muestra solo productos activos, con precios en céntimos y sin stock exacto', async () => {
    expect((await owner.call('PATCH', `/v1/stores/${store.storeId}/sales-settings`, {
      storefrontPublished: true, shippingFlatAmount: 495, freeShippingThreshold: 5000, contactEmail: 'tienda@example.com', taxRateBp: 2100, pricesIncludeTax: true,
    })).status).toBe(200);
    const s = await pub('GET', `/public/stores/${slug}`);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ name: `Tienda ${slug}`, currency: 'EUR', shippingFlatAmount: 495, freeShippingThreshold: 5000 });
    const list = await pub('GET', `/public/stores/${slug}/products`);
    expect(list.body.items.map((p: { handle: string }) => p.handle)).toEqual(['camiseta-nandu']);   // los borradores no salen
    expect(list.body.items.find((p: { handle: string }) => p.handle === 'camiseta-nandu')).toMatchObject({ priceFrom: 1999, available: true });
    const d = await pub('GET', `/public/stores/${slug}/products/camiseta-nandu`);
    expect(d.body.variants).toEqual([
      expect.objectContaining({ title: 'S', price: 1999, compareAt: null, available: 3 }),
      expect.objectContaining({ title: 'M', price: 1999, compareAt: 2499, available: 1 }),
    ]);
    expect((await pub('GET', `/public/stores/${slug}/products/borrador`)).status).toBe(404);
  });
});

describe('Compra con pago simulado', () => {
  let orderId: string; let token: string;

  it('el carrito no acepta precios: solo variantes y cantidades', async () => {
    const r = await pub('POST', `/public/stores/${slug}/checkout`, { lines: [{ variantId: product.variants[0]!.id, quantity: 1, price: 1 }], customer: CUSTOMER });
    expect(r.status).toBe(400);
  });

  it('crea un pedido pendiente, reserva stock y calcula los importes en la BD', async () => {
    const r = await pub('POST', `/public/stores/${slug}/checkout`, { lines: [{ variantId: product.variants[0]!.id, quantity: 2 }], customer: CUSTOMER });
    expect(r.status).toBe(201);
    orderId = r.body.orderId; token = tokenFrom(r.body.redirectUrl);
    // 2 × 19,99 = 39,98 + envío 4,95 (no llega a 50 €) = 44,93; IVA incluido 21 %: 44,93 − 44,93/1,21 = 7,80
    expect(r.body.order).toMatchObject({ number: 1, status: 'pending', subtotal: 3998, shippingTotal: 495, total: 4493, taxTotal: 780, email: 'comprador@example.com' });
    const d = await pub('GET', `/public/stores/${slug}/products/camiseta-nandu`);
    expect(d.body.variants[0].available).toBe(1);
  });

  it('el resumen del pedido exige el token del enlace', async () => {
    expect((await pub('GET', `/public/stores/${slug}/orders/${orderId}?t=${token}`)).status).toBe(200);
    expect((await pub('GET', `/public/stores/${slug}/orders/${orderId}?t=${'x'.repeat(32)}`)).status).toBe(404);
    expect((await pub('GET', `/public/stores/otra-tienda/orders/${orderId}?t=${token}`)).status).toBe(404);
  });

  it('sin stock suficiente o con más de 20 unidades, no hay pedido', async () => {
    const r = await pub('POST', `/public/stores/${slug}/checkout`, { lines: [{ variantId: product.variants[1]!.id, quantity: 2 }], customer: CUSTOMER });
    expect(r.status).toBe(409);
    expect(r.body.detail).toBe('OUT_OF_STOCK');
    expect((await pub('POST', `/public/stores/${slug}/checkout`, { lines: [{ variantId: product.variants[1]!.id, quantity: 21 }], customer: CUSTOMER })).status).toBe(400);
    const dup = await pub('POST', `/public/stores/${slug}/checkout`, { lines: Array(11).fill({ variantId: product.variants[1]!.id, quantity: 2 }), customer: CUSTOMER });
    expect(dup.status).toBe(409);
    expect(dup.body.detail).toBe('QUANTITY_LIMIT');
  });

  it('los pedidos pendientes aparecen en el panel; nadie puede marcarlos pagados a mano', async () => {
    const list = await owner.call('GET', `/v1/stores/${store.storeId}/orders`);
    expect(list.body.items[0]).toMatchObject({ number: 1, status: 'pending', total: 4493, customerName: 'Laura Compradora' });
    expect((await owner.call('POST', `/v1/stores/${store.storeId}/orders/${orderId}/fulfill`, {})).status).toBe(409);
    await expect(withStore(owner.token, store.storeId, (c) => c.query(`UPDATE commerce.orders SET status = 'paid' WHERE id = $1`, [orderId])))
      .rejects.toThrow('PAYMENT_REQUIRED');
  });

  it('el pago simulado confirma el pedido una sola vez y avisa por email', async () => {
    const r = await pub('POST', `/public/stores/${slug}/orders/${orderId}/simulate-payment`, { t: token });
    expect(r.status).toBe(200);
    expect(r.body.result).toBe('paid');
    expect((await pub('POST', `/public/stores/${slug}/orders/${orderId}/simulate-payment`, { t: token })).body.result).toBe('duplicate');
    expect((await pub('POST', `/public/stores/${slug}/orders/${orderId}/simulate-payment`, { t: 'y'.repeat(32) })).status).toBe(404);
    expect(h.orderMail.filter((m) => m.kind === 'order-confirmation' && m.to === 'comprador@example.com')).toHaveLength(1);
    expect(h.orderMail.filter((m) => m.kind === 'new-order' && m.to === 'tienda@example.com')).toHaveLength(1);
    const summary = await pub('GET', `/public/stores/${slug}/orders/${orderId}?t=${token}`);
    expect(summary.body.status).toBe('paid');
  });

  it('el staff marca como enviado pero no puede reembolsar; el propietario sí', async () => {
    expect((await staff.call('POST', `/v1/stores/${store.storeId}/orders/${orderId}/refund`, {})).status).toBe(403);
    const f = await staff.call('POST', `/v1/stores/${store.storeId}/orders/${orderId}/fulfill`, {});
    expect(f.status).toBe(200);
    expect(f.body.status).toBe('fulfilled');
    expect(f.body.lines).toEqual([expect.objectContaining({ productTitle: 'Camiseta Ñandú', variantTitle: 'S', quantity: 2, unitPrice: 1999, lineTotal: 3998 })]);
    const r = await owner.call('POST', `/v1/stores/${store.storeId}/orders/${orderId}/refund`, {});
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('refunded');
  });

  it('un producto con pedidos no se puede borrar (se archiva)', async () => {
    const r = await owner.call('DELETE', `/v1/stores/${store.storeId}/products/${product.id}`);
    expect(r.status).toBe(409);
  });
});

describe('Reservas que caducan', () => {
  it('un pedido sin pagar caduca, se cancela y devuelve el stock', async () => {
    const before = (await pub('GET', `/public/stores/${slug}/products/camiseta-nandu`)).body.variants[1].available;
    const r = await pub('POST', `/public/stores/${slug}/checkout`, { lines: [{ variantId: product.variants[1]!.id, quantity: 1 }], customer: CUSTOMER });
    expect(r.status).toBe(201);
    expect((await pub('GET', `/public/stores/${slug}/products/camiseta-nandu`)).body.variants[1].available).toBe(before - 1);
    await adminQuery(`UPDATE commerce.orders SET checkout_expires_at = now() - interval '1 minute' WHERE id = $1`, [r.body.orderId]);
    expect(await expireOverdueCheckouts()).toBeGreaterThanOrEqual(1);
    expect((await pub('GET', `/public/stores/${slug}/products/camiseta-nandu`)).body.variants[1].available).toBe(before);
    const o = await owner.call('GET', `/v1/stores/${store.storeId}/orders/${r.body.orderId}`);
    expect(o.body.status).toBe('cancelled');
    // Pagar después de caducar no revive el pedido.
    const late = await pub('POST', `/public/stores/${slug}/orders/${r.body.orderId}/simulate-payment`, { t: tokenFrom(r.body.redirectUrl) });
    expect(late.body.result).toBe('late');
  });

  it('el propietario puede cancelar un pedido sin pagar; el staff no', async () => {
    const r = await pub('POST', `/public/stores/${slug}/checkout`, { lines: [{ variantId: product.variants[0]!.id, quantity: 1 }], customer: CUSTOMER });
    expect((await staff.call('POST', `/v1/stores/${store.storeId}/orders/${r.body.orderId}/cancel`, {})).status).toBe(403);
    const c = await owner.call('POST', `/v1/stores/${store.storeId}/orders/${r.body.orderId}/cancel`, {});
    expect(c.body.status).toBe('cancelled');
  });
});

describe('Barreras en la BD aunque se use mc_app directamente', () => {
  it('mc_app no puede crear pedidos, cambiar importes ni tocar datos de pago', async () => {
    const [o] = await adminQuery(`SELECT id FROM commerce.orders WHERE tenant_id = $1 LIMIT 1`, [store.storeId]);
    await expect(withStore(owner.token, store.storeId, (c) => c.query(`UPDATE commerce.orders SET total = 1 WHERE id = $1`, [o.id]))).rejects.toThrow(/permission denied/);
    await expect(withStore(owner.token, store.storeId, (c) => c.query(`UPDATE commerce.orders SET payment_intent_id = 'x' WHERE id = $1`, [o.id]))).rejects.toThrow(/permission denied/);
    await expect(withStore(owner.token, store.storeId, (c) => c.query(`INSERT INTO commerce.order_counters (tenant_id) VALUES ($1)`, [store.storeId]))).rejects.toThrow(/permission denied/);
    await expect(withStore(owner.token, store.storeId, (c) => c.query(`DELETE FROM commerce.orders WHERE id = $1`, [o.id]))).rejects.toThrow(/permission denied/);
  });

  it('el staff no puede cambiar el IVA aunque escriba directamente en la tabla', async () => {
    await expect(withStore(staff.token, store.storeId, (c) => c.query(`UPDATE commerce.tax_rates SET rate_bp = 0`))).resolves.toMatchObject({ rowCount: 0 });
    const [t] = await adminQuery('SELECT rate_bp FROM commerce.tax_rates WHERE tenant_id = $1', [store.storeId]);
    expect(t.rate_bp).toBe(2100);
  });

  it('mc_storefront y mc_payments no pueden leer tablas', async () => {
    for (const [user, pw] of [['mc_storefront', process.env.DATABASE_STOREFRONT_PASSWORD], ['mc_payments', process.env.DATABASE_PAYMENTS_PASSWORD]]) {
      const c = new pg.Client({ host: process.env.DATABASE_HOST ?? '127.0.0.1', database: process.env.DATABASE_NAME ?? 'modular_commerce', user, password: pw });
      await c.connect();
      try {
        for (const t of ['commerce.orders', 'commerce.customers', 'commerce.products', 'control.stores', 'auth."user"']) {
          await expect(c.query(`SELECT 1 FROM ${t} LIMIT 1`)).rejects.toThrow(/permission denied/);
        }
      } finally { await c.end(); }
    }
    await expect((async () => {
      const c = new pg.Client({ host: process.env.DATABASE_HOST ?? '127.0.0.1', database: process.env.DATABASE_NAME ?? 'modular_commerce', user: 'mc_storefront', password: process.env.DATABASE_STOREFRONT_PASSWORD });
      await c.connect();
      try { await c.query(`SELECT payments.mark_paid(gen_random_uuid(), 'fake', 'x', 'x', 1, 'EUR', 'x')`); } finally { await c.end(); }
    })()).rejects.toThrow(/permission denied/);
  });
});

describe('Imágenes de producto', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const up = (body: Buffer, type: string, origin: string | null = 'http://localhost:3000') => h.app.inject({
    method: 'POST', url: `/v1/stores/${store.storeId}/products/${product.id}/images`,
    headers: { cookie: owner.cookie, 'content-type': type, ...(origin ? { origin } : {}) }, payload: body,
  });

  it('sube una imagen válida y se sirve en /media con caché larga', async () => {
    const r = await up(PNG, 'image/png');
    expect(r.statusCode).toBe(201);
    const { path } = JSON.parse(r.body);
    const m = await h.app.inject({ method: 'GET', url: `/media/${path}` });
    expect(m.statusCode).toBe(200);
    expect(m.headers['content-type']).toBe('image/png');
    expect(m.headers['cache-control']).toContain('immutable');
    expect(m.rawPayload.equals(PNG)).toBe(true);
    const list = await pub('GET', `/public/stores/${slug}/products`);
    expect(list.body.items.find((p: { handle: string }) => p.handle === 'camiseta-nandu').image).toBe(path);
  });

  it('rechaza ficheros que no son imágenes aunque digan serlo, y subidas sin Origin', async () => {
    expect((await up(Buffer.from('<svg onload=alert(1)>'), 'image/png')).statusCode).toBe(400);
    expect((await up(PNG, 'image/svg+xml')).statusCode).toBe(415);
    expect((await up(PNG, 'image/png', null)).statusCode).toBe(403);
    expect((await up(PNG, 'image/png', 'https://evil.example')).statusCode).toBe(403);
  });

  it('/media no permite salir de la carpeta ni leer ficheros con otro nombre', async () => {
    for (const u of [`/media/${store.storeId}/..%2F..%2Fetc%2Fpasswd`, `/media/../../etc/passwd`, `/media/${store.storeId}/x.svg`]) {
      expect((await h.app.inject({ method: 'GET', url: u })).statusCode).toBe(404);
    }
  });
});

describe('Límite de compras por IP', () => {
  it('rateLimiter corta al superar el máximo y se recupera al pasar la ventana', () => {
    const lim = rateLimiter(2, 1000);
    expect([lim('a', 0), lim('a', 10), lim('a', 20), lim('b', 20)]).toEqual([true, true, false, true]);
    expect(lim('a', 1500)).toBe(true);
  });

  it('la ruta de compra responde 429 al superar el límite', async () => {
    const h2 = makeApp({ checkoutRateLimit: 2 });
    await h2.app.ready();
    const call = () => h2.app.inject({ method: 'POST', url: `/public/stores/${slug}/checkout`, headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, payload: '{}' });
    expect([(await call()).statusCode, (await call()).statusCode, (await call()).statusCode]).toEqual([400, 400, 429]);
    await h2.app.close();
  });
});
