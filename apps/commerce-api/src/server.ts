import { appendFileSync } from 'node:fs';
import { createAuth, type MailMessage } from '@mc/auth';
import { buildApp } from './app.ts';

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

const auth = createAuth({ mailer, baseURL, secret, trustedOrigins: allowedOrigins });
const app = buildApp({ auth, allowedOrigins, trustProxy });
app.log.info({ trustProxy }, trustProxy ? 'IP del cliente tomada de X-Forwarded-For solo si llega de un proxy de confianza' : 'sin proxy de confianza: se usa la IP del socket');
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '127.0.0.1' });
