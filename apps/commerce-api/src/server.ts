import { createAuth, type MailMessage } from '@mc/auth';
import { buildApp } from './app.ts';

const baseURL = process.env.AUTH_BASE_URL ?? 'http://localhost:3000';
const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error('AUTH_SECRET debe tener al menos 32 caracteres');
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',');

// Desarrollo local: los emails se escriben en el log. El proveedor real de email se integra en R2.
const mailer = async (m: MailMessage) => { console.log(`[mail] ${m.kind} → ${m.to}: ${m.url}`); };

const auth = createAuth({ mailer, baseURL, secret, trustedOrigins: allowedOrigins });
const app = buildApp({ auth, allowedOrigins });
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '127.0.0.1' });
