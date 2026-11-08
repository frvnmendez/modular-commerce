import { expect, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { OUTBOX } from '../playwright.config.ts';

export const PASSWORD = 'contraseña-segura-1';
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const newEmail = (tag: string) => `${tag}-${uid()}@e2e.local`;

/** Último email de un tipo enviado a una dirección (outbox de la API). */
export async function mailTo(to: string, kind: 'verify-email' | 'reset-password') {
  let url: string | undefined;
  await expect.poll(() => {
    if (!existsSync(OUTBOX)) return undefined;
    const lines = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { to: string; kind: string; url: string });
    url = lines.reverse().find((m) => m.to === to && m.kind === kind)?.url;
    return url;
  }, { message: `email ${kind} para ${to}`, timeout: 10_000 }).toBeTruthy();
  return url!;
}

/**
 * Registra fallos de navegación: errores de JS, errores de consola y respuestas >= 400.
 * Solo se toleran los que la prueba declara como esperados (método, ruta y código).
 */
const dialogsHandled = new WeakSet<Page>();
export type Expected = { method: string; path: RegExp; status: number };
export function watch(page: Page, expected: Expected[] = []) {
  const unexpected: string[] = [];
  const seen: string[] = [];
  page.on('pageerror', (e) => unexpected.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const u = new URL(r.url());
    const line = `${r.request().method()} ${u.pathname} → ${r.status()}`;
    seen.push(line);
    if (!expected.some((x) => x.method === r.request().method() && x.path.test(u.pathname) && x.status === r.status())) unexpected.push(line);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // "Failed to load resource" duplica una respuesta >= 400 ya evaluada arriba.
    if (/Failed to load resource: the server responded with a status of \d+/.test(m.text())) return;
    unexpected.push(`console: ${m.text()}`);
  });
  if (!dialogsHandled.has(page)) { dialogsHandled.add(page); page.on('dialog', (d) => d.accept()); }
  return { unexpected, seen, expected };
}

export async function signUp(page: Page, name: string, email: string) {
  await page.getByRole('button', { name: '¿No tienes cuenta? Regístrate' }).click();
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByText('Te hemos enviado un enlace de verificación')).toBeVisible();
}

/** Abre el enlace de verificación en OTRA pestaña del mismo navegador, como desde un cliente de correo. */
export async function verifyInNewTab(context: BrowserContext, email: string) {
  const tab = await context.newPage();
  return { tab, url: await mailTo(email, 'verify-email') };
}

/** Cuenta verificada en un contexto propio (para preparar usuarios existentes). */
export async function createVerifiedUser(context: BrowserContext, name: string, email: string) {
  const page = await context.newPage();
  const w = watch(page, [{ method: 'GET', path: /^\/v1\/me$/, status: 401 }]);
  await page.goto('/login');
  await signUp(page, name, email);
  await page.goto(await mailTo(email, 'verify-email'));
  await expect(page).toHaveURL(/\/onboarding$/);
  expect(w.unexpected).toEqual([]);
  await page.close();
}
