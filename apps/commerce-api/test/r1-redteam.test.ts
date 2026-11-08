/** Regresiones de la revisión del Red Team de R1 (docs/release-1/RED-TEAM.md). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStore, makeApp, shutdown, signUp, type Client } from './harness.ts';

const h = makeApp();
let owner: Client;
let store: { orgId: string; storeId: string };

beforeAll(async () => {
  await h.app.ready();
  owner = await signUp(h, 'RtOwner');
  store = await createStore(owner, `rt-${Date.now().toString(36)}`);
});
afterAll(async () => { await shutdown(h.app); });

async function join(role: 'admin' | 'staff', by: Client = owner) {
  const u = await signUp(h, `Rt${role}`);
  const inv = await by.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: u.email, role });
  expect((await u.call('POST', '/v1/invitations/accept', { token: inv.body.token })).status).toBe(200);
  return u;
}
const owners = async () => (await owner.call('GET', `/v1/stores/${store.storeId}/members`)).body.members.filter((m: { role: string }) => m.role === 'owner').length;

describe('H3: regla del último owner bajo concurrencia', () => {
  it('dos owners degradándose a la vez nunca dejan la tienda sin owner', async () => {
    const second = await join('admin');
    for (let i = 0; i < 10; i++) {
      expect((await owner.call('PATCH', `/v1/stores/${store.storeId}/members/${second.id}`, { role: 'owner' })).status).toBe(200);
      const [a, b] = await Promise.all([
        owner.call('PATCH', `/v1/stores/${store.storeId}/members/${second.id}`, { role: 'staff' }),
        second.call('PATCH', `/v1/stores/${store.storeId}/members/${owner.id}`, { role: 'staff' }),
      ]);
      // Se serializan por tienda: uno gana y el otro ya no es owner cuando le toca (403).
      expect([a.status, b.status].sort()).toEqual([200, 403]);
      const left = a.status === 200 ? owner : second;
      const n = (await left.call('GET', `/v1/stores/${store.storeId}/members`)).body.members.filter((m: { role: string }) => m.role === 'owner').length;
      expect(n).toBe(1);
      if (left === second) expect((await second.call('PATCH', `/v1/stores/${store.storeId}/members/${owner.id}`, { role: 'owner' })).status).toBe(200);
    }
    expect((await owner.call('PATCH', `/v1/stores/${store.storeId}/members/${second.id}`, { role: 'staff' })).status).toBe(200);
  });

  it('dos owners quitándose a la vez dejan exactamente uno', async () => {
    const second = await join('admin');
    expect((await owner.call('PATCH', `/v1/stores/${store.storeId}/members/${second.id}`, { role: 'owner' })).status).toBe(200);
    const [a, b] = await Promise.all([
      owner.call('DELETE', `/v1/stores/${store.storeId}/members/${second.id}`),
      second.call('DELETE', `/v1/stores/${store.storeId}/members/${owner.id}`),
    ]);
    expect([a.status, b.status].filter((s) => s === 204)).toHaveLength(1);
    const survivor = a.status === 204 ? owner : second;
    const m = await survivor.call('GET', `/v1/stores/${store.storeId}/members`);
    expect(m.body.members.filter((x: { role: string }) => x.role === 'owner')).toHaveLength(1);
    if (survivor === second) {
      // el owner original fue expulsado: lo restauramos para el resto del fichero
      const inv = await second.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: owner.email, role: 'admin' });
      expect((await owner.call('POST', '/v1/invitations/accept', { token: inv.body.token })).status).toBe(200);
      expect((await second.call('PATCH', `/v1/stores/${store.storeId}/members/${owner.id}`, { role: 'owner' })).status).toBe(200);
      expect((await owner.call('DELETE', `/v1/stores/${store.storeId}/members/${second.id}`)).status).toBe(204);
    }
    expect(await owners()).toBe(1);
  });
});

describe('H4: invitaciones revocables y ligadas a quien invita', () => {
  it('el owner revoca una invitación pendiente: deja de aceptarse y queda auditado', async () => {
    const guest = await signUp(h, 'RtGuest');
    const inv = await owner.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: guest.email, role: 'staff' });
    expect((await owner.call('DELETE', `/v1/stores/${store.storeId}/invitations/${inv.body.id}`)).status).toBe(204);
    expect((await guest.call('POST', '/v1/invitations/accept', { token: inv.body.token })).status).toBe(404);
    expect((await owner.call('DELETE', `/v1/stores/${store.storeId}/invitations/${inv.body.id}`)).status).toBe(404);
    const a = await owner.call('GET', `/v1/stores/${store.storeId}/audit`);
    expect(a.body.events.map((e: { action: string }) => e.action)).toContain('invitation.revoked');
    const m = await owner.call('GET', `/v1/stores/${store.storeId}/members`);
    expect(m.body.pendingInvitations.map((i: { id: string }) => i.id)).not.toContain(inv.body.id);
  });

  it('staff no puede revocar; admin no puede revocar invitaciones de admin', async () => {
    const staff = await join('staff');
    const admin = await join('admin');
    const invAdmin = await owner.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: 'otro-admin@test.local', role: 'admin' });
    expect((await staff.call('DELETE', `/v1/stores/${store.storeId}/invitations/${invAdmin.body.id}`)).status).toBe(403);
    expect((await admin.call('DELETE', `/v1/stores/${store.storeId}/invitations/${invAdmin.body.id}`)).status).toBe(403);
    const invStaff = await owner.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: 'otro-staff@test.local', role: 'staff' });
    expect((await admin.call('DELETE', `/v1/stores/${store.storeId}/invitations/${invStaff.body.id}`)).status).toBe(204);
  });

  it('si quien invitó ya no está en la tienda, su invitación no se puede aceptar', async () => {
    const admin = await join('admin');
    const guest = await signUp(h, 'RtLate');
    const inv = await admin.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: guest.email, role: 'staff' });
    expect(inv.status).toBe(201);
    expect((await owner.call('DELETE', `/v1/stores/${store.storeId}/members/${admin.id}`)).status).toBe(204);
    expect((await guest.call('POST', '/v1/invitations/accept', { token: inv.body.token })).status).toBe(404);
  });
});

describe('N2: una invitación no revive si quien la emitió vuelve a la tienda', () => {
  it('expulsar y readmitir al admin no reactiva su invitación antigua', async () => {
    const admin = await join('admin');
    const guest = await signUp(h, 'RtRevive');
    const inv = await admin.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: guest.email, role: 'staff' });
    expect((await owner.call('DELETE', `/v1/stores/${store.storeId}/members/${admin.id}`)).status).toBe(204);
    const back = await owner.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: admin.email, role: 'admin' });
    expect((await admin.call('POST', '/v1/invitations/accept', { token: back.body.token })).status).toBe(200);
    expect((await guest.call('POST', '/v1/invitations/accept', { token: inv.body.token })).status).toBe(404);
  });
});

describe('H5: restablecer la contraseña cierra las sesiones abiertas', () => {
  it('la sesión anterior deja de valer tras el reset', async () => {
    const u = await signUp(h, 'RtReset');
    const r = await h.app.inject({ method: 'POST', url: '/api/auth/request-password-reset', payload: { email: u.email, redirectTo: '/reset' } });
    expect(r.statusCode).toBe(200);
    const mail = h.outbox.find((m) => m.to === u.email && m.kind === 'reset-password')!;
    const token = new URL(mail.url).pathname.split('/').pop()!;
    const reset = await h.app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { newPassword: 'otra-contraseña-2', token } });
    expect(reset.statusCode).toBe(200);
    expect((await u.call('GET', '/v1/me')).status).toBe(401);
  });
});

describe('H6: entradas raras no producen 500', () => {
  it('orgId con forma de UUID pero inválido → 404', async () => {
    const r = await owner.call('POST', `/v1/organizations/${'-'.repeat(36)}/stores`, { name: 'X tienda', slug: `x-${Date.now().toString(36)}`, country: 'ES', currency: 'EUR', profile: { businessType: 'other', productKinds: 'digital', fulfillment: 'own-inventory', markets: ['ES'], shippingNeeds: 'none', technicalLevel: 'beginner' } });
    expect(r.status).toBe(404);
  });
  it('ID de invitación malformado → 404', async () => {
    expect((await owner.call('DELETE', `/v1/stores/${store.storeId}/invitations/no-es-uuid`)).status).toBe(404);
  });
});

describe('PR#1 (2ª revisión): el email verificado no se puede cambiar desde la API de identidad', () => {
  it('update-user y change-email no cambian email ni emailVerified, y no sirven para aceptar una invitación ajena', async () => {
    const victim = 'victima-' + Date.now() + '@test.local';
    const inv = await owner.call('POST', `/v1/stores/${store.storeId}/invitations`, { email: victim, role: 'admin' });
    expect(inv.status).toBe(201);
    const attacker = await signUp(h, 'RtEmail');
    const o = { origin: 'http://localhost:3000' };
    const u1 = await attacker.call('POST', '/api/auth/update-user', { email: victim, emailVerified: true }, o);
    expect([u1.status, u1.body.code]).toEqual([400, 'EMAIL_CAN_NOT_BE_UPDATED']);
    const u2 = await attacker.call('POST', '/api/auth/change-email', { newEmail: victim }, o);
    expect([u2.status, u2.body.code]).toEqual([400, 'CHANGE_EMAIL_DISABLED']);
    await attacker.call('POST', '/api/auth/update-user', { name: 'Otro', emailVerified: false }, o);
    expect((await attacker.call('GET', '/v1/me')).body.user.email).toBe(attacker.email);
    expect((await attacker.call('GET', '/v1/me')).status).toBe(200);   // sigue verificado
    expect((await attacker.call('POST', '/v1/invitations/accept', { token: inv.body.token })).status).toBe(404);
  });
});
