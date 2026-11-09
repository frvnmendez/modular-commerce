/**
 * Medición orientativa (no es la prueba de carga de R2): pedidos por segundo en un solo proceso, contra
 * Postgres local, con la API completa (sesión de Better Auth + withStore + RLS). Solo con SPIKE_BENCH=1.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { adminClient, dropDatabase, freshDatabase } from '../../../tests/isolation/test/fresh-db.ts';

const RUN = process.env.SPIKE_BENCH === '1';
let h: ReturnType<typeof import('@mc/commerce-api/testing').makeApp>;
let dbName: string;

beforeAll(async () => {
  if (!RUN) return;
  dbName = await freshDatabase();
  const { connectionFor } = await import('@mc/db');
  const c = new pg.Client(connectionFor('migrator'));
  await c.connect();
  await c.query(await readFile(new URL('../sql/0100_spike_commerce_core.sql', import.meta.url), 'utf8'));
  await c.end();
  const t = await import('@mc/commerce-api/testing');
  const { spikeCommerceRoutes } = await import('../src/routes.ts');
  h = t.makeApp();
  await h.app.register(spikeCommerceRoutes);
  await h.app.ready();
});

afterAll(async () => {
  if (!RUN) return;
  const t = await import('@mc/commerce-api/testing');
  await t.shutdown(h.app);
  await dropDatabase(dbName);
});

it.runIf(RUN)('pedidos/s y xids consumidos por petición', async () => {
  const t = await import('@mc/commerce-api/testing');
  const owner = await t.signUp(h, 'Bench');
  const { storeId } = await t.createStore(owner, `bench-${Date.now().toString(36)}`);
  await owner.call('PUT', `/v1/stores/${storeId}/tax-rates/ES`, { rateBp: 2100, pricesIncludeTax: true });
  const p = (await owner.call('POST', `/v1/stores/${storeId}/products`, { title: 'B', handle: 'b', status: 'active',
    variants: Array.from({ length: 20 }, (_, i) => ({ sku: `B-${i}`, title: `V${i}`, priceAmount: 1000 + i, stock: 1_000_000 })) })).body;
  const customerId = (await owner.call('POST', `/v1/stores/${storeId}/customers`, { email: 'b@b.test', name: 'B' })).body.id;
  const order = (i: number) => owner.call('POST', `/v1/stores/${storeId}/orders`, { customerId, shipCountry: 'ES',
    lines: [{ variantId: p.variants[i % 20].id, quantity: 1 }, { variantId: p.variants[(i + 7) % 20].id, quantity: 2 }] });

  const xid = async () => { const c = adminClient(); await c.connect(); const r = await c.query('SELECT txid_current()::bigint AS x'); await c.end(); return Number(r.rows[0].x); };
  const N = 400;
  for (const conc of [1, 10]) {
    const x0 = await xid();
    const t0 = performance.now();
    for (let i = 0; i < N; i += conc) {
      const rs = await Promise.all(Array.from({ length: conc }, (_, k) => order(i + k)));
      expect(rs.every((r) => r.status === 201)).toBe(true);
    }
    const ms = performance.now() - t0;
    const x1 = await xid();
    const getT0 = performance.now();
    for (let i = 0; i < 200; i++) await owner.call('GET', `/v1/stores/${storeId}/products/${p.id}`);
    const getMs = performance.now() - getT0;
    console.log(JSON.stringify({ concurrencia: conc, pedidos: N, pedidosPorSegundo: Math.round((N / ms) * 1000),
      msPorPedido: +(ms / N).toFixed(1), xidsPorPedido: +((x1 - x0 - 1) / N).toFixed(2), getProductoMs: +(getMs / 200).toFixed(1) }));
  }
}, 600_000);
