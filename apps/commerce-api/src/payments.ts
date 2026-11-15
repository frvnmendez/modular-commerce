/**
 * Proveedor de pagos. Hito 1: una sola cuenta de Stripe de la plataforma (modo prueba) o un proveedor simulado
 * para desarrollo y pruebas automáticas. En el Hito 2 cada tienda conectará su propia cuenta (Stripe Connect).
 *
 * Se habla con la API REST de Stripe con fetch (sin SDK) y la firma de los avisos se verifica a mano con
 * HMAC-SHA256, tal como documenta Stripe: cabecera `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]` sobre
 * `${t}.${cuerpo crudo}`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type PaymentsConfig =
  | { provider: 'fake' }
  | { provider: 'stripe'; secretKey: string; webhookSecret: string; apiBase?: string };

export type CheckoutOrder = {
  orderId: string;
  number: number;
  currency: string;
  email: string;
  storeName: string;
  total: number;
  shippingTotal: number;
  taxTotal: number;
  pricesIncludeTax: boolean;
  lines: { productTitle: string; variantTitle: string; unitPrice: number; quantity: number }[];
};

/** Codifica un objeto anidado como application/x-www-form-urlencoded al estilo de Stripe (a[b][0][c]=…). */
export function stripeForm(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === 'object' && item !== null) out.push(...stripeForm(item as Record<string, unknown>, `${key}[${i}]`));
      else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
    });
    else if (typeof v === 'object') out.push(...stripeForm(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

/** Líneas que verá el comprador en la página de pago. Deben sumar exactamente el total del pedido. */
export function checkoutLineItems(o: CheckoutOrder) {
  const currency = o.currency.toLowerCase();
  const items = o.lines.map((l) => ({
    quantity: l.quantity,
    price_data: { currency, unit_amount: l.unitPrice, product_data: { name: `${l.productTitle} · ${l.variantTitle}`.slice(0, 250) } },
  }));
  if (o.shippingTotal > 0) items.push({ quantity: 1, price_data: { currency, unit_amount: o.shippingTotal, product_data: { name: 'Envío' } } });
  if (!o.pricesIncludeTax && o.taxTotal > 0) items.push({ quantity: 1, price_data: { currency, unit_amount: o.taxTotal, product_data: { name: 'IVA' } } });
  const sum = items.reduce((a, i) => a + i.price_data.unit_amount * i.quantity, 0);
  if (sum !== o.total) throw new Error(`Las líneas de pago (${sum}) no suman el total del pedido (${o.total})`);
  return items;
}

async function stripeCall(cfg: Extract<PaymentsConfig, { provider: 'stripe' }>, path: string, body: Record<string, unknown>, idempotencyKey: string) {
  const res = await fetch(`${cfg.apiBase ?? 'https://api.stripe.com'}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': idempotencyKey,
    },
    body: stripeForm(body).join('&'),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok) throw Object.assign(new Error(`Stripe ${path} → ${res.status}: ${data?.error?.message ?? 'sin detalle'}`), { stripe: data?.error });
  return data;
}

export async function createStripeCheckout(cfg: Extract<PaymentsConfig, { provider: 'stripe' }>, o: CheckoutOrder,
  urls: { success: string; cancel: string }, expiresAt: Date) {
  const data = await stripeCall(cfg, '/v1/checkout/sessions', {
    mode: 'payment',
    client_reference_id: o.orderId,
    customer_email: o.email,
    success_url: urls.success,
    cancel_url: urls.cancel,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    locale: 'es',
    line_items: checkoutLineItems(o),
    metadata: { order_id: o.orderId, order_number: String(o.number) },
    payment_intent_data: { metadata: { order_id: o.orderId }, description: `${o.storeName} · pedido #${o.number}`.slice(0, 1000) },
  }, `checkout-${o.orderId}`);
  return { id: String(data.id), url: String(data.url) };
}

export async function refundStripePayment(cfg: Extract<PaymentsConfig, { provider: 'stripe' }>, paymentIntentId: string, idempotencyKey: string) {
  const data = await stripeCall(cfg, '/v1/refunds', { payment_intent: paymentIntentId }, idempotencyKey);
  return { id: String(data.id), status: String(data.status) };
}

/** Verifica la firma de un aviso de Stripe. Devuelve el evento o null si la firma no vale o es antigua. */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, now = Date.now(), toleranceSec = 300) {
  if (!header) return null;
  let t: number | undefined;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k === 't' && v && /^\d+$/.test(v)) t = Number(v);
    if (k === 'v1' && v && /^[a-f0-9]{64}$/.test(v)) sigs.push(v);
  }
  if (t === undefined || sigs.length === 0) return null;
  if (Math.abs(now / 1000 - t) > toleranceSec) return null;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  const ok = sigs.some((s) => { const b = Buffer.from(s, 'hex'); return b.length === expected.length && timingSafeEqual(b, expected); });
  if (!ok) return null;
  try { return JSON.parse(raw.toString('utf8')) as { id: string; type: string; data: { object: Record<string, any> } }; } catch { return null; }
}

/** Firma un cuerpo como lo haría Stripe. Solo para pruebas. */
export function signStripePayload(raw: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
}
