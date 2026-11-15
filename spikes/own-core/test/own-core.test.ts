/**
 * SPIKE ADR-0001 — prototipo del núcleo propio sobre la base de R1.
 * Flujo funcional (catálogo → cliente → pedido → estados), aislamiento entre tiendas por API y con mc_app directo,
 * concurrencia sobre la última unidad de stock e invariantes de la BD.
 * Ejecutar también con SPIKE_SABOTAGE=rls-off|role-off|guard-off: la suite DEBE fallar (negative-controls.mjs).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { adminClient, dropDatabase, freshDatabase } from '../../../tests/isolation/test/fresh-db.ts';

type Client = import('@mc/commerce-api/testing').Client;
let h: ReturnType<typeof import('@mc/commerce-api/testing').makeApp>;
let db: typeof import('@mc/db');
let dbName: string;
const A = {} as { owner: Client; staff: Client; storeId: string; productId: string; variantId: string; variant2Id: string; customerId: string; orderId: string };
const B = {} as typeof A;
const SPIKE_TABLES = ['products', 'product_variants', 'inventory_levels', 'tax_rates', 'customers', 'order_counters', 'orders', 'order_lines'];

async function applySpikeSql() {
  const { connectionFor } = await import('@mc/db');
  const c = new pg.Client(connectionFor('migrator'));
  await c.connect();
  try { await c.query(await readFile(new URL('../sql/0100_spike_commerce_core.sql', import.meta.url), 'utf8')); } finally { await c.end(); }
}

async function sabotage(mode: string | undefined) {
  if (!mode) return;
  const c = adminClient();
  await c.connect();
  try {
    if (mode === 'rls-off') for (const t of SPIKE_TABLES) await c.query(`ALTER TABLE commerce.${t} DISABLE ROW LEVEL SECURITY`);
    else if (mode === 'role-off') {
      const pols = (await c.query(`SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'commerce' AND permissive = 'RESTRICTIVE' AND tablename = ANY($1)`, [SPIKE_TABLES])).rows;
      for (const p of pols) await c.query(`DROP POLICY ${p.policyname} ON commerce.${p.tablename}`);
    } else if (mode === 'guard-off') {
      await c.query('DROP TRIGGER orders_transition ON commerce.orders');
      await c.query('DROP TRIGGER orders_totals ON commerce.orders');
      await c.query('DROP TRIGGER order_lines_totals ON commerce.order_lines');
    } else throw new Error(`sabotaje desconocido: ${mode}`);
  } finally { await c.end(); }
}

/** Huella completa de los datos de comercio de una tienda, leída como superusuario. */
async function snapshot(storeId: string) {
  const c = adminClient();
  await c.connect();
  try {
    const parts = [];
    for (const t of SPIKE_TABLES) parts.push((await c.query(`SELECT to_jsonb(x) - 'updated_at' AS r FROM commerce.${t} x WHERE tenant_id = $1 ORDER BY 1::text`, [storeId])).rows);
    return JSON.stringify(parts);
  } finally { await c.end(); }
}

const product = (tag: string, stock = 5) => ({
  title: `Camiseta ${tag}`, handle: `camiseta-${tag}`, status: 'active',
  variants: [{ sku: `CAM-${tag}-M`, title: 'Talla M', priceAmount: 1999, stock }, { sku: `CAM-${tag}-L`, title: 'Talla L', priceAmount: 2499, stock: 1 }],
});

beforeAll(async () => {
  dbName = await freshDatabase();
  await applySpikeSql();
  await sabotage(process.env.SPIKE_SABOTAGE);
  const t = await import('@mc/commerce-api/testing');
  const { spikeCommerceRoutes } = await import('../src/routes.ts');
  db = await import('@mc/db');
  h = t.makeApp();
  await h.app.register(spikeCommerceRoutes);
  await h.app.ready();
  for (const [T, tag] of [[A, 'a'], [B, 'b']] as const) {
    T.owner = await t.signUp(h, `Owner${tag}`);
    T.storeId = (await t.createStore(T.owner, `spk-${tag}-${Date.now().toString(36)}`)).storeId;
    T.staff = await t.signUp(h, `Staff${tag}`);
    const inv = await T.owner.call('POST', `/v1/stores/${T.storeId}/invitations`, { email: T.staff.email, role: 'staff' });
    await T.staff.call('POST', '/v1/invitations/accept', { token: inv.body.token });
    await T.owner.call('PUT', `/v1/stores/${T.storeId}/tax-rates/ES`, { rateBp: 2100, pricesIncludeTax: true });
    const p = await T.owner.call('POST', `/v1/stores/${T.storeId}/products`, product(tag));
    if (p.status !== 201) throw new Error(`producto ${p.status} ${JSON.stringify(p.body)}`);
    T.productId = p.body.id;
    T.variantId = p.body.variants.find((v: { sku: string }) => v.sku.endsWith('-M')).id;
    T.variant2Id = p.body.variants.find((v: { sku: string }) => v.sku.endsWith('-L')).id;
    // Mismo email en las dos tiendas: deben ser dos clientes distintos.
    const cu = await T.owner.call('POST', `/v1/stores/${T.storeId}/customers`, { email: 'maria@cliente.test', name: `María ${tag}`, address: { line1: `Calle privada de ${tag}`, city: 'Madrid', country: 'ES' } });
    T.customerId = cu.body.id;
    const o = await T.staff.call('POST', `/v1/stores/${T.storeId}/orders`, { customerId: T.customerId, shipCountry: 'ES', lines: [{ variantId: T.variantId, quantity: 2 }] });
    if (o.status !== 201) throw new Error(`pedido ${o.status} ${JSON.stringify(o.body)}`);
    T.orderId = o.body.id;
  }
});

afterAll(async () => {
  const t = await import('@mc/commerce-api/testing');
  if (h) await t.shutdown(h.app);
  await dropDatabase(dbName);
});

describe('Flujo funcional', () => {
  it('producto con variantes, stock e importes en céntimos', async () => {
    const r = await A.staff.call('GET', `/v1/stores/${A.storeId}/products/${A.productId}`);
    expect(r.status).toBe(200);
    expect(r.body.variants).toEqual([
      expect.objectContaining({ sku: 'CAM-a-L', priceAmount: 2499, currency: 'EUR', stock: 1 }),
      expect.objectContaining({ sku: 'CAM-a-M', priceAmount: 1999, currency: 'EUR', stock: 3 }),
    ]);
  });
  it('pedido: número por tienda, IVA incluido, líneas copiadas y stock descontado', async () => {
    const o = (await A.owner.call('GET', `/v1/stores/${A.storeId}/orders/${A.orderId}`)).body;
    expect(o).toMatchObject({ number: 1, status: 'pending', currency: 'EUR', subtotal: 3998, taxTotal: 694, total: 3998 });
    expect(o.lines).toEqual([expect.objectContaining({ sku: 'CAM-a-M', unitPrice: 1999, quantity: 2, lineTotal: 3998 })]);
    // La tienda B también tiene su pedido número 1: la numeración no se comparte.
    expect((await B.owner.call('GET', `/v1/stores/${B.storeId}/orders/${B.orderId}`)).body.number).toBe(1);
  });
  it('cambiar el precio después no altera el pedido', async () => {
    expect((await A.owner.call('PATCH', `/v1/stores/${A.storeId}/variants/${A.variantId}`, { priceAmount: 2999 })).status).toBe(200);
    expect((await A.owner.call('GET', `/v1/stores/${A.storeId}/orders/${A.orderId}`)).body.lines[0].unitPrice).toBe(1999);
    await A.owner.call('PATCH', `/v1/stores/${A.storeId}/variants/${A.variantId}`, { priceAmount: 1999 });
  });
  it('líneas repetidas se agrupan; sin stock → 409 y nada cambia', async () => {
    const before = await snapshot(A.storeId);
    const r = await A.staff.call('POST', `/v1/stores/${A.storeId}/orders`, { customerId: A.customerId, shipCountry: 'ES', lines: [{ variantId: A.variantId, quantity: 2 }, { variantId: A.variantId, quantity: 2 }] });
    expect(r).toMatchObject({ status: 409, body: { detail: 'OUT_OF_STOCK' } });
    expect(await snapshot(A.storeId)).toBe(before);
  });
  it('país sin tipo de impuesto → 409', async () => {
    const r = await A.staff.call('POST', `/v1/stores/${A.storeId}/orders`, { customerId: A.customerId, shipCountry: 'FR', lines: [{ variantId: A.variantId, quantity: 1 }] });
    expect(r).toMatchObject({ status: 409, body: { detail: 'NO_TAX_RATE_FOR_COUNTRY' } });
  });
  it('máquina de estados: pending → paid → fulfilled; transiciones ilegales → 409', async () => {
    expect((await A.staff.call('POST', `/v1/stores/${A.storeId}/orders/${A.orderId}/transition`, { to: 'fulfilled' })).status).toBe(409);
    expect((await A.staff.call('POST', `/v1/stores/${A.storeId}/orders/${A.orderId}/transition`, { to: 'paid' })).body.status).toBe('paid');
    expect((await A.staff.call('POST', `/v1/stores/${A.storeId}/orders/${A.orderId}/transition`, { to: 'fulfilled' })).body.status).toBe('fulfilled');
    expect((await A.staff.call('POST', `/v1/stores/${A.storeId}/orders/${A.orderId}/transition`, { to: 'paid' })).status).toBe(409);
  });
  it('cancelar: solo owner/admin, y devuelve el stock', async () => {
    const o = (await A.staff.call('POST', `/v1/stores/${A.storeId}/orders`, { customerId: A.customerId, shipCountry: 'ES', lines: [{ variantId: A.variant2Id, quantity: 1 }] })).body;
    expect(o.number).toBe(2);
    expect((await A.staff.call('POST', `/v1/stores/${A.storeId}/orders/${o.id}/transition`, { to: 'cancelled' })).status).toBe(403);
    expect((await A.owner.call('POST', `/v1/stores/${A.storeId}/orders/${o.id}/transition`, { to: 'cancelled' })).body.status).toBe('cancelled');
    const p = (await A.owner.call('GET', `/v1/stores/${A.storeId}/products/${A.productId}`)).body;
    expect(p.variants.find((v: { sku: string }) => v.sku === 'CAM-a-L').stock).toBe(1);
  });
  it('un producto con pedidos no se borra (409); el staff no edita catálogo (403)', async () => {
    expect((await A.owner.call('DELETE', `/v1/stores/${A.storeId}/products/${A.productId}`)).status).toBe(409);
    expect((await A.staff.call('POST', `/v1/stores/${A.storeId}/products`, product('staff'))).status).toBe(403);
    expect((await A.staff.call('PATCH', `/v1/stores/${A.storeId}/variants/${A.variantId}`, { priceAmount: 1 })).status).toBe(403);
  });
});

describe('Concurrencia', () => {
  it('10 pedidos simultáneos por la última unidad: exactamente 1 gana, stock nunca negativo', async () => {
    const p = (await A.owner.call('POST', `/v1/stores/${A.storeId}/products`, { ...product('race', 1), handle: 'race', variants: [{ sku: 'RACE-1', title: 'Única', priceAmount: 500, stock: 1 }] })).body;
    const vid = p.variants[0].id;
    const rs = await Promise.all(Array.from({ length: 10 }, () => A.staff.call('POST', `/v1/stores/${A.storeId}/orders`, { customerId: A.customerId, shipCountry: 'ES', lines: [{ variantId: vid, quantity: 1 }] })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).every((r) => r.body.detail === 'OUT_OF_STOCK')).toBe(true);
    expect(rs.filter((r) => r.status !== 201 && r.status !== 409)).toEqual([]);
    expect((await A.owner.call('GET', `/v1/stores/${A.storeId}/products/${p.id}`)).body.variants[0].stock).toBe(0);
  });
});

describe('Aislamiento por la API', () => {
  it('el mismo email en dos tiendas son dos clientes distintos y cada tienda solo ve su dirección', async () => {
    expect(A.customerId).not.toBe(B.customerId);
    const a = (await A.owner.call('GET', `/v1/stores/${A.storeId}/customers/${A.customerId}`)).body;
    expect(a.address.line1).toBe('Calle privada de a');
    expect(JSON.stringify(a)).not.toContain('Calle privada de b');
  });
  it('A recibe 404 al leer producto, cliente y pedido de B, por su tienda y por la de B', async () => {
    for (const actor of [A.owner, A.staff]) {
      for (const url of [
        `/v1/stores/${A.storeId}/products/${B.productId}`, `/v1/stores/${A.storeId}/customers/${B.customerId}`, `/v1/stores/${A.storeId}/orders/${B.orderId}`,
        `/v1/stores/${B.storeId}/products/${B.productId}`, `/v1/stores/${B.storeId}/customers/${B.customerId}`, `/v1/stores/${B.storeId}/orders/${B.orderId}`,
        `/v1/stores/${B.storeId}/products`,
      ]) expect({ url, status: (await actor.call('GET', url)).status }).toEqual({ url, status: 404 });
    }
    const list = JSON.stringify((await A.owner.call('GET', `/v1/stores/${A.storeId}/products`)).body);
    expect(list).not.toContain(B.productId);
  });
  it('A no puede modificar nada de B ni usar IDs de B en el cuerpo, y B queda idéntica', async () => {
    const before = await snapshot(B.storeId);
    const attempts: [string, string, unknown?][] = [
      ['PATCH', `/v1/stores/${A.storeId}/variants/${B.variantId}`, { priceAmount: 1 }],
      ['PATCH', `/v1/stores/${B.storeId}/variants/${B.variantId}`, { priceAmount: 1 }],
      ['DELETE', `/v1/stores/${A.storeId}/products/${B.productId}`],
      ['POST', `/v1/stores/${A.storeId}/orders/${B.orderId}/transition`, { to: 'cancelled' }],
      ['POST', `/v1/stores/${A.storeId}/orders`, { customerId: A.customerId, shipCountry: 'ES', lines: [{ variantId: B.variantId, quantity: 1 }] }],
      ['POST', `/v1/stores/${A.storeId}/orders`, { customerId: B.customerId, shipCountry: 'ES', lines: [{ variantId: A.variantId, quantity: 1 }] }],
      ['POST', `/v1/stores/${A.storeId}/orders`, { customerId: A.customerId, shipCountry: 'ES', lines: [{ variantId: A.variant2Id, quantity: 1 }, { variantId: B.variantId, quantity: 1 }] }],
      ['POST', `/v1/stores/${B.storeId}/customers`, { email: 'intruso@test.local', name: 'Intruso' }],
      ['PUT', `/v1/stores/${B.storeId}/tax-rates/ES`, { rateBp: 0, pricesIncludeTax: true }],
    ];
    for (const actor of [A.owner, A.staff]) {
      for (const [m, url, body] of attempts) {
        const r = await actor.call(m, url, body, { 'x-tenant-id': B.storeId });
        expect({ m, url, status: r.status }).toEqual({ m, url, status: actor === A.staff && url.includes(A.storeId) && (m === 'PATCH' || m === 'DELETE') ? 403 : 404 });
      }
    }
    expect(await snapshot(B.storeId)).toBe(before);
  });
});

describe('Aislamiento en la BD (mc_app directo, sin pasar por la API)', () => {
  it('dentro de A, SQL directo no ve ni toca filas de B aunque se pidan por ID', async () => {
    const before = await snapshot(B.storeId);
    await db.withStore(A.owner.token, A.storeId, async (c) => {
      for (const t of SPIKE_TABLES) {
        const r = await c.query(`SELECT count(*)::int AS n FROM commerce.${t} WHERE tenant_id = $1`, [B.storeId]);
        expect({ t, n: r.rows[0].n }).toEqual({ t, n: 0 });
      }
      expect((await c.query('UPDATE commerce.product_variants SET price_amount = 1 WHERE id = $1', [B.variantId])).rowCount).toBe(0);
      expect((await c.query('UPDATE commerce.inventory_levels SET on_hand = 0 WHERE variant_id = $1', [B.variantId])).rowCount).toBe(0);
      expect((await c.query("UPDATE commerce.orders SET status = 'paid' WHERE id = $1", [B.orderId])).rowCount).toBe(0);
      expect((await c.query("UPDATE commerce.customers SET name = 'x' WHERE id = $1", [B.customerId])).rowCount).toBe(0);
    });
    expect(await snapshot(B.storeId)).toBe(before);
  });
  it('insertar con tenant_id de B o enlazar a una variante de B falla', async () => {
    const tryIn = (sql: string, args: unknown[]) => db.withStore(A.owner.token, A.storeId, (c) => c.query(sql, args)).then(() => 'ok', (e) => e.code ?? e.message);
    expect(await tryIn(`INSERT INTO commerce.customers (id, tenant_id, email, name) VALUES (gen_random_uuid(), $1, 'x@y.z', 'x')`, [B.storeId])).toBe('42501');
    // FK compuesta: una variante de B no existe para (tenant A, variant_id)
    expect(await tryIn(`INSERT INTO commerce.inventory_levels (tenant_id, variant_id, on_hand) VALUES ((SELECT commerce.current_tenant()), $1, 1)`, [B.variantId])).toBe('23503');
  });
  it('regla 5b: el staff con mc_app directo no puede escribir catálogo ni impuestos; el owner sí', async () => {
    const asStaff = (sql: string, args: unknown[] = []) => db.withStore(A.staff.token, A.storeId, (c) => c.query(sql, args)).then((r) => r.rowCount, (e) => e.code ?? e.message);
    expect(await asStaff('UPDATE commerce.product_variants SET price_amount = 1 WHERE id = $1', [A.variantId])).toBe(0);
    expect(await asStaff('UPDATE commerce.tax_rates SET rate_bp = 0')).toBe(0);
    expect(await asStaff('DELETE FROM commerce.products WHERE id = $1', [A.productId])).toBe(0);
    expect(await asStaff(`INSERT INTO commerce.products (id, tenant_id, title, handle) VALUES (gen_random_uuid(), (SELECT commerce.current_tenant()), 'x', 'x')`)).toBe('42501');
    expect(await db.withStore(A.owner.token, A.storeId, (c) => c.query('UPDATE commerce.tax_rates SET rate_bp = 2100').then((r) => r.rowCount))).toBe(1);
  });
  it('invariantes: importes del pedido inmutables, pedido sin líneas o con subtotal falso no se confirma', async () => {
    const asOwner = (fn: (c: import('@mc/db').Tx) => Promise<unknown>) => db.withStore(A.owner.token, A.storeId, fn).then(() => 'ok', (e) => e.message);
    // mc_app no tiene UPDATE sobre importes (privilegio de columna) → error de Postgres, no de dominio.
    expect(await asOwner((c) => c.query('UPDATE commerce.orders SET total = 1 WHERE id = $1', [A.orderId]))).toMatch(/permission denied/);
    const ins = (sub: number, withLine: boolean) => asOwner(async (c) => {
      const o = (await c.query(`INSERT INTO commerce.orders (id, tenant_id, number, customer_id, currency, ship_country, tax_rate_bp, prices_include_tax, subtotal, tax_total, total, created_by)
        VALUES (gen_random_uuid(), (SELECT commerce.current_tenant()), 999, $1, 'EUR', 'ES', 2100, true, $2, 0, $2, 'x') RETURNING id`, [A.customerId, sub])).rows[0].id;
      if (withLine) await c.query(`INSERT INTO commerce.order_lines (id, tenant_id, order_id, variant_id, sku, title, unit_price, quantity, line_total)
        VALUES (gen_random_uuid(), (SELECT commerce.current_tenant()), $1, $2, 's', 't', 100, 1, 100)`, [o, A.variantId]);
    });
    expect(await ins(100, false)).toMatch(/ORDER_WITHOUT_LINES/);
    expect(await ins(1, true)).toMatch(/ORDER_SUBTOTAL_MISMATCH/);
  });
  it('el staff con mc_app directo no puede cancelar ni reembolsar (trigger con rol)', async () => {
    const o = (await A.staff.call('POST', `/v1/stores/${A.storeId}/orders`, { customerId: A.customerId, shipCountry: 'ES', lines: [{ variantId: A.variantId, quantity: 1 }] })).body;
    const r = await db.withStore(A.staff.token, A.storeId, (c) => c.query("UPDATE commerce.orders SET status = 'cancelled' WHERE id = $1", [o.id])).then(() => 'ok', (e) => e.message);
    expect(r).toMatch(/TRANSITION_FORBIDDEN/);
  });
  it('catálogo: todas las tablas del spike con tenant_id NOT NULL, RLS+FORCE e índice que empieza por tenant_id', async () => {
    const c = adminClient();
    await c.connect();
    try {
      for (const t of SPIKE_TABLES) {
        const r = (await c.query(`SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
            (SELECT attnotnull FROM pg_attribute WHERE attrelid = c.oid AND attname = 'tenant_id') AS nn,
            EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                    WHERE i.indrelid = c.oid AND a.attname = 'tenant_id') AS idx
          FROM pg_class c WHERE c.oid = ('commerce.' || $1)::regclass`, [t])).rows[0];
        expect({ t, ...r }).toEqual({ t, rls: true, force: true, nn: true, idx: true });
      }
    } finally { await c.end(); }
  });
});
