import http from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { createVerifiedUser, newEmail, PASSWORD, signUp, verifyInNewTab, watch } from '../support/helpers.ts';

/**
 * Recorridos de R1 en navegador real contra API + panel. Las pruebas comparten la tienda del propietario,
 * así que van en serie. Cualquier error de navegación no declarado como esperado hace fallar la prueba.
 */
test.describe.configure({ mode: 'serial' });

const ME_401 = { method: 'GET', path: /^\/v1\/me$/, status: 401 };
const ACCEPT_401 = { method: 'POST', path: /^\/v1\/invitations\/accept$/, status: 401 };
const ACCEPT_404 = { method: 'POST', path: /^\/v1\/invitations\/accept$/, status: 404 };

let owner: Page;
let storeUrl = '';
let storeId = '';

async function invite(email: string, role: 'Administrador' | 'Personal') {
  await owner.goto(`${storeUrl}/team`);
  const form = owner.locator('form', { has: owner.getByRole('button', { name: 'Invitar' }) });
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Rol').selectOption({ label: role });
  await form.getByRole('button', { name: 'Invitar' }).click();
  const link = owner.locator('input[value*="/invitations/accept#"]');
  await expect(link).toBeVisible();
  const value = await link.inputValue();
  expect(value).toMatch(/^http:\/\/localhost:3000\/invitations\/accept#[A-Za-z0-9_-]{20,}$/);
  await expect(owner.locator('li', { hasText: email })).toBeVisible();
  return new URL(value).pathname + new URL(value).hash;
}

async function navLabels(page: Page) {
  return (await page.locator('aside nav a').allInnerTexts()).map((s) => s.trim());
}

test('propietario: registro, verificación, onboarding y panel', async ({ browser }) => {
  const ctx = await browser.newContext();
  owner = await ctx.newPage();
  const w = watch(owner, [ME_401]);
  const email = newEmail('owner');
  await owner.goto('/');
  await expect(owner).toHaveURL(/\/login$/);
  await signUp(owner, 'Olga Propietaria', email);
  const { tab, url } = await verifyInNewTab(ctx, email);
  expect(url).toMatch(/^http:\/\/localhost:3000\/api\/auth\/verify-email\?token=/); // el enlace apunta al panel
  const wt = watch(tab, []);
  await tab.goto(url);
  await expect(tab).toHaveURL(/\/onboarding$/);
  expect(wt.unexpected).toEqual([]);
  await tab.close();
  await owner.goto('/onboarding');
  await owner.getByLabel('Nombre de la tienda').fill(`Moda E2E ${Date.now().toString(36)}`);
  await owner.getByRole('button', { name: 'Crear tienda' }).click();
  await owner.getByRole('button', { name: 'Ir al panel' }).click();
  await expect(owner).toHaveURL(/\/stores\/[0-9a-f-]{36}$/);
  storeUrl = new URL(owner.url()).pathname;
  storeId = storeUrl.split('/').pop()!;
  await expect(owner.getByRole('heading', { name: /Hola, bienvenido/ })).toBeVisible();
  expect(await navLabels(owner)).toEqual(expect.arrayContaining(['Equipo', 'Actividad', 'Ajustes']));
  expect(w.unexpected).toEqual([]);
});

test('invitación sin sesión → cuenta nueva → verificación en otra pestaña → acepta → vista de personal', async ({ browser }) => {
  const email = newEmail('staff');
  const path = await invite(email, 'Personal');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const w = watch(page, [ACCEPT_401]);
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?invite=1$/);
  await expect(page.getByText('Después la aceptaremos automáticamente')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pendingInvite') ?? 'null')?.path)).toBe(path);
  await signUp(page, 'Pablo Personal', email);

  const { tab, url } = await verifyInNewTab(ctx, email);
  const wt = watch(tab, []);
  await tab.goto(url);
  await expect(tab).toHaveURL(new RegExp(`/stores/${storeId}$`));
  await expect(tab.getByText('Personal', { exact: false }).first()).toBeVisible();
  const nav = await navLabels(tab);
  expect(nav).toContain('Productos');
  for (const hidden of ['Equipo', 'Actividad', 'Ajustes']) expect(nav).not.toContain(hidden);
  expect(await tab.evaluate(() => localStorage.getItem('pendingInvite'))).toBeNull();
  // Permisos del invitado, comprobados contra la API con su propia sesión
  for (const p of ['members', 'audit']) expect((await tab.request.get(`/v1/stores/${storeId}/${p}`)).status()).toBe(403);
  expect((await tab.request.patch(`/v1/stores/${storeId}`, { data: { name: 'hack' }, headers: { origin: 'http://localhost:3000' } })).status()).toBe(403);
  expect((await tab.request.get(`/v1/stores/${storeId}`)).status()).toBe(200);
  expect([...w.unexpected, ...wt.unexpected]).toEqual([]);

  // El propietario ya no la ve como pendiente y la ve como miembro
  await owner.goto(`${storeUrl}/team`);
  await expect(owner.getByText(email).first()).toBeVisible();
  await expect(owner.locator('h3', { hasText: 'Pendientes' }).locator('..').locator('li', { hasText: email })).toHaveCount(0);
});

test('invitación sin sesión → usuario existente inicia sesión → acepta como administrador', async ({ browser }) => {
  const email = newEmail('existing');
  await createVerifiedUser(await browser.newContext(), 'Elena Existente', email);
  const path = await invite(email, 'Administrador');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const w = watch(page, [ACCEPT_401]);
  await page.goto(path);
  await expect(page).toHaveURL(/\/login\?invite=1$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`/stores/${storeId}$`));
  expect(await navLabels(page)).toEqual(expect.arrayContaining(['Equipo', 'Actividad', 'Ajustes']));
  expect(await page.evaluate(() => localStorage.getItem('pendingInvite'))).toBeNull();
  expect(w.unexpected).toEqual([]);
});

test('revocación: el enlace revocado no da acceso y se informa al invitado', async ({ browser }) => {
  const email = newEmail('revoked');
  const ctxInvitee = await browser.newContext();
  await createVerifiedUser(ctxInvitee, 'Rita Revocada', email);
  const path = await invite(email, 'Personal');
  const ow = watch(owner, []);
  await owner.locator('li', { hasText: email }).getByRole('button', { name: 'Revocar' }).click();
  await expect(owner.locator('li', { hasText: email })).toHaveCount(0);
  expect(ow.unexpected).toEqual([]);

  const page = await ctxInvitee.newPage();
  const w = watch(page, [ACCEPT_404]);
  await page.goto(path);
  await expect(page.getByText('No se pudo aceptar la invitación')).toBeVisible();
  expect(w.seen).toEqual(['POST /v1/invitations/accept → 404']);
  expect(await page.evaluate(() => localStorage.getItem('pendingInvite'))).toBeNull();
  expect((await page.request.get(`/v1/stores/${storeId}`)).status()).toBe(404);
  const me = await (await page.request.get('/v1/me')).json();
  expect(me.stores).toEqual([]);
  expect(w.unexpected).toEqual([]);

  await owner.goto(`${storeUrl}/audit`);
  await expect(owner.getByText('Invitación revocada').first()).toBeVisible();
});

test('vista móvil del panel sin desbordamiento horizontal', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await owner.context().storageState() });
  const page = await ctx.newPage();
  const w = watch(page, []);
  await page.goto(storeUrl);
  await expect(page.getByRole('button', { name: 'Menú' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(w.unexpected).toEqual([]);
});

/** Petición de login desde una IP local concreta (127.0.0.x) a través del panel, como haría otro usuario. */
function signIn(localAddress: string, xff?: string) {
  return new Promise<number>((resolve, reject) => {
    const body = JSON.stringify({ email: `nadie-${localAddress}@e2e.local`, password: 'incorrecta-123' });
    const req = http.request({
      host: '127.0.0.1', port: 3000, path: '/api/auth/sign-in/email', method: 'POST', localAddress,
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'content-length': Buffer.byteLength(body), ...(xff ? { 'x-forwarded-for': xff } : {}) },
    }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode ?? 0)); });
    req.on('error', reject);
    req.end(body);
  });
}

test('límite de intentos a través del panel: por IP real y sin poder falsificar X-Forwarded-For', async () => {
  const a: number[] = [];
  for (let i = 0; i < 7; i++) a.push(await signIn('127.0.0.2', `203.0.113.${i}, 198.51.100.${i}`));
  expect(a).toEqual([401, 401, 401, 401, 401, 429, 429]);
  // Otro usuario (otra IP) no hereda el bloqueo, ni aunque diga venir de la IP bloqueada
  expect(await signIn('127.0.0.3')).toBe(401);
  expect(await signIn('127.0.0.4', '127.0.0.2')).toBe(401);
});

test('cadena de confianza del panel con un balanceador delante (PANEL_TRUST_PROXY)', async () => {
  process.env.PANEL_SERVER_NO_LISTEN = '1';
  process.env.PANEL_TRUST_PROXY = '10.0.0.0/8';
  const { clientIp } = await import('../../../apps/merchant-admin/server.mjs');
  expect(clientIp('203.0.113.9', '1.2.3.4')).toBe('203.0.113.9');            // cliente directo: XFF ignorado
  expect(clientIp('10.0.0.5', '6.6.6.6, 198.51.100.7')).toBe('198.51.100.7'); // vía balanceador: la IP que añadió
  expect(clientIp('10.0.0.5', '198.51.100.7, 10.0.0.9')).toBe('198.51.100.7'); // dos saltos de confianza
  expect(clientIp('::ffff:10.0.0.5', 'basura, 198.51.100.8')).toBe('198.51.100.8');
});
