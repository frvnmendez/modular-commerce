import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { closePools } from '@mc/db';
import { createStore, makeApp, PROFILE, signUp, type Client } from './harness.ts';

const h = makeApp();
let owner: Client;
let store: { orgId: string; storeId: string };
const slug = `moda-${Date.now().toString(36)}`;

beforeAll(async () => {
  await h.app.ready();
  owner = await signUp(h, 'Owner');
  store = await createStore(owner, slug);
});
afterAll(async () => { await h.app.close(); await closePools(); });

describe('Registro y sesión', () => {
  it('sin sesión → 401; con email sin verificar → 403', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    const email = `noverif-${Date.now()}@test.local`;
    const r = await h.app.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: 'contraseña-segura-1', name: 'X' } });
    expect(r.statusCode).toBe(200);
    // Con verificación obligatoria, el registro no crea sesión utilizable
    const cookie = ([] as string[]).concat(r.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect([401, 403]).toContain(me.statusCode);
    const login = await h.app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: 'contraseña-segura-1' } });
    expect(login.statusCode).toBe(403);
  });

  it('contraseña corta rechazada', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email: `c-${Date.now()}@test.local`, password: 'corta', name: 'X' } });
    expect(r.statusCode).toBe(400);
  });

  it('cookie de sesión HttpOnly y SameSite=Lax', async () => {
    const email = `ck-${Date.now()}@test.local`;
    await h.app.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: 'contraseña-segura-1', name: 'X' } });
    const mail = h.outbox.find((m) => m.to === email)!;
    const u = new URL(mail.url);
    const v = await h.app.inject({ method: 'GET', url: u.pathname + u.search });
    const sc = ([] as string[]).concat(v.headers['set-cookie'] ?? []).find((c) => c.includes('session_token'))!;
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Lax/i);
  });

  it('cerrar sesión invalida la cookie', async () => {
    const u = await signUp(h, 'Logout');
    const out = await h.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie: u.cookie, origin: 'http://localhost:3000', 'content-type': 'application/json' }, payload: '{}' });
    expect(out.statusCode).toBe(200);
    expect((await u.call('GET', '/v1/me')).status).toBe(401);
  });
});

describe('Organizaciones y tiendas', () => {
  it('el creador ve su organización y su tienda con rol owner', async () => {
    const me = await owner.call('GET', '/v1/me');
    expect(me.body.organizations).toEqual([expect.objectContaining({ id: store.orgId, role: 'owner' })]);
    expect(me.body.stores).toEqual([expect.objectContaining({ id: store.storeId, slug, role: 'owner' })]);
  });

  it('la tienda queda provisionada: ajustes con perfil y capacidades, y evento de auditoría', async () => {
    const s = await owner.call('GET', `/v1/stores/${store.storeId}`);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ slug, country: 'ES', currency: 'EUR', cell: 'cell-1', role: 'owner' });
    expect(s.body.capabilities).toEqual(['physical-products', 'inventory', 'variants', 'shipping', 'returns']);
    const a = await owner.call('GET', `/v1/stores/${store.storeId}/audit`);
    expect(a.body.events.map((e: { action: string }) => e.action)).toContain('store.created');
  });

  it('slug duplicado → 409; slug inválido o campos extra → 400', async () => {
    const dup = await owner.call('POST', `/v1/organizations/${store.orgId}/stores`, { name: 'Otra', slug, country: 'ES', currency: 'EUR', profile: PROFILE });
    expect(dup.status).toBe(409);
    const bad = await owner.call('POST', `/v1/organizations/${store.orgId}/stores`, { name: 'Otra', slug: 'MAL slug', country: 'ES', currency: 'EUR', profile: PROFILE });
    expect(bad.status).toBe(400);
    const extra = await owner.call('POST', `/v1/organizations/${store.orgId}/stores`, { name: 'Otra', slug: `${slug}-x`, country: 'ES', currency: 'EUR', profile: PROFILE, tenant_id: 'x' });
    expect(extra.status).toBe(400);
  });

  it('si falla el provisionamiento no queda nada a medias (transacción)', async () => {
    const before = (await owner.call('GET', '/v1/me')).body.stores.length;
    // moneda válida por regex pero slug ya usado → la función falla tras validar; nada debe persistir
    await owner.call('POST', `/v1/organizations/${store.orgId}/stores`, { name: 'Dup', slug, country: 'FR', currency: 'EUR', profile: PROFILE });
    expect((await owner.call('GET', '/v1/me')).body.stores.length).toBe(before);
  });

  it('actualizar ajustes queda auditado; la navegación sigue a las capacidades', async () => {
    expect((await owner.call('PATCH', `/v1/stores/${store.storeId}`, { name: 'Moda Nueva', capabilities: ['digital-products'] })).status).toBe(200);
    const nav = await owner.call('GET', `/v1/stores/${store.storeId}/navigation`);
    expect(nav.body.items.map((i: { id: string }) => i.id)).not.toContain('inventory');
    const a = await owner.call('GET', `/v1/stores/${store.storeId}/audit`);
    expect(a.body.events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['store.updated', 'settings.capabilities_changed']));
  });
});

describe('Invitaciones y roles', () => {
  let staff: Client;
  let admin: Client;

  it('owner invita a staff; el invitado acepta y solo ve esa tienda', async () => {
    staff = await signUp(h, 'Staff');
    const inv = await owner.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: staff.email, role: 'staff' });
    expect(inv.status).toBe(201);
    const acc = await staff.call('POST', '/v1/invitations/accept', { token: inv.body.token });
    expect(acc.body).toEqual({ storeId: store.storeId });
    const me = await staff.call('GET', '/v1/me');
    expect(me.body.stores).toEqual([expect.objectContaining({ id: store.storeId, role: 'staff' })]);
    expect(me.body.organizations).toEqual([]);
  });

  it('una invitación no puede usarla otra persona, ni dos veces', async () => {
    admin = await signUp(h, 'Admin');
    const intruder = await signUp(h, 'Intruso');
    const inv = await owner.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: admin.email, role: 'admin' });
    expect((await intruder.call('POST', '/v1/invitations/accept', { token: inv.body.token })).status).toBe(404);
    expect((await admin.call('POST', '/v1/invitations/accept', { token: inv.body.token })).status).toBe(200);
    expect((await admin.call('POST', '/v1/invitations/accept', { token: inv.body.token })).status).toBe(404);
  });

  it('staff no puede invitar, cambiar roles, ver auditoría ni editar ajustes (403)', async () => {
    expect((await staff.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: 'x@test.local', role: 'staff' })).status).toBe(403);
    expect((await staff.call('PATCH', `/v1/stores/${store.storeId}/members/${staff.id}`, { role: 'owner' })).status).toBe(403);
    expect((await staff.call('GET', `/v1/stores/${store.storeId}/audit`)).status).toBe(403);
    expect((await staff.call('PATCH', `/v1/stores/${store.storeId}`, { name: 'hack' })).status).toBe(403);
    expect((await staff.call('GET', `/v1/stores/${store.storeId}/members`)).status).toBe(403);
  });

  it('admin puede invitar staff pero no admins, ni cambiar roles', async () => {
    expect((await admin.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: 'nuevo@test.local', role: 'staff' })).status).toBe(201);
    expect((await admin.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: 'nuevo2@test.local', role: 'admin' })).status).toBe(403);
    expect((await admin.call('PATCH', `/v1/stores/${store.storeId}/members/${staff.id}`, { role: 'admin' })).status).toBe(403);
  });

  it('no se puede quitar ni degradar al último owner', async () => {
    expect((await owner.call('PATCH', `/v1/stores/${store.storeId}/members/${owner.id}`, { role: 'staff' })).status).toBe(409);
    expect((await owner.call('DELETE', `/v1/stores/${store.storeId}/members/${owner.id}`)).status).toBe(409);
  });

  it('owner cambia el rol de staff a admin; los cambios quedan auditados', async () => {
    expect((await owner.call('PATCH', `/v1/stores/${store.storeId}/members/${staff.id}`, { role: 'admin' })).status).toBe(200);
    const m = await owner.call('GET', `/v1/stores/${store.storeId}/members`);
    expect(m.body.members.find((x: { userId: string }) => x.userId === staff.id).role).toBe('admin');
    const a = await owner.call('GET', `/v1/stores/${store.storeId}/audit`);
    expect(a.body.events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['invitation.created', 'invitation.accepted', 'member.role_changed']));
  });

  it('al quitar a un miembro pierde el acceso inmediatamente (404)', async () => {
    expect((await owner.call('DELETE', `/v1/stores/${store.storeId}/members/${staff.id}`)).status).toBe(204);
    expect((await staff.call('GET', `/v1/stores/${store.storeId}`)).status).toBe(404);
  });
});

describe('Protecciones transversales', () => {
  it('mutación desde un Origin no permitido → 403; sin JSON → 415', async () => {
    expect((await owner.call('POST', '/v1/organizations', { name: 'X org' }, { origin: 'https://evil.example' })).status).toBe(403);
    const r = await h.app.inject({ method: 'POST', url: '/v1/organizations', headers: { cookie: owner.cookie, 'content-type': 'text/plain' }, payload: 'name=x' });
    expect(r.statusCode).toBe(415);
  });

  it('panel de plataforma: un usuario normal recibe 404; un operador lista tiendas y queda auditado', async () => {
    expect((await owner.call('GET', '/v1/platform/stores')).status).toBe(404);
    const op = await signUp(h, 'Operador');
    const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL!.replace(/\/[^/]*$/, `/${process.env.DATABASE_NAME}`) });
    await admin.connect();
    await admin.query('INSERT INTO control.platform_operators (user_id) VALUES ($1)', [op.id]);
    const r = await op.call('GET', '/v1/platform/stores');
    expect(r.status).toBe(200);
    expect(r.body.stores.map((s: { id: string }) => s.id)).toContain(store.storeId);
    const audit = await admin.query("SELECT count(*)::int n FROM control.platform_audit WHERE operator_id = $1 AND action = 'platform.stores.list'", [op.id]);
    expect(audit.rows[0].n).toBe(1);
    await admin.end();
  });
});
