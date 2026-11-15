// Controles negativos del spike: cada sabotaje debe hacer FALLAR la suite por la razón prevista.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXPECTED = {
  'rls-off': ['dentro de A, SQL directo no ve ni toca filas de B aunque se pidan por ID', 'catálogo: todas las tablas del spike con tenant_id NOT NULL, RLS+FORCE e índice que empieza por tenant_id'],
  'role-off': ['regla 5b: el staff con mc_app directo no puede escribir catálogo ni impuestos; el owner sí'],
  'guard-off': ['invariantes: importes del pedido inmutables, pedido sin líneas o con subtotal falso no se confirma', 'el staff con mc_app directo no puede cancelar ni reembolsar (trigger con rol)', 'máquina de estados: pending → paid → fulfilled; transiciones ilegales → 409'],
};
const INFRA = /ECONNREFUSED|ETIMEDOUT|Hook timed out|password authentication failed|database .* does not exist|Cannot find module|SyntaxError/i;
const dir = mkdtempSync(join(tmpdir(), 'mc-spike-neg-'));
let ok = true;
for (const [mode, mustFail] of Object.entries(EXPECTED)) {
  const out = join(dir, `${mode}.json`);
  const r = spawnSync('npx', ['vitest', 'run', 'test/own-core.test.ts', '--reporter=json', `--outputFile=${out}`], { env: { ...process.env, SPIKE_SABOTAGE: mode }, encoding: 'utf8' });
  let report;
  try { report = JSON.parse(readFileSync(out, 'utf8')); } catch { console.error(`✗ ${mode}: sin informe\n${r.stderr.slice(-2000)}`); ok = false; continue; }
  const tests = report.testResults.flatMap((f) => f.assertionResults);
  const failed = tests.filter((t) => t.status === 'failed');
  const passed = tests.filter((t) => t.status === 'passed');
  const infra = failed.flatMap((t) => t.failureMessages).filter((m) => INFRA.test(m));
  const missing = mustFail.filter((title) => !failed.some((t) => t.title === title));
  const problems = [];
  if (r.status === 0) problems.push('la suite PASÓ');
  if (passed.length === 0) problems.push('ninguna prueba pasó (¿falló la preparación?)');
  if (missing.length) problems.push(`no fallaron: ${missing.join(' | ')}`);
  if (infra.length) problems.push(`infraestructura: ${infra.map((m) => m.split('\n')[0]).join(' | ')}`);
  if (problems.length) { ok = false; console.error(`✗ ${mode}: ${problems.join('; ')}`); }
  else console.log(`✓ ${mode}: detectado (${failed.length} fallan, ${passed.length} pasan) — ${failed.map((t) => t.title).join(' | ')}`);
}
process.exit(ok ? 0 : 1);
