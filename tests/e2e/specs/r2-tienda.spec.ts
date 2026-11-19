import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { newEmail, seedVerifiedUser, watch } from '../support/helpers.ts';

/**
 * Hito 1 en navegador real: un comerciante crea su tienda, sube un producto con foto, publica la tienda,
 * un comprador anónimo compra con el pago simulado y el pedido aparece en el panel para marcarlo como enviado.
 * Si SHOTS_DIR está definido, guarda capturas de cada paso (para enseñar el recorrido).
 */
test.describe.configure({ mode: 'serial' });

// PNG 1×1 válido (la API comprueba los bytes mágicos, no solo la extensión).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SHOTS = process.env.SHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const id = Date.now().toString(36);
const storeName = `Tienda E2E ${id}`;
const slug = `tienda-e2e-${id}`;
let owner: Page;
let storeUrl = '';

test('comerciante: crea la tienda, añade un producto con foto y publica', async ({ browser }) => {
  const ctx = await browser.newContext();
  await seedVerifiedUser('Frida Comerciante', newEmail('merchant'), ctx);
  owner = await ctx.newPage();
  const w = watch(owner, []);
  await owner.goto('/onboarding');
  await owner.getByLabel('Nombre de la tienda').fill(storeName);
  await expect(owner.getByLabel('Dirección')).toHaveValue(slug);
  await owner.getByRole('button', { name: 'Continuar' }).click();
  await owner.getByRole('button', { name: 'Continuar' }).click();
  await owner.getByRole('button', { name: 'Crear tienda' }).click();
  await owner.getByRole('button', { name: 'Ir al panel' }).click();
  await expect(owner).toHaveURL(/\/stores\/[0-9a-f-]{36}$/);
  storeUrl = new URL(owner.url()).pathname;
  await shot(owner, '01-panel-inicio');

  // Producto con dos opciones.
  await owner.goto(`${storeUrl}/products`);
  await owner.getByRole('link', { name: 'Añadir producto' }).click();
  await owner.getByLabel('Nombre').fill('Camiseta de algodón');
  await owner.getByLabel('Descripción').fill('100 % algodón orgánico. Lavar a 30 grados.');
  await owner.getByLabel('Opción', { exact: true }).fill('M');
  await owner.getByLabel('Precio', { exact: true }).fill('19,90');
  await owner.getByLabel('Stock').fill('5');
  await owner.getByRole('button', { name: 'Añadir opción' }).click();
  await owner.getByLabel('Opción', { exact: true }).nth(1).fill('L');
  await owner.getByLabel('Precio', { exact: true }).nth(1).fill('19,90');
  await owner.getByLabel('Stock').nth(1).fill('3');
  await owner.getByRole('button', { name: 'Guardar' }).click();
  await expect(owner).toHaveURL(/\/products\/[0-9a-f-]{36}\?creado=1$/);
  await expect(owner.getByText('Producto creado. Ahora puedes añadirle fotos.')).toBeVisible();
  await owner.locator('input[type=file]').setInputFiles({ name: 'camiseta.png', mimeType: 'image/png', buffer: PNG });
  await expect(owner.getByRole('button', { name: 'Quitar foto' })).toBeVisible();
  await shot(owner, '02-producto');

  // Publicar con envío 4,95 € y email de avisos.
  await owner.goto(`${storeUrl}/settings`);
  const venta = owner.getByRole('form', { name: 'Venta online' });
  await venta.getByText('Tienda publicada').click();
  await venta.getByLabel(/Tarifa de envío/).fill('4,95');
  await venta.getByLabel('Email de la tienda').fill('avisos@e2e.local');
  await venta.getByRole('button', { name: 'Guardar venta online' }).click();
  await expect(owner.getByText('Guardado. Tu tienda está abierta al público.')).toBeVisible();
  await shot(owner, '03-ajustes-venta');
  expect(w.unexpected).toEqual([]);
});

test('comprador: ve la tienda, añade al carrito y paga (simulado)', async ({ browser }) => {
  const buyer = await (await browser.newContext()).newPage();
  const w = watch(buyer, []);
  await buyer.goto(`/tienda/${slug}`);
  await expect(buyer.getByRole('banner')).toContainText(storeName);
  await shot(buyer, '04-tienda');
  await buyer.getByRole('link', { name: /Camiseta de algodón/ }).first().click();
  await expect(buyer.getByRole('heading', { name: 'Camiseta de algodón' })).toBeVisible();
  await buyer.getByRole('button', { name: 'L', exact: true }).click();
  await buyer.getByLabel('Cantidad').selectOption('2');
  await buyer.getByRole('button', { name: 'Añadir al carrito' }).click();
  await shot(buyer, '05-producto');
  await buyer.getByRole('link', { name: 'Ver carrito y pagar' }).click();
  await expect(buyer.getByTestId('cart-total')).toHaveText(/44,75/); // 2 × 19,90 + 4,95
  await buyer.getByLabel('Email').fill('comprador@e2e.local');
  await buyer.getByLabel('Nombre y apellidos').fill('Carlos Comprador');
  await buyer.getByLabel('Dirección').fill('Calle Mayor 1');
  await buyer.getByLabel('Código postal').fill('28013');
  await buyer.getByLabel('Ciudad').fill('Madrid');
  await shot(buyer, '06-carrito');
  await buyer.getByRole('button', { name: /^Pagar/ }).click();
  // Con dominio de plataforma, la vuelta del pago va al subdominio de la tienda.
  await expect(buyer).toHaveURL(new RegExp(`^http://${slug}\\.plataforma\\.test:3000/pedido/[0-9a-f-]{36}\\?t=`));
  await buyer.getByRole('button', { name: /\(simulado\)/ }).click();
  await expect(buyer.getByText('Pago confirmado')).toBeVisible();
  await expect(buyer.getByRole('heading', { name: '¡Gracias! Pedido #1' })).toBeVisible();
  await expect(buyer.getByTestId('order-total')).toHaveText(/44,75/);
  await shot(buyer, '07-pedido-pagado');
  expect(w.unexpected).toEqual([]);
});

test('comerciante: el pedido aparece en el panel y lo marca como enviado', async () => {
  const w = watch(owner, []);
  await owner.goto(`${storeUrl}/orders`);
  await expect(owner.getByRole('tab', { name: /Por enviar/ })).toContainText('1');
  await shot(owner, '08-pedidos');
  await owner.getByRole('link', { name: '#1' }).click();
  await expect(owner.getByRole('heading', { name: 'Pedido #1' })).toBeVisible();
  await expect(owner.getByText('Carlos Comprador').first()).toBeVisible();
  await expect(owner.getByText('2 × 19,90', { exact: false }).or(owner.getByText(/19,90\s€ × 2/))).toBeVisible();
  await owner.getByRole('button', { name: 'Marcar como enviado' }).click();
  await owner.getByRole('button', { name: 'Confirmar' }).click();
  await expect(owner.getByText('Pedido marcado como enviado.')).toBeVisible();
  await shot(owner, '09-pedido-enviado');

  // El stock se descontó: quedan 1 de L y 5 de M.
  await owner.goto(`${storeUrl}/products`);
  await expect(owner.getByRole('row', { name: /Camiseta de algodón/ })).toContainText('6 en stock');
  expect(w.unexpected).toEqual([]);
});
