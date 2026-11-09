/**
 * SPIKE ADR-0001 — núcleo comercial propio: rutas mínimas de catálogo, clientes y pedidos.
 * Se registran sobre la app de R1 (misma sesión, mismo withStore, misma RLS). No es código de producción.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuidv7 } from 'uuidv7';
import { ConflictError, ForbiddenError, NotFoundError, isUuid, withStore, type StoreRole, type Tx } from '@mc/db';
import { orderTotals } from './money.ts';

const tokenOf = (req: FastifyRequest) => {
  const u = (req as FastifyRequest & { user?: { token: string } }).user;
  if (!u) throw Object.assign(new Error('UNAUTHENTICATED'), { statusCode: 401 });
  return u.token;
};
const params = <K extends string>(...keys: K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.string()])) as Record<K, z.ZodString>);
const id = (s: string) => { if (!isUuid(s)) throw new NotFoundError(); return s; };
/** Comprobación en la API (mensaje claro). La barrera real es la política RESTRICTIVE de la BD. */
const requireManager = (role: StoreRole) => { if (role === 'staff') throw new ForbiddenError('CATALOG_WRITE_REQUIRES_ADMIN'); };

const Money = z.number().int().min(0).max(100_000_000_000);
const VariantInput = z.object({
  sku: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  priceAmount: Money,
  stock: z.number().int().min(0).max(1_000_000),
}).strict();
const ProductInput = z.object({
  title: z.string().trim().min(1).max(200),
  handle: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  variants: z.array(VariantInput).min(1).max(100),
}).strict();

async function storeCurrency(c: Tx): Promise<string> {
  const r = await c.query('SELECT currency FROM control.stores WHERE id = (SELECT commerce.current_tenant())');
  return r.rows[0].currency;
}

async function loadProduct(c: Tx, productId: string) {
  const p = await c.query('SELECT id, title, handle, status FROM commerce.products WHERE id = $1', [productId]);
  if (!p.rowCount) throw new NotFoundError();
  const v = await c.query(`SELECT v.id, v.sku, v.title, v.price_amount::int AS "priceAmount", v.currency, i.on_hand AS stock
    FROM commerce.product_variants v JOIN commerce.inventory_levels i ON i.variant_id = v.id
    WHERE v.product_id = $1 ORDER BY v.sku`, [productId]);
  return { ...p.rows[0], variants: v.rows };
}

async function loadOrder(c: Tx, orderId: string) {
  const o = await c.query(`SELECT id, number, customer_id AS "customerId", status, currency, ship_country AS "shipCountry",
      tax_rate_bp AS "taxRateBp", prices_include_tax AS "pricesIncludeTax",
      subtotal::int, tax_total::int AS "taxTotal", total::int FROM commerce.orders WHERE id = $1`, [orderId]);
  if (!o.rowCount) throw new NotFoundError();
  const l = await c.query(`SELECT variant_id AS "variantId", sku, title, unit_price::int AS "unitPrice", quantity, line_total::int AS "lineTotal"
    FROM commerce.order_lines WHERE order_id = $1 ORDER BY sku`, [orderId]);
  return { ...o.rows[0], lines: l.rows };
}

export async function spikeCommerceRoutes(app: FastifyInstance) {
  // --- Impuestos -----------------------------------------------------------------------------
  app.put('/v1/stores/:storeId/tax-rates/:country', async (req) => {
    const { storeId, country } = params('storeId', 'country').parse(req.params);
    const body = z.object({ rateBp: z.number().int().min(0).max(10000), pricesIncludeTax: z.boolean() }).strict().parse(req.body);
    if (!/^[A-Z]{2}$/.test(country)) throw new NotFoundError();
    return withStore(tokenOf(req), storeId, async (c, role) => {
      requireManager(role);
      await c.query(`INSERT INTO commerce.tax_rates (tenant_id, country, rate_bp, prices_include_tax)
        VALUES ((SELECT commerce.current_tenant()), $1, $2, $3)
        ON CONFLICT (tenant_id, country) DO UPDATE SET rate_bp = EXCLUDED.rate_bp, prices_include_tax = EXCLUDED.prices_include_tax`,
        [country, body.rateBp, body.pricesIncludeTax]);
      return { country, ...body };
    });
  });

  // --- Catálogo ------------------------------------------------------------------------------
  app.post('/v1/stores/:storeId/products', async (req, reply) => {
    const { storeId } = params('storeId').parse(req.params);
    const body = ProductInput.parse(req.body);
    const out = await withStore(tokenOf(req), storeId, async (c, role) => {
      requireManager(role);
      const currency = await storeCurrency(c);
      const productId = uuidv7();
      await c.query(`INSERT INTO commerce.products (id, tenant_id, title, handle, status)
        VALUES ($1, (SELECT commerce.current_tenant()), $2, $3, $4)`, [productId, body.title, body.handle, body.status]);
      for (const v of body.variants) {
        const variantId = uuidv7();
        await c.query(`INSERT INTO commerce.product_variants (id, tenant_id, product_id, sku, title, price_amount, currency)
          VALUES ($1, (SELECT commerce.current_tenant()), $2, $3, $4, $5, $6)`, [variantId, productId, v.sku, v.title, v.priceAmount, currency]);
        await c.query(`INSERT INTO commerce.inventory_levels (tenant_id, variant_id, on_hand)
          VALUES ((SELECT commerce.current_tenant()), $1, $2)`, [variantId, v.stock]);
      }
      return loadProduct(c, productId);
    });
    return reply.code(201).send(out);
  });

  app.get('/v1/stores/:storeId/products', async (req) => {
    const { storeId } = params('storeId').parse(req.params);
    return withStore(tokenOf(req), storeId, async (c) => {
      const r = await c.query(`SELECT p.id, p.title, p.handle, p.status, count(v.id)::int AS "variantCount"
        FROM commerce.products p LEFT JOIN commerce.product_variants v ON v.product_id = p.id
        GROUP BY p.id ORDER BY p.created_at`);
      return { items: r.rows };
    });
  });

  app.get('/v1/stores/:storeId/products/:productId', async (req) => {
    const { storeId, productId } = params('storeId', 'productId').parse(req.params);
    return withStore(tokenOf(req), storeId, (c) => loadProduct(c, id(productId)));
  });

  app.patch('/v1/stores/:storeId/variants/:variantId', async (req) => {
    const { storeId, variantId } = params('storeId', 'variantId').parse(req.params);
    const body = z.object({ title: z.string().trim().min(1).max(200).optional(), priceAmount: Money.optional() }).strict().parse(req.body);
    return withStore(tokenOf(req), storeId, async (c, role) => {
      requireManager(role);
      const r = await c.query(`UPDATE commerce.product_variants SET title = COALESCE($2, title), price_amount = COALESCE($3, price_amount)
        WHERE id = $1 RETURNING id`, [id(variantId), body.title ?? null, body.priceAmount ?? null]);
      if (!r.rowCount) throw new NotFoundError();
      return { ok: true };
    });
  });

  app.delete('/v1/stores/:storeId/products/:productId', async (req, reply) => {
    const { storeId, productId } = params('storeId', 'productId').parse(req.params);
    await withStore(tokenOf(req), storeId, async (c, role) => {
      requireManager(role);
      // Un producto con pedidos no se borra (FK de order_lines): se archiva.
      const used = await c.query('SELECT 1 FROM commerce.order_lines l JOIN commerce.product_variants v ON v.id = l.variant_id WHERE v.product_id = $1 LIMIT 1', [id(productId)]);
      if (used.rowCount) throw new ConflictError('PRODUCT_HAS_ORDERS_ARCHIVE_INSTEAD');
      const r = await c.query('DELETE FROM commerce.products WHERE id = $1', [productId]);
      if (!r.rowCount) throw new NotFoundError();
    });
    return reply.code(204).send();
  });

  // --- Clientes ------------------------------------------------------------------------------
  app.post('/v1/stores/:storeId/customers', async (req, reply) => {
    const { storeId } = params('storeId').parse(req.params);
    const body = z.object({
      email: z.email().max(254),
      name: z.string().trim().min(1).max(200),
      address: z.object({ line1: z.string().max(200), city: z.string().max(100), country: z.string().regex(/^[A-Z]{2}$/) }).strict().optional(),
    }).strict().parse(req.body);
    const customerId = uuidv7();
    await withStore(tokenOf(req), storeId, (c) => c.query(`INSERT INTO commerce.customers (id, tenant_id, email, name, address)
      VALUES ($1, (SELECT commerce.current_tenant()), $2, $3, $4)`, [customerId, body.email, body.name, body.address ? JSON.stringify(body.address) : null]));
    return reply.code(201).send({ id: customerId, ...body });
  });

  app.get('/v1/stores/:storeId/customers/:customerId', async (req) => {
    const { storeId, customerId } = params('storeId', 'customerId').parse(req.params);
    return withStore(tokenOf(req), storeId, async (c) => {
      const r = await c.query('SELECT id, email, name, address FROM commerce.customers WHERE id = $1', [id(customerId)]);
      if (!r.rowCount) throw new NotFoundError();
      return r.rows[0];
    });
  });

  // --- Pedidos -------------------------------------------------------------------------------
  const OrderInput = z.object({
    customerId: z.string(),
    shipCountry: z.string().regex(/^[A-Z]{2}$/),
    lines: z.array(z.object({ variantId: z.string(), quantity: z.number().int().min(1).max(10000) }).strict()).min(1).max(100),
  }).strict();

  app.post('/v1/stores/:storeId/orders', async (req, reply) => {
    const { storeId } = params('storeId').parse(req.params);
    const body = OrderInput.parse(req.body);
    // Agrupa líneas repetidas de la misma variante.
    const qty = new Map<string, number>();
    for (const l of body.lines) qty.set(id(l.variantId), (qty.get(l.variantId) ?? 0) + l.quantity);
    const out = await withStore(tokenOf(req), storeId, async (c) => {
      const cust = await c.query('SELECT 1 FROM commerce.customers WHERE id = $1', [id(body.customerId)]);
      if (!cust.rowCount) throw new NotFoundError('CUSTOMER_NOT_FOUND');
      const currency = await storeCurrency(c);
      const tax = await c.query('SELECT rate_bp, prices_include_tax FROM commerce.tax_rates WHERE country = $1', [body.shipCountry]);
      if (!tax.rowCount) throw new ConflictError('NO_TAX_RATE_FOR_COUNTRY');
      const ids = [...qty.keys()].sort();
      // Bloqueo en orden estable (por id) para evitar interbloqueos entre pedidos concurrentes.
      const vs = await c.query(`SELECT v.id, v.sku, v.title, v.price_amount, v.currency, p.status, i.on_hand
        FROM commerce.product_variants v
        JOIN commerce.products p ON p.id = v.product_id
        JOIN commerce.inventory_levels i ON i.variant_id = v.id
        WHERE v.id = ANY($1::uuid[]) ORDER BY v.id FOR UPDATE OF i`, [ids]);
      // Una variante de otra tienda es invisible por RLS: mismo 404 que una que no existe.
      if (vs.rowCount !== ids.length) throw new NotFoundError('VARIANT_NOT_FOUND');
      for (const v of vs.rows) {
        if (v.status !== 'active') throw new ConflictError('PRODUCT_NOT_ACTIVE');
        if (v.currency !== currency) throw new ConflictError('CURRENCY_MISMATCH');
        if (v.on_hand < qty.get(v.id)!) throw new ConflictError('OUT_OF_STOCK');
      }
      for (const v of vs.rows) {
        await c.query('UPDATE commerce.inventory_levels SET on_hand = on_hand - $2, updated_at = now() WHERE variant_id = $1', [v.id, qty.get(v.id)]);
      }
      const t = orderTotals(vs.rows.map((v) => ({ unitPrice: BigInt(v.price_amount), quantity: qty.get(v.id)! })), tax.rows[0].rate_bp, tax.rows[0].prices_include_tax);
      const n = await c.query(`INSERT INTO commerce.order_counters (tenant_id, last_number) VALUES ((SELECT commerce.current_tenant()), 1)
        ON CONFLICT (tenant_id) DO UPDATE SET last_number = commerce.order_counters.last_number + 1 RETURNING last_number`);
      const orderId = uuidv7();
      await c.query(`INSERT INTO commerce.orders (id, tenant_id, number, customer_id, currency, ship_country, tax_rate_bp, prices_include_tax,
          subtotal, tax_total, total, created_by)
        VALUES ($1, (SELECT commerce.current_tenant()), $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT control.current_user_id()))`,
        [orderId, n.rows[0].last_number, body.customerId, currency, body.shipCountry, tax.rows[0].rate_bp, tax.rows[0].prices_include_tax,
          t.subtotal.toString(), t.taxTotal.toString(), t.total.toString()]);
      for (const [i, v] of vs.rows.entries()) {
        await c.query(`INSERT INTO commerce.order_lines (id, tenant_id, order_id, variant_id, sku, title, unit_price, quantity, line_total)
          VALUES ($1, (SELECT commerce.current_tenant()), $2, $3, $4, $5, $6, $7, $8)`,
          [uuidv7(), orderId, v.id, v.sku, v.title, v.price_amount, qty.get(v.id), t.lines[i]!.toString()]);
      }
      return loadOrder(c, orderId);
    });
    return reply.code(201).send(out);
  });

  app.get('/v1/stores/:storeId/orders/:orderId', async (req) => {
    const { storeId, orderId } = params('storeId', 'orderId').parse(req.params);
    return withStore(tokenOf(req), storeId, (c) => loadOrder(c, id(orderId)));
  });

  app.post('/v1/stores/:storeId/orders/:orderId/transition', async (req) => {
    const { storeId, orderId } = params('storeId', 'orderId').parse(req.params);
    const { to } = z.object({ to: z.enum(['paid', 'fulfilled', 'cancelled', 'refunded']) }).strict().parse(req.body);
    return withStore(tokenOf(req), storeId, async (c) => {
      const cur = await c.query('SELECT status FROM commerce.orders WHERE id = $1 FOR UPDATE', [id(orderId)]);
      if (!cur.rowCount) throw new NotFoundError();
      // La BD valida la transición y el rol (trigger orders_transition).
      await c.query('UPDATE commerce.orders SET status = $2 WHERE id = $1', [orderId, to]);
      // Cancelar antes de enviar devuelve el stock.
      if (to === 'cancelled') {
        await c.query(`UPDATE commerce.inventory_levels i SET on_hand = i.on_hand + l.quantity, updated_at = now()
          FROM commerce.order_lines l WHERE l.order_id = $1 AND i.variant_id = l.variant_id`, [orderId]);
      }
      return loadOrder(c, orderId);
    });
  });
}
