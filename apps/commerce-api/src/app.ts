import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import type { Auth } from '@mc/auth';
import {
  ConflictError, ForbiddenError, isUuid, NotFoundError, withOperator, withStore, withUser, type StoreRole,
} from '@mc/db';
import {
  BusinessProfileSchema, can, capabilitiesFor, navigationFor, permissionsOf, recommendedModules, type Permission,
} from '@mc/core';

/**
 * trustProxy: solo si hay un proxy conocido delante (p. ej. el balanceador). Determina req.ip, que es la IP
 * que ve el limitador de intentos de Better Auth (RT-R1 H2). Por defecto, la IP del socket.
 */
export type AppOptions = { auth: Auth; allowedOrigins: string[]; logger?: boolean; trustProxy?: boolean | string | string[] };
type SessionUser = { id: string; email: string; name: string; emailVerified: boolean; token: string };

declare module 'fastify' {
  interface FastifyRequest { user?: SessionUser }
}

const INVITATION_TTL = '7 days';
const FORWARDING_HEADERS = new Set(['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip']);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/**
 * ¿La petición va a una ruta /v1? Se decide por la ruta que eligió el router, nunca por el texto de req.url:
 * el router decodifica la URL (`/%761/me` llega a `/v1/me`) y req.url no (revisión final del PR #1, hallazgo 1).
 */
const isV1Route = (req: FastifyRequest) => req.routeOptions.url?.startsWith('/v1/') ?? false;

function requirePermission(role: StoreRole, p: Permission) {
  if (!can(role, p)) throw new ForbiddenError(`MISSING_PERMISSION:${p}`);
}

export function buildApp(opts: AppOptions) {
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    bodyLimit: 256 * 1024,
    trustProxy: opts.trustProxy ?? false,
  });

  // Cabeceras de seguridad básicas para una API JSON.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
  });

  // CSRF: las mutaciones solo con JSON y, si hay Origin, debe ser uno permitido.
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && !opts.allowedOrigins.includes(origin)) return reply.code(403).send({ error: 'ORIGIN_NOT_ALLOWED' });
    if (isV1Route(req) && req.headers['content-type']?.split(';')[0] !== 'application/json'
        && req.method !== 'DELETE') {
      return reply.code(415).send({ error: 'JSON_REQUIRED' });
    }
  });

  // --- Better Auth montado en /api/auth/* -----------------------------------------------------
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (req, reply) => {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || FORWARDING_HEADERS.has(k)) continue;
        headers.append(k, Array.isArray(v) ? v.join(', ') : String(v));
      }
      // La IP que ve Better Auth (límite de intentos) la decide el servidor, nunca el cliente (RT-R1 H2).
      headers.set('x-forwarded-for', req.ip);
      const res = await opts.auth.handler(new Request(url, {
        method: req.method,
        headers,
        body: req.method === 'POST' && req.body !== undefined ? JSON.stringify(req.body) : undefined,
      }));
      reply.status(res.status);
      res.headers.forEach((value, key) => { if (key !== 'set-cookie') reply.header(key, value); });
      const cookies = res.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(res.body ? Buffer.from(await res.arrayBuffer()) : null);
    },
  });

  // --- Sesión obligatoria para /v1 ------------------------------------------------------------
  app.addHook('preHandler', async (req, reply) => {
    if (!isV1Route(req)) return;
    const headers = new Headers();
    if (req.headers.cookie) headers.set('cookie', req.headers.cookie);
    const s = await opts.auth.api.getSession({ headers });
    if (!s?.user) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (!s.user.emailVerified) return reply.code(403).send({ error: 'EMAIL_NOT_VERIFIED' });
    req.user = { id: s.user.id, email: s.user.email, name: s.user.name, emailVerified: s.user.emailVerified, token: s.session.token };
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (err instanceof ForbiddenError) return reply.code(403).send({ error: 'FORBIDDEN', detail: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: 'CONFLICT', detail: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 401) return reply.code(401).send({ error: 'UNAUTHENTICATED' });
    if (status && status < 500) return reply.code(status).send({ error: 'BAD_REQUEST' });
    req.log.error({ err }, 'error no controlado');
    return reply.code(500).send({ error: 'INTERNAL' });
  });

  // Si una ruta llegara aquí sin pasar por el preHandler de sesión, responde 401 en lugar de fallar con un 500.
  const user = (req: FastifyRequest): SessionUser => {
    if (!req.user) throw Object.assign(new Error('UNAUTHENTICATED'), { statusCode: 401 });
    return req.user;
  };
  const storeIdParam = z.object({ storeId: z.string() });

  app.get('/health', async () => ({ ok: true }));

  // --- Usuario y organizaciones ---------------------------------------------------------------
  app.get('/v1/me', async (req) => {
    const u = user(req);
    return withUser(u.token, async (c) => {
      const orgs = await c.query(`SELECT o.id, o.name, m.role FROM control.organizations o
        JOIN control.organization_members m ON m.org_id = o.id AND m.user_id = control.current_user_id() ORDER BY o.created_at`);
      const stores = await c.query(`SELECT s.id, s.org_id AS "orgId", s.name, s.slug, m.role FROM control.stores s
        JOIN control.store_members m ON m.store_id = s.id AND m.user_id = control.current_user_id() ORDER BY s.created_at`);
      const op = await c.query('SELECT 1 FROM control.platform_operators WHERE user_id = control.current_user_id()');
      return { user: { id: u.id, email: u.email, name: u.name }, organizations: orgs.rows, stores: stores.rows, platformOperator: !!op.rowCount };
    });
  });

  app.post('/v1/organizations', async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(80) }).strict().parse(req.body);
    const id = uuidv7();
    await withUser(user(req).token, (c) => c.query('SELECT control.create_organization($1, $2)', [id, body.name]));
    return reply.code(201).send({ id, name: body.name });
  });

  // --- Tiendas -------------------------------------------------------------------------------
  const CreateStore = z.object({
    name: z.string().trim().min(2).max(80),
    slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/),
    country: z.string().regex(/^[A-Z]{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    profile: BusinessProfileSchema,
  }).strict();

  app.post('/v1/organizations/:orgId/stores', async (req, reply) => {
    const { orgId } = z.object({ orgId: z.string() }).parse(req.params);
    const body = CreateStore.parse(req.body);
    if (!isUuid(orgId)) throw new NotFoundError();
    const id = uuidv7();
    const caps = capabilitiesFor(body.profile);
    await withUser(user(req).token, (c) => c.query('SELECT control.create_store($1, $2, $3, $4, $5, $6, $7, $8)',
      [id, orgId, body.name, body.slug, body.country, body.currency, JSON.stringify(body.profile), caps]));
    return reply.code(201).send({ id, slug: body.slug, capabilities: caps, recommendedModules: recommendedModules(caps) });
  });

  app.get('/v1/stores/:storeId', async (req) => {
    const { storeId } = storeIdParam.parse(req.params);
    return withStore(user(req).token, storeId, async (c, role) => {
      const s = await c.query('SELECT id, org_id AS "orgId", name, slug, country, currency, status, cell FROM control.stores WHERE id = $1', [storeId]);
      const st = await c.query('SELECT business_profile AS "businessProfile", capabilities FROM commerce.store_settings');
      return { ...s.rows[0], ...st.rows[0], role, permissions: permissionsOf(role) };
    });
  });

  app.patch('/v1/stores/:storeId', async (req) => {
    const { storeId } = storeIdParam.parse(req.params);
    const body = z.object({
      name: z.string().trim().min(2).max(80).optional(),
      country: z.string().regex(/^[A-Z]{2}$/).optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
      capabilities: z.array(z.enum(['physical-products', 'digital-products', 'inventory', 'variants', 'shipping', 'international', 'dropshipping', 'returns'])).max(8).optional(),
    }).strict().parse(req.body);
    return withStore(user(req).token, storeId, async (c, role) => {
      requirePermission(role, 'settings:write');
      if (body.name || body.country || body.currency) {
        await c.query('SELECT control.update_store($1, $2, $3, $4)', [storeId, body.name ?? null, body.country ?? null, body.currency ?? null]);
      }
      if (body.capabilities) {
        await c.query('UPDATE commerce.store_settings SET capabilities = $1, updated_at = now()', [[...new Set(body.capabilities)]]);
        await c.query(`INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id, metadata)
          VALUES (commerce.current_tenant(), control.current_user_id(), 'settings.capabilities_changed', 'store', $1, $2)`,
          [storeId, JSON.stringify({ capabilities: body.capabilities })]);
      }
      return { ok: true };
    });
  });

  app.get('/v1/stores/:storeId/navigation', async (req) => {
    const { storeId } = storeIdParam.parse(req.params);
    return withStore(user(req).token, storeId, async (c, role) => {
      const st = await c.query('SELECT capabilities FROM commerce.store_settings');
      return { items: navigationFor(role, st.rows[0]?.capabilities ?? []) };
    });
  });

  // --- Equipo, invitaciones y auditoría ------------------------------------------------------
  app.get('/v1/stores/:storeId/members', async (req) => {
    const { storeId } = storeIdParam.parse(req.params);
    return withStore(user(req).token, storeId, async (c, role) => {
      requirePermission(role, 'members:read');
      const m = await c.query('SELECT user_id AS "userId", name, email, role FROM control.member_directory($1)', [storeId]);
      const inv = await c.query(`SELECT id, email, role, expires_at AS "expiresAt" FROM control.invitations
        WHERE store_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at`, [storeId]);
      return { members: m.rows, pendingInvitations: inv.rows };
    });
  });

  app.post('/v1/stores/:storeId/invitations', async (req, reply) => {
    const { storeId } = storeIdParam.parse(req.params);
    const body = z.object({ email: z.email().max(254), role: z.enum(['admin', 'staff']) }).strict().parse(req.body);
    const token = randomBytes(32).toString('base64url');
    const id = uuidv7();
    await withStore(user(req).token, storeId, async (c, role) => {
      requirePermission(role, 'members:invite');
      await c.query('SELECT control.create_invitation($1, $2, $3, $4, $5, $6::interval)',
        [id, storeId, body.email.toLowerCase(), body.role, sha256(token), INVITATION_TTL]);
    });
    // El token solo se devuelve una vez; en BD se guarda su hash. En R2 se envía por email en lugar de devolverlo.
    return reply.code(201).send({ id, token });
  });

  app.delete('/v1/stores/:storeId/invitations/:invitationId', async (req, reply: FastifyReply) => {
    const { storeId, invitationId } = z.object({ storeId: z.string(), invitationId: z.string() }).parse(req.params);
    if (!isUuid(invitationId)) throw new NotFoundError();
    await withStore(user(req).token, storeId, async (c, role) => {
      requirePermission(role, 'members:invite');
      await c.query('SELECT control.revoke_invitation($1, $2)', [storeId, invitationId]);
    });
    return reply.code(204).send();
  });

  app.post('/v1/invitations/accept', async (req) => {
    const body = z.object({ token: z.string().min(20).max(200) }).strict().parse(req.body);
    const u = user(req);
    const storeId = await withUser(u.token, async (c) =>
      (await c.query('SELECT control.accept_invitation($1) AS id', [sha256(body.token)])).rows[0].id as string);
    return { storeId };
  });

  app.patch('/v1/stores/:storeId/members/:userId', async (req) => {
    const { storeId, userId } = z.object({ storeId: z.string(), userId: z.string().min(1).max(100) }).parse(req.params);
    const body = z.object({ role: z.enum(['owner', 'admin', 'staff']) }).strict().parse(req.body);
    await withStore(user(req).token, storeId, async (c, role) => {
      requirePermission(role, 'members:manage');
      await c.query('SELECT control.set_member_role($1, $2, $3)', [storeId, userId, body.role]);
    });
    return { ok: true };
  });

  app.delete('/v1/stores/:storeId/members/:userId', async (req, reply: FastifyReply) => {
    const { storeId, userId } = z.object({ storeId: z.string(), userId: z.string().min(1).max(100) }).parse(req.params);
    await withStore(user(req).token, storeId, (c) => c.query('SELECT control.remove_member($1, $2)', [storeId, userId]));
    return reply.code(204).send();
  });

  app.get('/v1/stores/:storeId/audit', async (req) => {
    const { storeId } = storeIdParam.parse(req.params);
    return withStore(user(req).token, storeId, async (c, role) => {
      requirePermission(role, 'audit:read');
      const r = await c.query(`SELECT action, actor_user_id AS "actorUserId", target_type AS "targetType", target_id AS "targetId",
        metadata, at FROM commerce.audit_events ORDER BY at DESC, id DESC LIMIT 100`);
      return { events: r.rows };
    });
  });

  // --- Plataforma (operadores) ---------------------------------------------------------------
  app.get('/v1/platform/stores', async (req) => {
    const u = user(req);
    return withOperator(u.token, async (c) => {
      const op = await c.query('SELECT 1 FROM control.platform_operators WHERE user_id = control.current_user_id()');
      if (!op.rowCount) throw new NotFoundError();
      await c.query("INSERT INTO control.platform_audit (operator_id, action) VALUES (control.current_user_id(), 'platform.stores.list')");
      const r = await c.query(`SELECT s.id, s.name, s.slug, s.status, s.cell, s.created_at AS "createdAt", o.name AS "organization"
        FROM control.stores s JOIN control.organizations o ON o.id = s.org_id ORDER BY s.created_at DESC LIMIT 200`);
      return { stores: r.rows };
    });
  });

  return app;
}
