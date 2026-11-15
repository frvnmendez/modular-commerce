import { appendFileSync } from 'node:fs';
import { createAuth, type MailMessage } from '@mc/auth';
import { buildApp } from './app.ts';
import { expireOverdueCheckouts } from './storefront.ts';
import type { PaymentsConfig } from './payments.ts';

const baseURL = process.env.AUTH_BASE_URL ?? 'http://localhost:3000';
const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error('AUTH_SECRET debe tener al menos 32 caracteres');
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',');
// En producción las cookies deben ser Secure (RT-R1 H6): exige HTTPS en la URL pública y en los orígenes.
if (process.env.NODE_ENV === 'production' && ![baseURL, ...allowedOrigins].every((u) => u.startsWith('https://'))) {
  throw new Error('En producción AUTH_BASE_URL y ALLOWED_ORIGINS deben ser https://');
}
// TRUST_PROXY: IP o CIDR del proxy de confianza (p. ej. el balanceador). Sin él se usa la IP del socket.
const trustProxy = process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',') : false;

// Desarrollo local: los emails se escriben en el log. El proveedor real de email se integra en R2.
// MAIL_OUTBOX_FILE (solo fuera de producción): además, una línea JSON por email, para las pruebas E2E.
const outbox = process.env.NODE_ENV !== 'production' ? process.env.MAIL_OUTBOX_FILE : undefined;
const mailer = async (m: MailMessage) => {
  console.log(`[mail] ${m.kind} → ${m.to}: ${m.url}`);
  if (outbox) appendFileSync(outbox, JSON.stringify(m) + '\n');
};

// Pagos. Hito 1: una cuenta de Stripe de la plataforma (claves de prueba sk_test_… mientras no haya OK para cobrar).
// El proveedor simulado («fake») solo existe para desarrollo y pruebas automáticas: en producción no arranca.
const provider = process.env.PAYMENTS_PROVIDER ?? (process.env.STRIPE_SECRET_KEY ? 'stripe' : 'fake');
let payments: PaymentsConfig;
if (provider === 'stripe') {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!/^(sk|rk)_(test|live)_/.test(secretKey)) throw new Error('STRIPE_SECRET_KEY no es una clave de Stripe válida');
  if (!webhookSecret.startsWith('whsec_')) throw new Error('Falta STRIPE_WEBHOOK_SECRET (whsec_…) para verificar los avisos de pago');
  if (secretKey.includes('_live_') && process.env.ALLOW_LIVE_PAYMENTS !== '1') {
    throw new Error('Clave de Stripe en modo real: exige ALLOW_LIVE_PAYMENTS=1 (cobros reales, solo con aprobación del propietario)');
  }
  payments = { provider: 'stripe', secretKey, webhookSecret };
} else if (provider === 'fake') {
  if (process.env.NODE_ENV === 'production') throw new Error('PAYMENTS_PROVIDER=fake no está permitido en producción');
  payments = { provider: 'fake' };
} else {
  throw new Error(`PAYMENTS_PROVIDER desconocido: ${provider}`);
}
const uploadDir = process.env.UPLOAD_DIR ?? './uploads';

const auth = createAuth({ mailer, baseURL, secret, trustedOrigins: allowedOrigins });
const app = buildApp({
  auth, allowedOrigins, trustProxy, uploadDir, payments, publicUrl: baseURL,
  sendMail: async (m) => {
    console.log(`[mail] ${m.kind} → ${m.to}: ${m.subject} ${m.url}`);
    if (outbox) appendFileSync(outbox, JSON.stringify(m) + '\n');
  },
});
app.log.info({ payments: payments.provider, uploadDir }, 'núcleo de venta configurado');
// Libera las reservas de stock de pedidos sin pagar cuya sesión de pago caducó.
setInterval(() => {
  expireOverdueCheckouts().then((n) => { if (n) app.log.info({ n }, 'reservas caducadas liberadas'); })
    .catch((err) => app.log.error({ err }, 'fallo al liberar reservas caducadas'));
}, 5 * 60_000).unref();
app.log.info({ trustProxy }, trustProxy ? 'IP del cliente tomada de X-Forwarded-For solo si llega de un proxy de confianza' : 'sin proxy de confianza: se usa la IP del socket');
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '127.0.0.1' });
