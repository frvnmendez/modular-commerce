/**
 * Suite de aislamiento entre tiendas (Gate C). El usuario de la tienda A ataca recursos de la tienda B
 * manipulando IDs en ruta, cuerpo y cabeceras. Esperado: 404 (o 400 por validación) y CERO efectos en B.
 * Ejecutar también con ISOLATION_SABOTAGE=rls-off|permissive|membership: la suite debe FALLAR.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { adminClient, dropDatabase, freshDatabase, sabotage } from './fresh-db.ts';

type Client = import('@mc/commerce-api/testing').Client;
let h: ReturnType<typeof import('@mc/commerce-api/testing').makeApp>;
let dbName: string;
const A = {} as { owner: Client; staff: Client; orgId: string; storeId: string };
const B = {} as { owner: Client; staff: Client; orgId: string; storeId: string; inviteToken: string; inviteId: string };
let snapshotB: string;

async function snapshot(storeId: string) {
  const c = adminClient();
  await c.connect();
  try {
    const parts = await Promise.all([
      c.query('SELECT name, slug, country, currency, status FROM control.stores WHERE id = $1', [storeId]),
      c.query('SELECT user_id, role FROM control.store_members WHERE store_id = $1 ORDER BY user_id', [storeId]),
      c.query('SELECT email, role, accepted_at, revoked_at FROM control.invitations WHERE store_id = $1 ORDER BY id', [storeId]),
      c.query('SELECT business_profile, capabilities FROM commerce.store_settings WHERE tenant_id = $1', [storeId]),
      c.query('SELECT count(*)::int FROM commerce.audit_events WHERE tenant_id = $1', [storeId]),
    ]);
    return JSON.stringify(parts.map((p) => p.rows));
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  dbName = await freshDatabase();
  await sabotage(process.env.ISOLATION_SABOTAGE);
  const t = await import('@mc/commerce-api/testing');
  h = t.makeApp();
  await h.app.ready();
  for (const [T, tag] of [[A, 'a'], [B, 'b']] as const) {
    T.owner = await t.signUp(h, `Owner${tag}`);
    Object.assign(T, await t.createStore(T.owner, `iso-${tag}-${Date.now().toString(36)}`));
    T.staff = await t.signUp(h, `Staff${tag}`);
    const inv = await T.owner.call('POST', `/v1/stores/${T.storeId}/invitations`, { email: T.staff.email, role: 'staff' });
    await T.staff.call('POST', '/v1/invitations/accept', { token: inv.body.token });
  }
  const pending = (await B.owner.call('POST', `/v1/stores/${B.storeId}/invitations`, { email: 'pendiente@test.local', role: 'staff' })).body;
  B.inviteToken = pending.token;
  B.inviteId = pending.id;
  snapshotB = await snapshot(B.storeId);
});

afterAll(async () => {
  const t = await import('@mc/commerce-api/testing');
  if (h) await t.shutdown(h.app);
  await dropDatabase(dbName);
});

describe('Lectura de recursos de otra tienda', () => {
  const reads = (id: () => string) => [
    `/v1/stores/${id()}`, `/v1/stores/${id()}/navigation`, `/v1/stores/${id()}/members`, `/v1/stores/${id()}/audit`,
  ];
  it('owner y staff de A reciben 404 en todos los GET de la tienda B', async () => {
    for (const actor of [A.owner, A.staff]) {
      for (const url of reads(() => B.storeId)) {
        const r = await actor.call('GET', url);
        expect({ url, status: r.status }).toEqual({ url, status: 404 });
      }
    }
  });
  it('/v1/me de A no menciona nada de B', async () => {
    const me = JSON.stringify((await A.owner.call('GET', '/v1/me')).body);
    expect(me).not.toContain(B.storeId);
    expect(me).not.toContain(B.orgId);
  });
  it('IDs malformados, inyección y traversal en la ruta → 404 sin errores 500', async () => {
    for (const bad of ['not-a-uuid', `${B.storeId}' OR '1'='1`, '../' + B.storeId, B.storeId.toUpperCase(), '00000000-0000-0000-0000-000000000000']) {
      const r = await A.owner.call('GET', `/v1/stores/${encodeURIComponent(bad)}`);
      expect({ bad, status: r.status }).toEqual({ bad, status: 404 });
    }
  });
  it('cabeceras de tenant inventadas se ignoran', async () => {
    const r = await A.owner.call('GET', `/v1/stores/${A.storeId}/audit`, undefined, { 'x-tenant-id': B.storeId, 'x-store-id': B.storeId });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(B.storeId);
  });
});

describe('Escritura sobre otra tienda', () => {
  it('A no puede editar, invitar, cambiar roles ni expulsar en B (404) ', async () => {
    const attempts: Array<[string, string, unknown?]> = [
      ['PATCH', `/v1/stores/${B.storeId}`, { name: 'hackeada' }],
      ['PATCH', `/v1/stores/${B.storeId}`, { capabilities: ['dropshipping'] }],
      ['POST', `/v1/stores/${B.storeId}/invitations`, { email: A.staff.email, role: 'staff' }],
      ['PATCH', `/v1/stores/${B.storeId}/members/${B.staff.id}`, { role: 'owner' }],
      ['PATCH', `/v1/stores/${B.storeId}/members/${A.owner.id}`, { role: 'owner' }],
      ['DELETE', `/v1/stores/${B.storeId}/members/${B.staff.id}`],
      ['DELETE', `/v1/stores/${B.storeId}/members/${B.owner.id}`],
      ['DELETE', `/v1/stores/${B.storeId}/invitations/${B.inviteId}`],
    ];
    for (const actor of [A.owner, A.staff]) {
      for (const [m, url, body] of attempts) {
        const r = await actor.call(m, url, body);
        expect({ m, url, status: r.status }).toEqual({ m, url, status: 404 });
      }
    }
  });
  it('A no puede revocar la invitación de B usando su propia tienda en la ruta', async () => {
    expect((await A.owner.call('DELETE', `/v1/stores/${A.storeId}/invitations/${B.inviteId}`)).status).toBe(404);
  });
  it('A no puede crear tiendas en la organización de B', async () => {
    const r = await A.owner.call('POST', `/v1/organizations/${B.orgId}/stores`, {
      name: 'Intrusa', slug: `intrusa-${Date.now().toString(36)}`, country: 'ES', currency: 'EUR',
      profile: { businessType: 'other', productKinds: 'digital', fulfillment: 'own-inventory', markets: ['ES'], shippingNeeds: 'none', technicalLevel: 'beginner' },
    });
    expect(r.status).toBe(404);
  });
  it('A no puede usar la invitación pendiente de B (email distinto)', async () => {
    expect((await A.owner.call('POST', '/v1/invitations/accept', { token: B.inviteToken })).status).toBe(404);
  });
  it('campos de tenant inyectados en el cuerpo se rechazan (400)', async () => {
    for (const body of [{ name: 'x', tenant_id: B.storeId }, { name: 'x', storeId: B.storeId }, { name: 'x', org_id: B.orgId }]) {
      expect((await A.owner.call('PATCH', `/v1/stores/${A.storeId}`, body)).status).toBe(400);
    }
  });
  it('tras todos los ataques, la tienda B está exactamente igual', async () => {
    expect(await snapshot(B.storeId)).toBe(snapshotB);
  });
});

describe('Capa de base de datos (lo que la API podría olvidar)', () => {
  it('mc_app sin contexto no ve ninguna fila de control ni de comercio', async () => {
    const { pool } = await import('@mc/db');
    const counts = await pool('app').query(`SELECT
      (SELECT count(*) FROM control.stores)::int s, (SELECT count(*) FROM control.store_members)::int m,
      (SELECT count(*) FROM control.invitations)::int i, (SELECT count(*) FROM commerce.store_settings)::int st,
      (SELECT count(*) FROM commerce.audit_events)::int a, (SELECT count(*) FROM control.organizations)::int o`);
    expect(counts.rows[0]).toEqual({ s: 0, m: 0, i: 0, st: 0, a: 0, o: 0 });
  });
  it('dentro de la tienda A, una consulta directa no devuelve filas de B aunque se pidan por ID', async () => {
    const { withStore } = await import('@mc/db');
    const r = await withStore(A.owner.token, A.storeId, async (c) => ({
      st: (await c.query('SELECT count(*)::int n FROM commerce.store_settings WHERE tenant_id = $1', [B.storeId])).rows[0].n,
      au: (await c.query('SELECT count(*)::int n FROM commerce.audit_events WHERE tenant_id = $1', [B.storeId])).rows[0].n,
      up: (await c.query('UPDATE commerce.store_settings SET capabilities = $1 WHERE tenant_id = $2', [['x'], B.storeId])).rowCount,
    }));
    expect(r).toEqual({ st: 0, au: 0, up: 0 });
  });
  it('forjar el contexto con set_config no da acceso a otra tienda (RT-R1 H1)', async () => {
    const { pool } = await import('@mc/db');
    const c = await pool('app').connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)", [B.owner.id, B.storeId]);
      const r = await c.query(`SELECT (SELECT count(*) FROM commerce.store_settings)::int st, (SELECT count(*) FROM commerce.audit_events)::int au,
        (SELECT count(*) FROM control.store_members)::int m, control.current_user_id() u, commerce.current_tenant()::text t`);
      expect(r.rows[0]).toEqual({ st: 0, au: 0, m: 0, u: null, t: null });
      await expect(c.query('SELECT control.enter_store($1)', [B.storeId])).rejects.toThrow(/NO_USER_CONTEXT/);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await expect(c.query('SELECT control.begin_session($1)', ['token-inventado'])).rejects.toThrow(/NO_USER_CONTEXT/);
      await c.query('ROLLBACK');
      await expect(c.query('SELECT * FROM control.request_context')).rejects.toThrow(/permission denied/);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      await c.query('DISCARD ALL');
      c.release();
    }
  });
  it('el contexto de una transacción no sirve en la siguiente de la misma conexión', async () => {
    const { pool } = await import('@mc/db');
    const c = await pool('app').connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT control.begin_session($1)', [A.owner.token]);
      await c.query('SELECT control.enter_store($1)', [A.storeId]);
      expect((await c.query('SELECT count(*)::int n FROM commerce.store_settings')).rows[0].n).toBe(1);
      await c.query('COMMIT');
      const r = await c.query('SELECT (SELECT count(*) FROM commerce.store_settings)::int n, control.current_user_id() u');
      expect(r.rows[0]).toEqual({ n: 0, u: null });
    } finally {
      c.release();
    }
  });
  it('auditoría: no se puede firmar como otro usuario; staff no lee el directorio de emails (RT-R1 H6)', async () => {
    const { withStore } = await import('@mc/db');
    await expect(withStore(A.owner.token, A.storeId, (c) => c.query(
      "INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action) VALUES (commerce.current_tenant(), $1, 'x')", [A.staff.id]))).rejects.toThrow(/row-level security/);
    const n = await withStore(A.staff.token, A.storeId, async (c) => (await c.query('SELECT count(*)::int n FROM control.member_directory($1)', [A.storeId])).rows[0].n);
    expect(n).toBe(0);
  });
  it('mc_app no puede aceptar una invitación dirigida a otra cuenta, aunque indique su email (PR#1 hallazgo 1)', async () => {
    const { pool } = await import('@mc/db');
    const hash = createHash('sha256').update(B.inviteToken).digest('hex');
    const c = await pool('app').connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT control.begin_session($1)', [A.owner.token]);
      await expect(c.query('SELECT control.accept_invitation($1)', [hash])).rejects.toThrow(/INVITATION_INVALID/);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query('SELECT control.begin_session($1)', [A.owner.token]);
      // La firma antigua, que recibía el email del llamante, ya no existe.
      await expect(c.query('SELECT control.accept_invitation($1, $2)', [hash, 'pendiente@test.local'])).rejects.toThrow(/does not exist/);
      await c.query('ROLLBACK');
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
    const a = adminClient();
    await a.connect();
    try {
      const r = await a.query(`SELECT (SELECT count(*)::int FROM control.store_members WHERE store_id = $1 AND user_id = $2) m,
        (SELECT accepted_at IS NULL AND revoked_at IS NULL FROM control.invitations WHERE token_hash = $3) pending,
        (SELECT count(*)::int FROM commerce.audit_events WHERE tenant_id = $1 AND actor_user_id = $2) audit`, [B.storeId, A.owner.id, hash]);
      expect(r.rows[0]).toEqual({ m: 0, pending: true, audit: 0 });
    } finally {
      await a.end();
    }
  });
  it('mc_app no puede suplantar la identidad del contexto ni tocar email/emailVerified (PR#1, 2ª revisión)', async () => {
    const { pool } = await import('@mc/db');
    const hash = createHash('sha256').update(B.inviteToken).digest('hex');
    const c = await pool('app').connect();
    const denied = async (sql: string, params: unknown[] = []) => {
      await c.query('SAVEPOINT p');
      await expect(c.query(sql, params)).rejects.toThrow(/permission denied|must be member/);
      await c.query('ROLLBACK TO SAVEPOINT p');
    };
    try {
      await c.query('BEGIN');
      // Escribir el contexto, el email o emailVerified, o cambiar de rol: denegado.
      await denied('INSERT INTO control.request_context (pid, xid, user_id) VALUES (pg_backend_pid(), pg_current_xact_id(), $1)', [B.owner.id]);
      await denied('UPDATE control.request_context SET user_id = $1', [B.owner.id]);
      await denied(`UPDATE auth."user" SET email = 'pendiente@test.local', "emailVerified" = true WHERE id = $1`, [A.owner.id]);
      await denied('INSERT INTO auth.session (id, token, "userId", "expiresAt", "createdAt", "updatedAt") VALUES ($1, $1, $2, now() + interval \'1 day\', now(), now())', ['forjada', B.owner.id]);
      await denied('SET ROLE mc_auth');
      await denied('SET ROLE mc_migrator');
      await denied('CREATE FUNCTION public.current_user_id() RETURNS text LANGUAGE sql AS $$ SELECT \'x\' $$');
      // Ni siquiera puede crear una tabla temporal que intente suplantar a control.request_context.
      await denied('CREATE TEMP TABLE request_context (pid int, xid xid8, user_id text, tenant_id uuid)');
      // Cambiar su search_path tampoco afecta a las funciones SECURITY DEFINER (search_path fijado).
      await c.query("SELECT set_config('search_path', 'pg_temp, public, control, commerce', true)");
      const r = await c.query('SELECT control.current_user_id() u, commerce.current_tenant()::text t, (SELECT count(*) FROM control.store_members)::int m');
      expect(r.rows[0]).toEqual({ u: null, t: null, m: 0 });
      await c.query('SAVEPOINT p');
      await expect(c.query('SELECT control.accept_invitation($1)', [hash])).rejects.toThrow(/NO_USER_CONTEXT/);
      await c.query('ROLLBACK TO SAVEPOINT p');
      await c.query('ROLLBACK');
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      await c.query('DISCARD ALL');
      c.release();
    }
    const a = adminClient();
    await a.connect();
    try {
      // Catálogo: solo mc_auth (y el dueño) puede escribir en auth; nadie salvo el dueño en request_context.
      const w = await a.query(`SELECT r.rolname, t.tbl, has_table_privilege(r.rolname, t.tbl, 'INSERT,UPDATE,DELETE') w
        FROM (VALUES ('mc_app'), ('mc_ops'), ('mc_auth')) r(rolname),
             (VALUES ('auth."user"'), ('auth.session'), ('control.request_context')) t(tbl) ORDER BY 1, 2`);
      const writable = w.rows.filter((x) => x.w).map((x) => `${x.rolname}:${x.tbl}`);
      expect(writable).toEqual(['mc_auth:auth."user"', 'mc_auth:auth.session']);
      const pub = await a.query(`SELECT has_schema_privilege('mc_app', 'public', 'CREATE') app, has_schema_privilege('mc_auth', 'public', 'CREATE') auth,
        (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname IN ('mc_app','mc_ops','mc_auth')) memberships`);
      expect(pub.rows[0]).toEqual({ app: false, auth: false, memberships: 0 });
      const r = await a.query(`SELECT (SELECT email FROM auth."user" WHERE id = $1) e, (SELECT count(*)::int FROM auth.session WHERE id = 'forjada') s`, [A.owner.id]);
      expect(r.rows[0]).toEqual({ e: A.owner.email, s: 0 });
    } finally {
      await a.end();
    }
  });
  it('el servidor rechaza una invitación caducada aunque el email coincida, y la acepta si sigue vigente', async () => {
    const t = await import('@mc/commerce-api/testing');
    const guest = await t.signUp(h, 'Caducada');
    const inv = (await B.owner.call('POST', `/v1/stores/${B.storeId}/invitations`, { email: guest.email, role: 'staff' })).body;
    const a = adminClient();
    await a.connect();
    try {
      await a.query("UPDATE control.invitations SET expires_at = now() - interval '1 second' WHERE id = $1", [inv.id]);
      expect((await guest.call('POST', '/v1/invitations/accept', { token: inv.token })).status).toBe(404);
      const r = await a.query(`SELECT (SELECT count(*)::int FROM control.store_members WHERE user_id = $1) m,
        (SELECT accepted_at IS NULL FROM control.invitations WHERE id = $2) pending`, [guest.id, inv.id]);
      expect(r.rows[0]).toEqual({ m: 0, pending: true });
      // Control positivo: la misma invitación, vigente, sí se acepta (el 404 se debía a la caducidad).
      await a.query("UPDATE control.invitations SET expires_at = now() + interval '1 hour' WHERE id = $1", [inv.id]);
      expect((await guest.call('POST', '/v1/invitations/accept', { token: inv.token })).status).toBe(200);
    } finally {
      await a.end();
    }
  });
  it('mc_app no puede escribir directamente en el plano de control ni borrar auditoría', async () => {
    const { withStore } = await import('@mc/db');
    await expect(withStore(A.owner.token, A.storeId, (c) => c.query("INSERT INTO control.store_members VALUES ($1, 'x', 'owner')", [B.storeId]))).rejects.toThrow(/permission denied/);
    await expect(withStore(A.owner.token, A.storeId, (c) => c.query('DELETE FROM commerce.audit_events'))).rejects.toThrow(/permission denied/);
  });
  it('catálogo: toda tabla de control/comercio con RLS+FORCE; mc_app no es dueño ni BYPASSRLS; sin vistas inseguras', async () => {
    const c = adminClient();
    await c.connect();
    try {
      const t = await c.query(`SELECT n.nspname || '.' || c.relname t, c.relrowsecurity r, c.relforcerowsecurity f, pg_get_userbyid(c.relowner) o
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('control','commerce') AND c.relkind = 'r'`);
      expect(t.rows.length).toBeGreaterThanOrEqual(10);
      for (const row of t.rows) expect({ t: row.t, r: row.r, f: row.f, o: row.o }).toEqual({ t: row.t, r: true, f: true, o: 'mc_migrator' });
      const pols = await c.query(`SELECT tablename, qual FROM pg_policies WHERE schemaname IN ('control','commerce') AND qual = 'true' AND NOT ('mc_ops' = ANY (roles))`);
      expect(pols.rows).toEqual([]);
      // N1: el tenant se compara contra un subselect (InitPlan), nunca función por fila
      const tp = await c.query(`SELECT tablename, qual FROM pg_policies WHERE schemaname = 'commerce' AND policyname = 'tenant_isolation'`);
      expect(tp.rows.length).toBeGreaterThanOrEqual(2);
      for (const r of tp.rows) expect({ t: r.tablename, ok: /\(\s*SELECT commerce\.current_tenant\(\)/i.test(r.qual) }).toEqual({ t: r.tablename, ok: true });
      const roles = await c.query(`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname IN ('mc_app','mc_auth','mc_ops') ORDER BY 1`);
      for (const r of roles.rows) expect({ n: r.rolname, b: r.rolbypassrls, s: r.rolsuper }).toEqual({ n: r.rolname, b: false, s: false });
      const views = await c.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('control','commerce','auth') AND c.relkind IN ('v','m') AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false)`);
      expect(views.rows).toEqual([]);
      const authAccess = await c.query(`SELECT has_table_privilege('mc_app', 'auth."user"', 'SELECT') u, has_table_privilege('mc_app', 'auth.session', 'SELECT') s`);
      expect(authAccess.rows[0]).toEqual({ u: false, s: false });
      const definers = await c.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('control','commerce') AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')`);
      expect(definers.rows).toEqual([]);
    } finally {
      await c.end();
    }
  });
});
