import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { newEmail, seedVerifiedUser, watch } from '../support/helpers.ts';
import { OUTBOX } from '../playwright.config.ts';

/**
 * Hito 2 en navegador real: el comerciante personaliza su tienda (color, logo, portada y textos) y el comprador
 * entra por el subdominio de la tienda (<slug>.plataforma.test), compra y recibe los emails. Las rutas del
 * panel no existen en el subdominio. Capturas en SHOTS_DIR si está definido.
 */
test.describe.configure({ mode: 'serial' });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SHOTS = process.env.SHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

const id = Date.now().toString(36);
const storeName = `Velas ${id}`;
const slug = `velas-${id}`;
const STORE = `http://${slug}.plataforma.test:3000`;
const buyerEmail = newEmail('buyer');
let owner: Page;
let storeUrl = '';

const mails = () => existsSync(OUTBOX)
  ? readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { kind: string; to: string; url: string; subject: string })
  : [];

test('comerciante: personaliza el diseño y ve la dirección propia de su tienda', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedVerifiedUser('Vera Velas', newEmail('velas'), ctx);
  owner = await ctx.newPage();
  const w = watch(owner, []);
  await owner.goto('/onboarding');
  await owner.getByLabel('Nombre de la tienda').fill(storeName);
  await owner.getByRole('button', { name: 'Continuar' }).click();
  await owner.getByRole('button', { name: 'Continuar' }).click();
  await owner.getByRole('button', { name: 'Crear tienda' }).click();
  await owner.getByRole('button', { name: 'Ir al panel' }).click();
  await expect(owner).toHaveURL(/\/stores\/[0-9a-f-]{36}$/);
  storeUrl = new URL(owner.url()).pathname;
  await expect(owner.getByText(`${slug}.plataforma.test:3000`).first()).toBeVisible();

  await owner.goto(`${storeUrl}/products/new`);
  await owner.getByLabel('Nombre').fill('Vela de lavanda');
  await owner.getByLabel('Precio', { exact: true }).fill('14,90');
  await owner.getByLabel('Stock').fill('8');
  await owner.getByRole('button', { name: 'Guardar' }).click();
  await expect(owner).toHaveURL(/\?creado=1$/);

  await owner.goto(`${storeUrl}/settings`);
  const venta = owner.getByRole('form', { name: 'Venta online' });
  await venta.getByText('Tienda publicada').click();
  await venta.getByLabel('Email de la tienda').fill('avisos-velas@e2e.local');
  await venta.getByRole('button', { name: 'Guardar venta online' }).click();
  await expect(owner.getByText('Guardado. Tu tienda está abierta al público.')).toBeVisible();

  // Cobros: en esta instalación de pruebas los pagos son simulados.
  await expect(owner.getByRole('region', { name: 'Cobros' }).getByText('Modo de prueba')).toBeVisible();

  const diseño = owner.getByRole('form', { name: 'Diseño de la tienda' });
  await diseño.getByLabel('Logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(diseño.getByRole('button', { name: 'Quitar' })).toBeVisible();
  await diseño.locator('input[maxlength="7"]').fill('#0f766e');
  await diseño.getByLabel('Titular').fill('Velas hechas a mano');
  await diseño.getByLabel('Subtítulo').fill('Cera de soja y aromas naturales');
  await diseño.getByRole('button', { name: 'Guardar diseño' }).click();
  await expect(owner.getByText('Diseño guardado. Ya se ve en tu tienda.')).toBeVisible();
  await shot(owner, '10-ajustes-diseno');
  expect(w.unexpected).toEqual([]);
});

test('comprador: entra por el subdominio, ve la marca y compra', async ({ browser }) => {
  const buyer = await (await browser.newContext()).newPage();
  const w = watch(buyer, []);
  await buyer.goto(`${STORE}/`);
  await expect(buyer.getByRole('heading', { name: 'Velas hechas a mano' })).toBeVisible();
  await expect(buyer.getByText('Cera de soja y aromas naturales')).toBeVisible();
  await expect(buyer.getByRole('banner').locator('img')).toBeVisible();   // logo
  // El color de la marca se aplica a los botones y enlaces.
  expect(await buyer.locator('div[style*="--accent"]').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--accent').trim())).toBe('#0f766e');
  await shot(buyer, '11-tienda-subdominio');

  await buyer.getByRole('link', { name: /Vela de lavanda/ }).click();
  await expect(buyer).toHaveURL(`${STORE}/producto/vela-de-lavanda`);
  await buyer.getByRole('button', { name: 'Añadir al carrito' }).click();
  await buyer.getByRole('link', { name: 'Ver carrito y pagar' }).click();
  await expect(buyer).toHaveURL(`${STORE}/carrito`);
  await buyer.getByLabel('Email').fill(buyerEmail);
  await buyer.getByLabel('Nombre y apellidos').fill('Berta Compradora');
  await buyer.getByLabel('Dirección').fill('Gran Vía 2');
  await buyer.getByLabel('Código postal').fill('48001');
  await buyer.getByLabel('Ciudad').fill('Bilbao');
  await buyer.getByRole('button', { name: /^Pagar/ }).click();
  await expect(buyer).toHaveURL(new RegExp(`^${STORE.replace(/\./g, '\\.')}/pedido/[0-9a-f-]{36}\\?t=`));
  await buyer.getByRole('button', { name: /\(simulado\)/ }).click();
  await expect(buyer.getByText('Pago confirmado')).toBeVisible();
  await shot(buyer, '12-pedido-subdominio');

  // Los emails de confirmación salen al comprador y al comerciante.
  await expect.poll(() => mails().filter((m) => (m.to === buyerEmail && m.kind === 'order-confirmation') || (m.to === 'avisos-velas@e2e.local' && m.kind === 'new-order')).length).toBe(2);
  expect(mails().find((m) => m.to === buyerEmail && m.kind === 'order-confirmation')!.url).toMatch(new RegExp(`^${STORE.replace(/\./g, '\\.')}/pedido/`));
  expect(w.unexpected).toEqual([]);
});

test('el subdominio de una tienda no sirve el panel ni otras tiendas', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const r = await page.goto(`${STORE}/login`);
  expect(new URL(page.url()).host).toBe('plataforma.test:3000');   // redirige al dominio principal
  expect(r?.request().redirectedFrom()).toBeTruthy();
  // (Peticiones desde el navegador: es quien resuelve *.plataforma.test a esta máquina.)
  expect((await page.goto(`${STORE}/tienda/otra-tienda`))?.status()).toBe(404);
  expect((await page.goto(`http://no-existe-${id}.plataforma.test:3000/`))?.status()).toBe(404);
});

test('comerciante: al marcar como enviado, el comprador recibe el aviso', async () => {
  await owner.goto(`${storeUrl}/orders`);
  await owner.getByRole('link', { name: '#1' }).click();
  await owner.getByRole('button', { name: 'Marcar como enviado' }).click();
  await owner.getByRole('button', { name: 'Confirmar' }).click();
  await expect(owner.getByText('Pedido marcado como enviado.')).toBeVisible();
  await expect.poll(() => mails().some((m) => m.to === buyerEmail && m.kind === 'order-shipped')).toBe(true);
});
