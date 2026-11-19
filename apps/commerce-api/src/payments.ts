/**
 * Proveedor de pagos. Tres modos:
 *  - «fake»: pago simulado para desarrollo y pruebas automáticas (prohibido en producción).
 *  - Stripe con una sola cuenta de la plataforma (Hito 1).
 *  - Stripe Connect (Hito 2): cada tienda conecta su cuenta Express y cobra con «cargos con destino»: la sesión
 *    de pago se crea en la plataforma con transfer_data[destination] y on_behalf_of = la cuenta de la tienda, así
 *    que los avisos de pago llegan al webhook de la plataforma y el comerciante es quien vende.
 *
 * Se habla con la API REST de Stripe con fetch (sin SDK) y la firma de los avisos se verifica a mano con
 * HMAC-SHA256, tal como documenta Stripe: cabecera `Stripe-Signature: t=<unix>,v1=<hex>[,v1=…]` sobre
 * `${t}.${cuerpo crudo}`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type PaymentsConfig =
  | { provider: 'fake' }
  | { provider: 'stripe'; secretKey: string; webhookSecret: string; apiBase?: string;
      /** Stripe Connect: cada tienda cobra en su cuenta. platformFeeBp = comisión de la plataforma en puntos básicos. */
      connect?: { platformFeeBp: number; webhookSecret?: string } };
type StripeCfg = Extract<PaymentsConfig, { provider: 'stripe' }>;

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

async function stripeCall(cfg: StripeCfg, path: string, body: Record<string, unknown> | null, idempotencyKey?: string) {
  const res = await fetch(`${cfg.apiBase ?? 'https://api.stripe.com'}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${cfg.secretKey}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body ? stripeForm(body).join('&') : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok) throw Object.assign(new Error(`Stripe ${path} → ${res.status}: ${data?.error?.message ?? 'sin detalle'}`), { stripe: data?.error });
  return data;
}

/** Comisión de la plataforma sobre un total (redondeo hacia abajo: nunca se cobra de más al comerciante). */
export const platformFee = (total: number, bp: number) => Math.floor((total * bp) / 10_000);

export async function createStripeCheckout(cfg: StripeCfg, o: CheckoutOrder,
  urls: { success: string; cancel: string }, expiresAt: Date, account: string | null = null) {
  if (cfg.connect && !account) throw new Error('Stripe Connect: falta la cuenta de la tienda');
  const fee = account && cfg.connect ? platformFee(o.total, cfg.connect.platformFeeBp) : 0;
  const connectData = account ? { transfer_data: { destination: account }, on_behalf_of: account, ...(fee > 0 ? { application_fee_amount: fee } : {}) } : {};
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
    payment_intent_data: { metadata: { order_id: o.orderId }, description: `${o.storeName} · pedido #${o.number}`.slice(0, 1000), ...connectData },
  }, `checkout-${o.orderId}`);
  return { id: String(data.id), url: String(data.url) };
}

/** Reembolso total. Con Connect se recupera también la transferencia a la tienda y la comisión de la plataforma. */
export async function refundStripePayment(cfg: StripeCfg, paymentIntentId: string, idempotencyKey: string, connected = false) {
  const data = await stripeCall(cfg, '/v1/refunds', {
    payment_intent: paymentIntentId, ...(connected ? { reverse_transfer: true, refund_application_fee: true } : {}),
  }, idempotencyKey);
  return { id: String(data.id), status: String(data.status) };
}

export type AccountStatus = { chargesEnabled: boolean; detailsSubmitted: boolean; payoutsEnabled: boolean };
const accountStatus = (a: Record<string, any>): AccountStatus => ({
  chargesEnabled: a.charges_enabled === true, detailsSubmitted: a.details_submitted === true, payoutsEnabled: a.payouts_enabled === true,
});

/** Crea la cuenta Express de una tienda. La clave de idempotencia evita dos cuentas si se pulsa dos veces. */
export async function createConnectAccount(cfg: StripeCfg, s: { storeId: string; country: string; email: string; storeName: string }) {
  const data = await stripeCall(cfg, '/v1/accounts', {
    type: 'express', country: s.country, email: s.email,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    business_profile: { name: s.storeName.slice(0, 100) },
    metadata: { store_id: s.storeId },
  }, `account-${s.storeId}`);
  const id = String(data.id);
  if (!/^acct_[A-Za-z0-9]{6,64}$/.test(id)) throw new Error('Stripe devolvió un id de cuenta inesperado');
  return id;
}

/** Enlace de un solo uso al alta de Stripe (caduca a los pocos minutos). */
export async function createAccountLink(cfg: StripeCfg, account: string, urls: { refresh: string; return: string }) {
  const data = await stripeCall(cfg, '/v1/account_links', { account, type: 'account_onboarding', refresh_url: urls.refresh, return_url: urls.return });
  return String(data.url);
}

export async function getAccountStatus(cfg: StripeCfg, account: string) {
  return accountStatus(await stripeCall(cfg, `/v1/accounts/${encodeURIComponent(account)}`, null));
}
export const accountStatusFromEvent = accountStatus;

/** Enlace al panel Express del comerciante (ver cobros y transferencias). */
export async function createDashboardLink(cfg: StripeCfg, account: string) {
  const data = await stripeCall(cfg, `/v1/accounts/${encodeURIComponent(account)}/login_links`, {});
  return String(data.url);
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
