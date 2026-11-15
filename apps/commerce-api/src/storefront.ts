/**
 * Escaparate público y pagos (Hito 1). Sin sesión: el comprador entra por el rol mc_storefront y los avisos
 * de pago por mc_payments (ver migración 0011). Ninguna de estas rutas toca tablas directamente.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { uuidv7 } from 'uuidv7';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { NotFoundError, isUuid, withPayments, withStorefront } from '@mc/db';
import { createStripeCheckout, refundStripePayment, verifyStripeSignature, type CheckoutOrder, type PaymentsConfig } from './payments.ts';

export type OrderMail = { kind: 'order-confirmation' | 'new-order'; to: string; subject: string; url: string; text: string };
export type StorefrontOptions = {
  uploadDir: string;
  payments: PaymentsConfig;
  /** URL pública del panel/escaparate (p. ej. https://tuplataforma.com). Para los enlaces de vuelta del pago. */
  publicUrl: string;
  sendMail?: (m: OrderMail) => Promise<void>;
  /** Compras (y pagos simulados) por IP y minuto. */
  checkoutRateLimit?: number;
};

/** Duración de la reserva de stock. La sesión de Stripe caduca un poco antes (mínimo de Stripe: 30 min). */
export const CHECKOUT_TTL_MINUTES = 32;
const STRIPE_SESSION_SECONDS = 30 * 60 + 30;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const SLUG = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/);
const HANDLE = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/);
const MEDIA_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Límite de peticiones por IP en memoria (un solo proceso en el Hito 1). Frena reservas masivas de stock. */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()) => {
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return true;
  };
}

type OrderJson = {
  orderId: string; number: number; status: string; currency: string; email: string; storeId: string; storeName: string; storeSlug: string;
  contactEmail: string | null; subtotal: string; shippingTotal: string; taxTotal: string; total: string; taxRateBp: number;
  pricesIncludeTax: boolean; expiresAt: string; provider: 'stripe' | 'fake'; shipAddress: Record<string, string>;
  lines: { productTitle: string; variantTitle: string; unitPrice: string; quantity: number; lineTotal: string }[];
  result?: string;
};

/** Importes a número (céntimos, < 2^53) y sin datos internos para el navegador. */
function publicOrder(o: OrderJson) {
  return {
    orderId: o.orderId, number: o.number, status: o.status, currency: o.currency, email: o.email, storeName: o.storeName,
    contactEmail: o.contactEmail, subtotal: Number(o.subtotal), shippingTotal: Number(o.shippingTotal), taxTotal: Number(o.taxTotal),
    total: Number(o.total), taxRateBp: o.taxRateBp, pricesIncludeTax: o.pricesIncludeTax, provider: o.provider, shipAddress: o.shipAddress,
    lines: o.lines.map((l) => ({ ...l, unitPrice: Number(l.unitPrice), lineTotal: Number(l.lineTotal) })),
  };
}

const fmt = (cents: number, currency: string) => new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(cents / 100);

function orderText(o: ReturnType<typeof publicOrder>) {
  const lines = o.lines.map((l) => `- ${l.quantity} × ${l.productTitle} (${l.variantTitle}): ${fmt(l.lineTotal, o.currency)}`).join('\n');
  return `${lines}\nEnvío: ${fmt(o.shippingTotal, o.currency)}\nTotal: ${fmt(o.total, o.currency)}`;
}

export async function storefrontRoutes(app: FastifyInstance, opts: StorefrontOptions) {
  const checkoutLimit = rateLimiter(opts.checkoutRateLimit ?? 10, 60_000);
  const readLimit = rateLimiter(300, 60_000);
  const tooMany = (req: FastifyRequest, limiter: (k: string) => boolean) => {
    if (!limiter(req.ip)) throw Object.assign(new Error('RATE_LIMITED'), { statusCode: 429 });
  };
  const thanksUrl = (slug: string, orderId: string, token: string) =>
    `${opts.publicUrl}/tienda/${slug}/pedido/${orderId}?t=${token}`;

  async function notifyPaid(o: OrderJson, token: string | null) {
    if (!opts.sendMail) return;
    const p = publicOrder(o);
    const url = token ? thanksUrl(o.storeSlug, o.orderId, token) : `${opts.publicUrl}/tienda/${o.storeSlug}`;
    const text = orderText(p);
    await opts.sendMail({ kind: 'order-confirmation', to: o.email, subject: `${o.storeName}: pedido #${o.number} confirmado`, url, text }).catch(() => {});
    if (o.contactEmail) {
      await opts.sendMail({ kind: 'new-order', to: o.contactEmail, subject: `Nuevo pedido #${o.number} en ${o.storeName}`,
        url: `${opts.publicUrl}/stores/${o.storeId}/orders/${o.orderId}`, text }).catch(() => {});
    }
  }

  // --- Imágenes públicas -------------------------------------------------------------------------
  app.get('/media/:tenant/:file', async (req, reply) => {
    const { tenant, file } = z.object({ tenant: z.string(), file: z.string() }).parse(req.params);
    const m = /^[a-f0-9]{32}\.(jpg|png|webp)$/.exec(file);
    if (!isUuid(tenant) || !m) throw new NotFoundError();
    const path = join(opts.uploadDir, tenant.toLowerCase(), file);
    const st = await stat(path).catch(() => null);
    if (!st?.isFile()) throw new NotFoundError();
    reply.header('content-type', MEDIA_TYPES[m[1]!]!);
    reply.header('content-length', st.size);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.header('content-security-policy', "default-src 'none'");
    return reply.send(createReadStream(path));
  });

  // --- Escaparate --------------------------------------------------------------------------------
  app.get('/public/stores/:slug', async (req) => {
    tooMany(req, readLimit);
    const { slug } = z.object({ slug: SLUG }).parse(req.params);
    const s = await withStorefront((c) => c.query('SELECT storefront.get_store($1) AS s', [slug]));
    const r = s.rows[0].s;
    return { ...r, shippingFlatAmount: Number(r.shippingFlatAmount), freeShippingThreshold: r.freeShippingThreshold === null ? null : Number(r.freeShippingThreshold) };
  });

  app.get('/public/stores/:slug/products', async (req) => {
    tooMany(req, readLimit);
    const { slug } = z.object({ slug: SLUG }).parse(req.params);
    const r = await withStorefront((c) => c.query('SELECT storefront.list_products($1) AS p', [slug]));
    return { items: (r.rows[0].p as { priceFrom: string }[]).map((p) => ({ ...p, priceFrom: Number(p.priceFrom) })) };
  });

  app.get('/public/stores/:slug/products/:handle', async (req) => {
    tooMany(req, readLimit);
    const { slug, handle } = z.object({ slug: SLUG, handle: HANDLE }).parse(req.params);
    const r = await withStorefront((c) => c.query('SELECT storefront.get_product($1, $2) AS p', [slug, handle]));
    const p = r.rows[0].p;
    return { ...p, variants: p.variants.map((v: { price: string; compareAt: string | null }) => ({ ...v, price: Number(v.price), compareAt: v.compareAt === null ? null : Number(v.compareAt) })) };
  });

  const Checkout = z.object({
    lines: z.array(z.object({ variantId: z.string().refine(isUuid, 'variante no válida'), quantity: z.number().int().min(1).max(20) }).strict()).min(1).max(50),
    customer: z.object({
      email: z.email().max(254),
      name: z.string().trim().min(1).max(200),
      phone: z.string().trim().max(40).optional(),
      address: z.object({
        line1: z.string().trim().min(1).max(200),
        line2: z.string().trim().max(200).optional(),
        city: z.string().trim().min(1).max(100),
        postalCode: z.string().trim().min(3).max(12),
        province: z.string().trim().max(100).optional(),
      }).strict(),
    }).strict(),
  }).strict();

  app.post('/public/stores/:slug/checkout', async (req, reply) => {
    tooMany(req, checkoutLimit);
    const { slug } = z.object({ slug: SLUG }).parse(req.params);
    const body = Checkout.parse(req.body);
    const orderId = uuidv7();
    const token = randomBytes(24).toString('base64url');
    const provider = opts.payments.provider;
    const o = (await withStorefront((c) => c.query('SELECT storefront.create_checkout($1, $2, $3, $4, $5, $6, $7::interval) AS o',
      [slug, orderId, JSON.stringify(body.lines), JSON.stringify({ ...body.customer, email: body.customer.email.toLowerCase() }),
        sha256(token), provider, `${CHECKOUT_TTL_MINUTES} minutes`]))).rows[0].o as OrderJson;
    const thanks = thanksUrl(slug, orderId, token);
    if (opts.payments.provider === 'fake') {
      // Proveedor simulado (solo desarrollo y pruebas): la página de «gracias» ofrece un botón «Pagar (simulado)».
      return reply.code(201).send({ orderId, redirectUrl: `${thanks}&simulado=1`, order: publicOrder(o) });
    }
    const p = publicOrder(o);
    const co: CheckoutOrder = { orderId, number: p.number, currency: p.currency, email: p.email, storeName: p.storeName, total: p.total,
      shippingTotal: p.shippingTotal, taxTotal: p.taxTotal, pricesIncludeTax: p.pricesIncludeTax, lines: p.lines };
    let session;
    try {
      session = await createStripeCheckout(opts.payments, co, { success: thanks, cancel: `${opts.publicUrl}/tienda/${slug}/carrito?cancelado=1` },
        new Date(Date.now() + STRIPE_SESSION_SECONDS * 1000));
    } catch (e) {
      req.log.error({ err: e, orderId }, 'no se pudo crear la sesión de pago');
      // El pedido queda pendiente y su reserva caduca sola (expire_overdue).
      throw Object.assign(new Error('PAYMENT_UNAVAILABLE'), { statusCode: 502 });
    }
    await withStorefront((c) => c.query('SELECT storefront.attach_payment_session($1, $2)', [orderId, session.id]));
    return reply.code(201).send({ orderId, redirectUrl: session.url, order: p });
  });

  app.get('/public/stores/:slug/orders/:orderId', async (req) => {
    tooMany(req, readLimit);
    const { slug, orderId } = z.object({ slug: SLUG, orderId: z.string() }).parse(req.params);
    const { t } = z.object({ t: z.string().min(20).max(100) }).parse(req.query);
    if (!isUuid(orderId)) throw new NotFoundError();
    const r = await withStorefront((c) => c.query('SELECT storefront.order_summary($1, $2, $3) AS o', [slug, orderId, sha256(t)]));
    return publicOrder(r.rows[0].o);
  });

  // Pago simulado: solo existe si el proveedor configurado es «fake» (server.ts lo prohíbe en producción).
  if (opts.payments.provider === 'fake') {
    app.post('/public/stores/:slug/orders/:orderId/simulate-payment', async (req) => {
      tooMany(req, checkoutLimit);
      const { slug, orderId } = z.object({ slug: SLUG, orderId: z.string() }).parse(req.params);
      const { t } = z.object({ t: z.string().min(20).max(100) }).strict().parse(req.body);
      if (!isUuid(orderId)) throw new NotFoundError();
      const summary = (await withStorefront((c) => c.query('SELECT storefront.order_summary($1, $2, $3) AS o', [slug, orderId, sha256(t)]))).rows[0].o as OrderJson;
      const r = (await withPayments((c) => c.query('SELECT payments.mark_paid($1, $2, $3, $4, $5, $6, $7) AS r',
        [orderId, 'fake', `fake_${orderId}`, `fake_pi_${orderId}`, summary.total, summary.currency, `fake_evt_${orderId}`]))).rows[0].r as OrderJson;
      if (r.result === 'paid') await notifyPaid(r, t);
      return { result: r.result, order: publicOrder(r.result === 'unknown' ? summary : r) };
    });
  }

  // --- Avisos de Stripe (webhook) ----------------------------------------------------------------
  // Necesita el cuerpo crudo para verificar la firma: se registra en un contexto propio con su parser.
  await app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
    sub.post('/webhooks/stripe', async (req, reply) => {
      if (opts.payments.provider !== 'stripe') throw new NotFoundError();
      const cfg = opts.payments;
      const raw = req.body as Buffer;
      const event = Buffer.isBuffer(raw) ? verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined, cfg.webhookSecret) : null;
      if (!event) return reply.code(400).send({ error: 'INVALID_SIGNATURE' });
      const s = event.data?.object ?? {};
      const orderId = String(s.metadata?.order_id ?? s.client_reference_id ?? '');
      if (!isUuid(orderId)) return { received: true, ignored: 'sin pedido' };

      if ((event.type === 'checkout.session.completed' && s.payment_status === 'paid') || event.type === 'checkout.session.async_payment_succeeded') {
        const r = (await withPayments((c) => c.query('SELECT payments.mark_paid($1, $2, $3, $4, $5, $6, $7) AS r',
          [orderId, 'stripe', String(s.id), s.payment_intent ? String(s.payment_intent) : null, Number(s.amount_total), String(s.currency ?? ''), event.id]))).rows[0].r as OrderJson;
        req.log.info({ orderId, result: r.result, event: event.id }, 'aviso de pago');
        if (r.result === 'paid') await notifyPaid(r, null);
        if (r.result === 'late' && s.payment_intent) {
          // Se pagó después de liberar la reserva: se devuelve el dinero automáticamente.
          await refundStripePayment(cfg, String(s.payment_intent), `late-refund-${orderId}`);
          await withPayments((c) => c.query('SELECT payments.record_refund($1, $2)', [orderId, `late-refund-${event.id}`]));
          req.log.warn({ orderId }, 'pago tardío reembolsado');
        }
        if (r.result === 'mismatch') req.log.error({ orderId, event: event.id }, 'aviso de pago que no coincide con el pedido: revisar');
        return { received: true, result: r.result };
      }
      if (event.type === 'checkout.session.expired') {
        const r = (await withPayments((c) => c.query('SELECT payments.expire_session($1, $2, $3) AS r', [orderId, String(s.id), event.id]))).rows[0].r;
        return { received: true, result: r };
      }
      return { received: true, ignored: event.type };
    });
  });
}

/** Cancela las reservas caducadas. Lo llama server.ts cada pocos minutos. */
export async function expireOverdueCheckouts() {
  const r = await withPayments((c) => c.query('SELECT payments.expire_overdue() AS n'));
  return r.rows[0].n as number;
}
