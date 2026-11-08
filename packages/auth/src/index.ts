import { betterAuth } from 'better-auth';
import pg from 'pg';
import { connectionFor } from '@mc/db';

export type MailMessage = { to: string; subject: string; url: string; kind: 'verify-email' | 'reset-password' };
export type Mailer = (m: MailMessage) => Promise<void>;

/**
 * Identidad (registro, login, sesiones, verificación de email) con Better Auth.
 * Usa su propio rol de BD (mc_auth) limitado al esquema auth. Organizaciones, tiendas y roles
 * NO viven aquí: son del plano de control (RLS + funciones auditadas).
 */
const authPools = new Set<pg.Pool>();
export async function closeAuthPools() {
  await Promise.all([...authPools].map((p) => p.end()));
  authPools.clear();
}

export function createAuth(opts: { mailer: Mailer; baseURL: string; secret: string; trustedOrigins?: string[] }) {
  const database = new pg.Pool({ ...connectionFor('auth'), max: 5, options: '-c search_path=auth' });
  authPools.add(database);
  return betterAuth({
    database,
    baseURL: opts.baseURL,
    basePath: '/api/auth',
    secret: opts.secret,
    trustedOrigins: opts.trustedOrigins ?? [],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, url }) => opts.mailer({ to: user.email, subject: 'Restablece tu contraseña', url, kind: 'reset-password' }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => opts.mailer({ to: user.email, subject: 'Verifica tu email', url, kind: 'verify-email' }),
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: process.env.AUTH_RATE_LIMIT !== 'off',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 5 } },
    },
    advanced: {
      useSecureCookies: opts.baseURL.startsWith('https://'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
