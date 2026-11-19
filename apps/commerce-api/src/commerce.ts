/**
 * Núcleo de venta en el panel (Hito 1): catálogo, imágenes, ajustes de venta y pedidos.
 * Todo pasa por withStore: la BD comprueba la pertenencia y la RLS limita cada consulta a la tienda.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuidv7 } from 'uuidv7';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, isUuid, withPayments, withStore, type StoreRole, type Tx } from '@mc/db';
import { can, type Permission } from '@mc/core';
import { createAccountLink, createConnectAccount, createDashboardLink, getAccountStatus, refundStripePayment, type PaymentsConfig } from './payments.ts';
import type { Mail } from './mailer.ts';
import { storeBaseUrl } from './storefront.ts';

export type CommerceOptions = {
  uploadDir: string; payments: PaymentsConfig; publicUrl: string; platformDomain?: string;
  sendMail?: (m: Mail) => Promise<void>;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 10;
export const IMAGE_TYPES: Record<string, 'jpg' | 'png' | 'webp'> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Tipo real del fichero por su firma (no por la cabecera que manda el cliente). */
export function sniffImage(b: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

const id = (s: string, what = 'NOT_FOUND') => { if (!isUuid(s)) throw new NotFoundError(what); return s; };
const need = (role: StoreRole, p: Permission) => { if (!can(role, p)) throw new ForbiddenError(`MISSING_PERMISSION:${p}`); };
const manager = (role: StoreRole) => { if (role === 'staff') throw new ForbiddenError('REQUIRES_OWNER_OR_ADMIN'); };

/** Convierte un título en un identificador de URL: «Camiseta Azul Ñ» → «camiseta-azul-n». */
export function slugify(s: string) {
  const base = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90).replace(/-+$/g, '');
  return base || 'producto';
}

const Money = z.number().int().min(0).max(100_000_000_000);
const VariantInput = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(64).optional().nullable().transform((v) => (v ? v : null)),
  price: Money,
  compareAt: Money.optional().nullable(),
  stock: z.number().int().min(0).max(1_000_000),
}).strict();
const ProductInput = z.object({
  title: z.string().trim().min(1).max(200),
  handle: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/).optional(),
  description: z.string().max(5000).default(''),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  variants: z.array(VariantInput).min(1).max(100),
}).strict();

async function loadProduct(c: Tx, productId: string) {
  const p = await c.query(`SELECT id, title, handle, description, status, created_at AS "createdAt", updated_at AS "updatedAt"
    FROM commerce.products WHERE id = $1`, [productId]);
  if (!p.rowCount) throw new NotFoundError();
  const v = await c.query(`SELECT v.id, v.title, v.sku, v.price_amount AS price, v.compare_at_amount AS "compareAt",
      coalesce(i.on_hand, 0) AS stock,
      EXISTS (SELECT 1 FROM commerce.order_lines l WHERE l.variant_id = v.id) AS "hasOrders"
    FROM commerce.product_variants v LEFT JOIN commerce.inventory_levels i ON i.variant_id = v.id
    WHERE v.product_id = $1 ORDER BY v.position, v.created_at`, [productId]);
  const img = await c.query(`SELECT id, tenant_id || '/' || file_name AS path FROM commerce.product_images
    WHERE product_id = $1 ORDER BY position, created_at`, [productId]);
  return {
    ...p.rows[0],
    variants: v.rows.map((r) => ({ ...r, price: Number(r.price), compareAt: r.compareAt === null ? null : Number(r.compareAt) })),
    images: img.rows,
  };
}

async function upsertVariants(c: Tx, productId: string, variants: z.infer<typeof VariantInput>[]) {
  const existing = new Set((await c.query('SELECT id FROM commerce.product_variants WHERE product_id = $1', [productId])).rows.map((r) => r.id as string));
  const keep = new Set(variants.filter((v) => v.id).map((v) => id(v.id!, 'VARIANT_NOT_FOUND')));
  for (const k of keep) if (!existing.has(k)) throw new NotFoundError('VARIANT_NOT_FOUND');
  const removed = [...existing].filter((e) => !keep.has(e));
  if (removed.length) {
    const used = await c.query('SELECT 1 FROM commerce.order_lines WHERE variant_id = ANY($1::uuid[]) LIMIT 1', [removed]);
    if (used.rowCount) throw new ConflictError('VARIANT_HAS_ORDERS');
    await c.query('DELETE FROM commerce.product_variants WHERE id = ANY($1::uuid[])', [removed]);
  }
  for (const [pos, v] of variants.entries()) {
    if (v.compareAt != null && v.compareAt <= v.price) throw new BadRequestError('COMPARE_AT_NOT_HIGHER');
    if (v.id) {
      await c.query(`UPDATE commerce.product_variants SET title = $2, sku = $3, price_amount = $4, compare_at_amount = $5, position = $6
        WHERE id = $1`, [v.id, v.title, v.sku, v.price, v.compareAt ?? null, pos]);
      await c.query('UPDATE commerce.inventory_levels SET on_hand = $2, updated_at = now() WHERE variant_id = $1', [v.id, v.stock]);
    } else {
      const variantId = uuidv7();
      await c.query(`INSERT INTO commerce.product_variants (id, tenant_id, product_id, title, sku, price_amount, compare_at_amount, position)
        VALUES ($1, (SELECT commerce.current_tenant()), $2, $3, $4, $5, $6, $7)`, [variantId, productId, v.title, v.sku, v.price, v.compareAt ?? null, pos]);
      await c.query(`INSERT INTO commerce.inventory_levels (tenant_id, variant_id, on_hand) VALUES ((SELECT commerce.current_tenant()), $1, $2)`,
        [variantId, v.stock]);
    }
  }
}

async function audit(c: Tx, role: StoreRole, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  // La política de auditoría (0010) solo deja insertar a owner/admin; las acciones del staff quedan sin registrar
  // hasta que exista la auditoría por función (pendiente del análisis 2026-11-10, bloqueante 3).
  if (role === 'staff') return;
  await c.query(`INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id, metadata)
    VALUES ((SELECT commerce.current_tenant()), (SELECT control.current_user_id()), $1, $2, $3, $4)`, [action, targetType, targetId, JSON.stringify(metadata)]);
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function commerceRoutes(app: FastifyInstance, opts: CommerceOptions & { tokenOf: (req: FastifyRequest) => string }) {
  const { tokenOf } = opts;
  const P = <K extends string>(...keys: K[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.string()])) as Record<K, z.ZodString>);

  // --- Ajustes de venta --------------------------------------------------------------------------
  app.get('/v1/stores/:storeId/sales-settings', async (req) => {
    const { storeId } = P('storeId').parse(req.params);
    return withStore(tokenOf(req), storeId, async (c) => {
      const s = await c.query(`SELECT st.storefront_published AS "storefrontPublished", st.shipping_flat_amount AS "shippingFlatAmount",
          st.free_shipping_threshold AS "freeShippingThreshold", st.contact_email AS "contactEmail", s.country, s.slug
        FROM commerce.store_settings st JOIN control.stores s ON s.id = st.tenant_id`);
      const row = s.rows[0];
      const t = await c.query('SELECT rate_bp AS "rateBp", prices_include_tax AS "pricesIncludeTax" FROM commerce.tax_rates WHERE country = $1', [row.country]);
      return {
        storefrontPublished: row.storefrontPublished, slug: row.slug,
        shippingFlatAmount: Number(row.shippingFlatAmount), freeShippingThreshold: num(row.freeShippingThreshold), contactEmail: row.contactEmail,
        taxRateBp: t.rows[0]?.rateBp ?? null, pricesIncludeTax: t.rows[0]?.pricesIncludeTax ?? true,
      };
    });
  });

  app.patch('/v1/stores/:storeId/sales-settings', async (req) => {
    const { storeId } = P('storeId').parse(req.params);
    const body = z.object({
      storefrontPublished: z.boolean().optional(),
      shippingFlatAmount: z.number().int().min(0).max(100_000_000).optional(),
      freeShippingThreshold: Money.nullable().optional(),
      contactEmail: z.email().max(254).nullable().optional(),
      taxRateBp: z.number().int().min(0).max(10000).optional(),
      pricesIncludeTax: z.boolean().optional(),
    }).strict().parse(req.body);
    return withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'settings:write');
      const sets: string[] = []; const vals: unknown[] = [];
      const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (body.storefrontPublished !== undefined) add('storefront_published', body.storefrontPublished);
      if (body.shippingFlatAmount !== undefined) add('shipping_flat_amount', body.shippingFlatAmount);
      if (body.freeShippingThreshold !== undefined) add('free_shipping_threshold', body.freeShippingThreshold);
      if (body.contactEmail !== undefined) add('contact_email', body.contactEmail?.toLowerCase() ?? null);
      if (sets.length) await c.query(`UPDATE commerce.store_settings SET ${sets.join(', ')}, updated_at = now()`, vals);
      if (body.taxRateBp !== undefined || body.pricesIncludeTax !== undefined) {
        await c.query(`INSERT INTO commerce.tax_rates (tenant_id, country, rate_bp, prices_include_tax)
          SELECT id, country, coalesce($1, 0), coalesce($2, true) FROM control.stores WHERE id = (SELECT commerce.current_tenant())
          ON CONFLICT (tenant_id, country) DO UPDATE SET rate_bp = coalesce($1, commerce.tax_rates.rate_bp),
            prices_include_tax = coalesce($2, commerce.tax_rates.prices_include_tax)`, [body.taxRateBp ?? null, body.pricesIncludeTax ?? null]);
      }
      await audit(c, role, 'settings.sales_changed', 'store', storeId, body);
      return { ok: true };
    });
  });

  // --- Catálogo ----------------------------------------------------------------------------------
  app.get('/v1/stores/:storeId/products', async (req) => {
    const { storeId } = P('storeId').parse(req.params);
    return withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'catalog:read');
      const r = await c.query(`SELECT p.id, p.title, p.handle, p.status, p.updated_at AS "updatedAt",
          (SELECT count(*) FROM commerce.product_variants v WHERE v.product_id = p.id)::int AS "variantCount",
          (SELECT coalesce(sum(i.on_hand), 0) FROM commerce.product_variants v JOIN commerce.inventory_levels i ON i.variant_id = v.id
            WHERE v.product_id = p.id)::int AS stock,
          (SELECT min(v.price_amount) FROM commerce.product_variants v WHERE v.product_id = p.id) AS "priceFrom",
          (SELECT tenant_id || '/' || file_name FROM commerce.product_images i WHERE i.product_id = p.id ORDER BY position, created_at LIMIT 1) AS image
        FROM commerce.products p ORDER BY p.created_at DESC LIMIT 500`);
      return { items: r.rows.map((x) => ({ ...x, priceFrom: num(x.priceFrom) })) };
    });
  });

  app.post('/v1/stores/:storeId/products', async (req, reply) => {
    const { storeId } = P('storeId').parse(req.params);
    const body = ProductInput.parse(req.body);
    if (body.variants.some((v) => v.id)) throw new BadRequestError('NEW_PRODUCT_WITH_VARIANT_ID');
    const out = await withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'catalog:write');
      const productId = uuidv7();
      let handle = body.handle ?? slugify(body.title);
      if (!body.handle) {
        // Evita choques del identificador automático: camiseta, camiseta-2, camiseta-3…
        const taken = new Set((await c.query(`SELECT handle FROM commerce.products WHERE handle = $1 OR handle LIKE $1 || '-%'`, [handle])).rows.map((r) => r.handle));
        for (let i = 2; taken.has(handle); i++) handle = `${slugify(body.title).slice(0, 85)}-${i}`;
      }
      await c.query(`INSERT INTO commerce.products (id, tenant_id, title, handle, description, status)
        VALUES ($1, (SELECT commerce.current_tenant()), $2, $3, $4, $5)`, [productId, body.title, handle, body.description, body.status]);
      await upsertVariants(c, productId, body.variants);
      await audit(c, role, 'product.created', 'product', productId, { title: body.title });
      return loadProduct(c, productId);
    });
    return reply.code(201).send(out);
  });

  app.get('/v1/stores/:storeId/products/:productId', async (req) => {
    const { storeId, productId } = P('storeId', 'productId').parse(req.params);
    return withStore(tokenOf(req), storeId, async (c, role) => { need(role, 'catalog:read'); return loadProduct(c, id(productId)); });
  });

  app.put('/v1/stores/:storeId/products/:productId', async (req) => {
    const { storeId, productId } = P('storeId', 'productId').parse(req.params);
    const body = ProductInput.parse(req.body);
    return withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'catalog:write');
      const r = await c.query(`UPDATE commerce.products SET title = $2, handle = coalesce($3, handle), description = $4, status = $5, updated_at = now()
        WHERE id = $1 RETURNING id`, [id(productId), body.title, body.handle ?? null, body.description, body.status]);
      if (!r.rowCount) throw new NotFoundError();
      await upsertVariants(c, productId, body.variants);
      await audit(c, role, 'product.updated', 'product', productId, { title: body.title, status: body.status });
      return loadProduct(c, productId);
    });
  });

  app.delete('/v1/stores/:storeId/products/:productId', async (req, reply) => {
    const { storeId, productId } = P('storeId', 'productId').parse(req.params);
    const files = await withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'catalog:write');
      const used = await c.query(`SELECT 1 FROM commerce.order_lines l JOIN commerce.product_variants v ON v.id = l.variant_id
        WHERE v.product_id = $1 LIMIT 1`, [id(productId)]);
      if (used.rowCount) throw new ConflictError('PRODUCT_HAS_ORDERS_ARCHIVE_INSTEAD');
      const imgs = await c.query('SELECT file_name FROM commerce.product_images WHERE product_id = $1', [productId]);
      const r = await c.query('DELETE FROM commerce.products WHERE id = $1', [productId]);
      if (!r.rowCount) throw new NotFoundError();
      await audit(c, role, 'product.deleted', 'product', productId);
      return imgs.rows.map((x) => x.file_name as string);
    });
    await Promise.all(files.map((f) => rm(join(opts.uploadDir, storeId, f), { force: true })));
    return reply.code(204).send();
  });

  // --- Imágenes (cuerpo = el fichero, Content-Type image/jpeg|png|webp) -----------------------------
  app.post('/v1/stores/:storeId/products/:productId/images', { bodyLimit: MAX_IMAGE_BYTES }, async (req, reply) => {
    const { storeId, productId } = P('storeId', 'productId').parse(req.params);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestError('IMAGE_REQUIRED');
    const ext = sniffImage(body);
    if (!ext) throw new BadRequestError('UNSUPPORTED_IMAGE');
    const fileName = `${randomBytes(16).toString('hex')}.${ext}`;
    const out = await withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'catalog:write');
      const p = await c.query('SELECT 1 FROM commerce.products WHERE id = $1', [id(productId)]);
      if (!p.rowCount) throw new NotFoundError();
      const n = (await c.query('SELECT count(*)::int AS n, coalesce(max(position), -1) + 1 AS next FROM commerce.product_images WHERE product_id = $1', [productId])).rows[0];
      if (n.n >= MAX_IMAGES) throw new ConflictError('TOO_MANY_IMAGES');
      const imageId = uuidv7();
      // El fichero se escribe dentro de la transacción: si falla, no queda la fila; si falla la BD, se borra.
      const dir = join(opts.uploadDir, storeId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, fileName), body, { flag: 'wx' });
      try {
        await c.query(`INSERT INTO commerce.product_images (id, tenant_id, product_id, file_name, position)
          VALUES ($1, (SELECT commerce.current_tenant()), $2, $3, $4)`, [imageId, productId, fileName, n.next]);
      } catch (e) {
        await rm(join(dir, fileName), { force: true });
        throw e;
      }
      return { id: imageId, path: `${storeId}/${fileName}` };
    });
    return reply.code(201).send(out);
  });

  app.delete('/v1/stores/:storeId/products/:productId/images/:imageId', async (req, reply) => {
    const { storeId, productId, imageId } = P('storeId', 'productId', 'imageId').parse(req.params);
    const file = await withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'catalog:write');
      const r = await c.query('DELETE FROM commerce.product_images WHERE id = $1 AND product_id = $2 RETURNING file_name', [id(imageId!), id(productId!)]);
      if (!r.rowCount) throw new NotFoundError();
      return r.rows[0].file_name as string;
    });
    await rm(join(opts.uploadDir, storeId!, file), { force: true });
    return reply.code(204).send();
  });

  // --- Pedidos -----------------------------------------------------------------------------------
  const STATUSES = ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'] as const;

  app.get('/v1/stores/:storeId/orders', async (req) => {
    const { storeId } = P('storeId').parse(req.params);
    const q = z.object({ status: z.enum(STATUSES).optional() }).parse(req.query);
    return withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'orders:read');
      const r = await c.query(`SELECT o.id, o.number, o.status, o.email, cu.name AS "customerName", o.total, o.currency,
          o.created_at AS "createdAt", o.paid_at AS "paidAt",
          (SELECT coalesce(sum(quantity), 0) FROM commerce.order_lines l WHERE l.order_id = o.id)::int AS items
        FROM commerce.orders o JOIN commerce.customers cu ON cu.id = o.customer_id
        WHERE ($1::text IS NULL OR o.status = $1) ORDER BY o.created_at DESC LIMIT 200`, [q.status ?? null]);
      const counts = await c.query('SELECT status, count(*)::int AS n FROM commerce.orders GROUP BY status');
      return { items: r.rows.map((o) => ({ ...o, total: Number(o.total) })), counts: Object.fromEntries(counts.rows.map((x) => [x.status, x.n])) };
    });
  });

  async function loadOrder(c: Tx, orderId: string) {
    const o = await c.query(`SELECT o.id, o.number, o.status, o.email, o.currency, o.ship_country AS "shipCountry", o.ship_address AS "shipAddress",
        o.tax_rate_bp AS "taxRateBp", o.prices_include_tax AS "pricesIncludeTax", o.subtotal, o.shipping_total AS "shippingTotal",
        o.tax_total AS "taxTotal", o.total, o.payment_provider AS "paymentProvider", o.payment_intent_id IS NOT NULL AS "hasPaymentIntent",
        o.checkout_expires_at AS "checkoutExpiresAt", o.created_at AS "createdAt", o.paid_at AS "paidAt", o.fulfilled_at AS "fulfilledAt",
        o.cancelled_at AS "cancelledAt", o.refunded_at AS "refundedAt",
        jsonb_build_object('name', cu.name, 'email', cu.email, 'phone', cu.phone) AS customer
      FROM commerce.orders o JOIN commerce.customers cu ON cu.id = o.customer_id WHERE o.id = $1`, [orderId]);
    if (!o.rowCount) throw new NotFoundError();
    const l = await c.query(`SELECT product_title AS "productTitle", variant_title AS "variantTitle", sku, unit_price AS "unitPrice", quantity,
        line_total AS "lineTotal" FROM commerce.order_lines WHERE order_id = $1 ORDER BY product_title, variant_title`, [orderId]);
    const e = await c.query(`SELECT type, result, at FROM commerce.payment_events WHERE order_id = $1 ORDER BY at`, [orderId]);
    const row = o.rows[0];
    return {
      ...row, subtotal: Number(row.subtotal), shippingTotal: Number(row.shippingTotal), taxTotal: Number(row.taxTotal), total: Number(row.total),
      lines: l.rows.map((x) => ({ ...x, unitPrice: Number(x.unitPrice), lineTotal: Number(x.lineTotal) })),
      paymentEvents: e.rows,
    };
  }

  app.get('/v1/stores/:storeId/orders/:orderId', async (req) => {
    const { storeId, orderId } = P('storeId', 'orderId').parse(req.params);
    return withStore(tokenOf(req), storeId!, async (c, role) => { need(role, 'orders:read'); return loadOrder(c, id(orderId!)); });
  });

  app.post('/v1/stores/:storeId/orders/:orderId/fulfill', async (req) => {
    const { storeId, orderId } = P('storeId', 'orderId').parse(req.params);
    const { o, store } = await withStore(tokenOf(req), storeId!, async (c, role) => {
      need(role, 'orders:write');
      const r = await c.query(`UPDATE commerce.orders SET status = 'fulfilled' WHERE id = $1 AND status = 'paid' RETURNING id`, [id(orderId!)]);
      if (!r.rowCount) { await loadOrder(c, orderId!); throw new ConflictError('ORDER_NOT_PAID'); }
      await audit(c, role, 'order.fulfilled', 'order', orderId!);
      const store = (await c.query('SELECT name, slug FROM control.stores WHERE id = (SELECT commerce.current_tenant())')).rows[0];
      return { o: await loadOrder(c, orderId!), store };
    });
    // Aviso al comprador, fuera de la transacción. El enlace de su pedido lleva un token que no se guarda en
    // claro, así que el email lleva a la tienda.
    await opts.sendMail?.({ kind: 'order-shipped', to: o.email, subject: `${store.name}: tu pedido #${o.number} está en camino`,
      url: storeBaseUrl(opts.publicUrl, opts.platformDomain, store.slug), fromName: store.name,
      text: `Pedido #${o.number} enviado a ${o.shipAddress.line1}, ${o.shipAddress.postalCode} ${o.shipAddress.city}.` }).catch(() => {});
    return o;
  });

  app.post('/v1/stores/:storeId/orders/:orderId/cancel', async (req) => {
    const { storeId, orderId } = P('storeId', 'orderId').parse(req.params);
    return withStore(tokenOf(req), storeId!, async (c, role) => {
      need(role, 'orders:write'); manager(role);
      const r = await c.query(`UPDATE commerce.orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING id`, [id(orderId!)]);
      if (!r.rowCount) { await loadOrder(c, orderId!); throw new ConflictError('ONLY_UNPAID_ORDERS_CAN_BE_CANCELLED'); }
      await audit(c, role, 'order.cancelled', 'order', orderId!);
      return loadOrder(c, orderId!);
    });
  });

  // Reembolso total. Primero se bloquea el pedido, después se reembolsa en Stripe y solo si va bien se marca.
  app.post('/v1/stores/:storeId/orders/:orderId/refund', async (req) => {
    const { storeId, orderId } = P('storeId', 'orderId').parse(req.params);
    return withStore(tokenOf(req), storeId!, async (c, role) => {
      need(role, 'orders:write'); manager(role);
      const o = await c.query('SELECT status, payment_provider, payment_intent_id, payment_account_id FROM commerce.orders WHERE id = $1 FOR UPDATE', [id(orderId!)]);
      if (!o.rowCount) throw new NotFoundError();
      const row = o.rows[0];
      if (!['paid', 'fulfilled'].includes(row.status)) throw new ConflictError('ORDER_NOT_REFUNDABLE');
      if (row.payment_provider === 'stripe') {
        if (opts.payments.provider !== 'stripe' || !row.payment_intent_id) throw new ConflictError('REFUND_UNAVAILABLE');
        await refundStripePayment(opts.payments, row.payment_intent_id, `refund-${orderId}`, row.payment_account_id !== null);
      }
      await c.query(`UPDATE commerce.orders SET status = 'refunded' WHERE id = $1`, [orderId]);
      await audit(c, role, 'order.refunded', 'order', orderId!);
      return loadOrder(c, orderId!);
    });
  });

  // --- Cobros de la tienda (Stripe Connect) ------------------------------------------------------
  const mode = opts.payments.provider === 'fake' ? 'fake' : opts.payments.connect ? 'connect' : 'platform';
  const stripe = () => {
    if (opts.payments.provider !== 'stripe' || !opts.payments.connect) throw new ConflictError('CONNECT_DISABLED');
    return opts.payments;
  };
  const accountRow = async (c: Tx) => (await c.query(`SELECT account_id AS "accountId", charges_enabled AS "chargesEnabled",
      details_submitted AS "detailsSubmitted", payouts_enabled AS "payoutsEnabled" FROM commerce.payment_accounts`)).rows[0] ?? null;
  const paymentsView = (a: { chargesEnabled: boolean; detailsSubmitted: boolean; payoutsEnabled: boolean } | null) => ({
    mode, platformFeeBp: mode === 'connect' ? stripe().connect!.platformFeeBp : 0,
    ready: mode !== 'connect' || !!a?.chargesEnabled,
    account: a ? { chargesEnabled: a.chargesEnabled, detailsSubmitted: a.detailsSubmitted, payoutsEnabled: a.payoutsEnabled } : null,
  });

  app.get('/v1/stores/:storeId/payments', async (req) => {
    const { storeId } = P('storeId').parse(req.params);
    return withStore(tokenOf(req), storeId, async (c) => paymentsView(await accountRow(c)));
  });

  // Alta en Stripe: crea la cuenta Express de la tienda (una sola vez) y devuelve el enlace al formulario de Stripe.
  app.post('/v1/stores/:storeId/payments/connect', async (req) => {
    const { storeId } = P('storeId').parse(req.params);
    const cfg = stripe();
    const settingsUrl = `${opts.publicUrl}/stores/${storeId}/settings`;
    return withStore(tokenOf(req), storeId, async (c, role) => {
      manager(role);
      let a = await accountRow(c);
      if (!a) {
        const s = (await c.query(`SELECT s.name, s.country, coalesce(st.contact_email::text, $1) AS email
          FROM control.stores s JOIN commerce.store_settings st ON st.tenant_id = s.id`, [req.user!.email])).rows[0];
        const accountId = await createConnectAccount(cfg, { storeId, country: s.country, email: s.email, storeName: s.name });
        await c.query(`INSERT INTO commerce.payment_accounts (tenant_id, provider, account_id)
          VALUES ((SELECT commerce.current_tenant()), 'stripe', $1) ON CONFLICT (tenant_id) DO NOTHING`, [accountId]);
        await audit(c, role, 'payments.account_created', 'store', storeId);
        a = await accountRow(c);
      }
      const url = await createAccountLink(cfg, a.accountId, { refresh: `${settingsUrl}?stripe=reintentar`, return: `${settingsUrl}?stripe=volver` });
      return { url };
    });
  });

  // Vuelve a leer el estado de la cuenta en Stripe (al volver del alta o desde ajustes).
  app.post('/v1/stores/:storeId/payments/refresh', async (req) => {
    const { storeId } = P('storeId').parse(req.params);
    const cfg = stripe();
    const a = await withStore(tokenOf(req), storeId, async (c) => accountRow(c));
    if (!a) return paymentsView(null);
    const st = await getAccountStatus(cfg, a.accountId);
    await withPayments((c) => c.query('SELECT payments.update_account($1, $2, $3, $4)', [a.accountId, st.chargesEnabled, st.detailsSubmitted, st.payoutsEnabled]));
    return paymentsView(st);
  });

  app.post('/v1/stores/:storeId/payments/dashboard', async (req) => {
    const { storeId } = P('storeId').parse(req.params);
    const cfg = stripe();
    const a = await withStore(tokenOf(req), storeId, async (c, role) => { manager(role); return accountRow(c); });
    if (!a?.detailsSubmitted) throw new ConflictError('ACCOUNT_NOT_READY');
    return { url: await createDashboardLink(cfg, a.accountId) };
  });

  // --- Diseño de la tienda -----------------------------------------------------------------------
  const designOf = async (c: Tx) => {
    const r = (await c.query(`SELECT st.accent_color AS "accentColor", st.headline, st.tagline,
        CASE WHEN st.logo_file IS NULL THEN NULL ELSE st.tenant_id || '/' || st.logo_file END AS logo,
        CASE WHEN st.banner_file IS NULL THEN NULL ELSE st.tenant_id || '/' || st.banner_file END AS banner
      FROM commerce.store_settings st`)).rows[0];
    return r;
  };
  app.get('/v1/stores/:storeId/design', async (req) => {
    const { storeId } = P('storeId').parse(req.params);
    return withStore(tokenOf(req), storeId, async (c) => designOf(c));
  });

  app.patch('/v1/stores/:storeId/design', async (req) => {
    const { storeId } = P('storeId').parse(req.params);
    const body = z.object({
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
      headline: z.string().trim().max(120).nullable().optional(),
      tagline: z.string().trim().max(300).nullable().optional(),
    }).strict().parse(req.body);
    return withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'settings:write');
      const sets: string[] = []; const vals: unknown[] = [];
      const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (body.accentColor !== undefined) add('accent_color', body.accentColor?.toLowerCase() ?? null);
      if (body.headline !== undefined) add('headline', body.headline || null);
      if (body.tagline !== undefined) add('tagline', body.tagline || null);
      if (sets.length) await c.query(`UPDATE commerce.store_settings SET ${sets.join(', ')}, updated_at = now()`, vals);
      await audit(c, role, 'settings.design_changed', 'store', storeId, body);
      return designOf(c);
    });
  });

  const SLOT = z.object({ storeId: z.string(), slot: z.enum(['logo', 'banner']) });
  app.post('/v1/stores/:storeId/design/:slot', { bodyLimit: MAX_IMAGE_BYTES }, async (req) => {
    const { storeId, slot } = SLOT.parse(req.params);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestError('IMAGE_REQUIRED');
    const ext = sniffImage(body);
    if (!ext) throw new BadRequestError('UNSUPPORTED_IMAGE');
    const fileName = `${randomBytes(16).toString('hex')}.${ext}`;
    const dir = join(opts.uploadDir, storeId);
    const { old, design } = await withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'settings:write');
      const col = slot === 'logo' ? 'logo_file' : 'banner_file';
      const prev = (await c.query(`SELECT ${col} AS f FROM commerce.store_settings FOR UPDATE`)).rows[0]?.f as string | null;
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, fileName), body, { flag: 'wx' });
      try {
        await c.query(`UPDATE commerce.store_settings SET ${col} = $1, updated_at = now()`, [fileName]);
      } catch (e) { await rm(join(dir, fileName), { force: true }); throw e; }
      await audit(c, role, `settings.${slot}_changed`, 'store', storeId);
      return { old: prev, design: await designOf(c) };
    });
    if (old) await rm(join(dir, old), { force: true });
    return design;
  });

  app.delete('/v1/stores/:storeId/design/:slot', async (req) => {
    const { storeId, slot } = SLOT.parse(req.params);
    const { old, design } = await withStore(tokenOf(req), storeId, async (c, role) => {
      need(role, 'settings:write');
      const col = slot === 'logo' ? 'logo_file' : 'banner_file';
      const prev = (await c.query(`SELECT ${col} AS f FROM commerce.store_settings FOR UPDATE`)).rows[0]?.f as string | null;
      await c.query(`UPDATE commerce.store_settings SET ${col} = NULL, updated_at = now()`);
      await audit(c, role, `settings.${slot}_removed`, 'store', storeId);
      return { old: prev, design: await designOf(c) };
    });
    if (old) await rm(join(opts.uploadDir, storeId, old), { force: true });
    return design;
  });
}
