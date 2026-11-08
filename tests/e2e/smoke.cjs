// Prueba de humo E2E (fuera de CI): requiere API en :4000 (AUTH_RATE_LIMIT=off) y panel en :3000.
// Uso: node tests/e2e/smoke.cjs <log-de-la-api> <carpeta-capturas>
const { chromium } = require('playwright');
const fs = require('fs');
const LOG = process.argv[2]; const OUT = process.argv[3];
const mailFor = async (email) => { for (let i = 0; i < 40; i++) { const m = fs.readFileSync(LOG, 'utf8').split('\n').reverse().find(l => l.includes(`→ ${email}:`)); if (m) return m.split(': ').pop().trim(); await new Promise(r => setTimeout(r, 250)); } throw new Error('no mail ' + email); };
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
  p.on('dialog', d => d.accept()); p.on('pageerror', e => errors.push(String(e))); p.on('console', m => m.type() === 'error' && errors.push(m.text()));
  const email = `e2e-${Date.now()}@test.local`;
  await p.goto('http://localhost:3000/'); await p.waitForURL(/login/);
  await p.screenshot({ path: `${OUT}/01-login.png` });
  await p.getByRole('button', { name: /crear una cuenta|crear cuenta|regístrate/i }).last().click();
  await p.getByLabel('Nombre').fill('Ana E2E'); await p.getByLabel('Email').fill(email); await p.getByLabel('Contraseña').fill('contraseña-segura-1');
  await p.getByRole('button', { name: 'Crear cuenta' }).click();
  await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/02-verify-notice.png` });
  const url = await mailFor(email); console.log('verify url', url);
  await p.goto(url); await p.waitForURL(/onboarding/, { timeout: 15000 });
  await p.screenshot({ path: `${OUT}/03-onboarding.png`, fullPage: true });
  await p.getByLabel('Nombre de la tienda').fill(`Moda E2E ${Date.now().toString(36)}`);
  await p.getByRole('button', { name: 'Crear tienda' }).click();
  await p.getByRole('button', { name: 'Ir al panel' }).waitFor({ timeout: 15000 });
  await p.screenshot({ path: `${OUT}/04-recommended.png`, fullPage: true });
  await p.getByRole('button', { name: 'Ir al panel' }).click(); await p.waitForURL(/\/stores\/[0-9a-f-]+$/);
  await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/05-dashboard.png`, fullPage: true });
  const storeUrl = p.url();
  await p.goto(storeUrl + '/team'); await p.waitForTimeout(800);
  const staffEmail = `staff-${Date.now()}@test.local`;
  await p.getByLabel(/email/i).fill(staffEmail); await p.getByRole('button', { name: /invitar/i }).click();
  await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/06-team-invite.png`, fullPage: true });
  const link = await p.locator('input[value*="/invitations/accept#"]').first().inputValue().catch(() => null);
  console.log('invite link', link);
  const revokeEmail = `revocar-${Date.now()}@test.local`;
  await p.getByLabel(/email/i).fill(revokeEmail); await p.getByRole('button', { name: /invitar/i }).click(); await p.waitForTimeout(800);
  await p.locator('li', { hasText: revokeEmail }).getByRole('button', { name: 'Revocar' }).click(); await p.waitForTimeout(800);
  console.log('revoked invitation gone', (await p.locator('li', { hasText: revokeEmail }).count()) === 0);
  await p.screenshot({ path: `${OUT}/06b-team-revoked.png`, fullPage: true });
  await p.goto(storeUrl + '/audit'); await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/07-audit.png`, fullPage: true });
  await p.goto(storeUrl + '/products'); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/08-empty-section.png` });
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() }); const mp = await m.newPage();
  await mp.goto(storeUrl); await mp.waitForTimeout(800); await mp.screenshot({ path: `${OUT}/09-mobile.png` });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); console.log('mobile overflow', overflow);
  // invitee accepts
  if (link) {
    const c2 = await b.newContext(); const q = await c2.newPage();
    await q.goto('http://localhost:3000/login'); await q.getByRole('button', { name: /crear una cuenta|crear cuenta|regístrate/i }).last().click();
    await q.getByLabel('Nombre').fill('Staff E2E'); await q.getByLabel('Email').fill(staffEmail); await q.getByLabel('Contraseña').fill('contraseña-segura-1');
    await q.getByRole('button', { name: 'Crear cuenta' }).click();
    const v = new URL(await mailFor(staffEmail)); await q.goto('http://localhost:3000' + v.pathname + v.search); await q.waitForTimeout(1500);
    const il = new URL(link.trim().match(/https?:\S+/)[0]); await q.goto('http://localhost:3000' + il.pathname + il.hash);
    await q.waitForURL(/\/stores\//, { timeout: 15000 }).catch(() => {}); await q.waitForTimeout(800);
    await q.screenshot({ path: `${OUT}/10-staff-view.png`, fullPage: true }); console.log('staff url', q.url());
    console.log('staff nav', (await q.locator('nav').innerText().catch(() => '')).replace(/\n/g, ' | '));
  }
  console.log('errors', JSON.stringify(errors));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
