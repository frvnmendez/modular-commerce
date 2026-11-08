// Controles negativos: cada sabotaje debe hacer FALLAR la suite, y por la razón prevista.
// Se exige que (a) la preparación (beforeAll) haya funcionado: hay pruebas que pasan; (b) fallen las pruebas
// que detectan ese sabotaje; (c) ningún fallo sea de infraestructura (conexión, hooks, timeouts).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXPECTED = {
  'rls-off': ['mc_app sin contexto no ve ninguna fila de control ni de comercio', 'dentro de la tienda A, una consulta directa no devuelve filas de B aunque se pidan por ID', 'catálogo: toda tabla de control/comercio con RLS+FORCE; mc_app no es dueño ni BYPASSRLS; sin vistas inseguras'],
  permissive: ['mc_app sin contexto no ve ninguna fila de control ni de comercio', 'dentro de la tienda A, una consulta directa no devuelve filas de B aunque se pidan por ID', 'catálogo: toda tabla de control/comercio con RLS+FORCE; mc_app no es dueño ni BYPASSRLS; sin vistas inseguras'],
  membership: ['owner y staff de A reciben 404 en todos los GET de la tienda B', 'A no puede editar, invitar, cambiar roles ni expulsar en B (404) ', 'tras todos los ataques, la tienda B está exactamente igual'],
};
const INFRA = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Hook timed out|hook|password authentication failed|database .* does not exist|Cannot find module|SyntaxError/i;

const dir = mkdtempSync(join(tmpdir(), 'mc-neg-'));
let ok = true;
for (const [mode, mustFail] of Object.entries(EXPECTED)) {
  const out = join(dir, `${mode}.json`);
  const r = spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { env: { ...process.env, ISOLATION_SABOTAGE: mode }, encoding: 'utf8' });
  let report;
  try { report = JSON.parse(readFileSync(out, 'utf8')); } catch { console.error(`✗ ${mode}: sin informe JSON (¿la suite ni arrancó?)\n${r.stderr.slice(-2000)}`); ok = false; continue; }
  const tests = report.testResults.flatMap((f) => f.assertionResults);
  const failed = tests.filter((t) => t.status === 'failed');
  const passed = tests.filter((t) => t.status === 'passed');
  const fileErrors = report.testResults.filter((f) => f.status === 'failed' && f.message).map((f) => f.message);
  const infra = [...failed.flatMap((t) => t.failureMessages), ...fileErrors].filter((m) => INFRA.test(m));
  const missing = mustFail.filter((title) => !failed.some((t) => t.title === title));
  const problems = [];
  if (r.status === 0) problems.push('la suite PASÓ: el sabotaje no se detectó');
  if (passed.length === 0) problems.push('ninguna prueba pasó: probablemente falló la preparación, no el aislamiento');
  if (missing.length) problems.push(`no fallaron las pruebas que detectan este sabotaje: ${missing.join(' | ')}`);
  if (infra.length) problems.push(`fallos de infraestructura: ${infra.map((m) => m.split('\n')[0]).join(' | ')}`);
  if (problems.length) { ok = false; console.error(`✗ ${mode}: ${problems.join('; ')}`); }
  else console.log(`✓ ${mode}: detectado (${failed.length} fallan, ${passed.length} pasan) — ${failed.map((t) => t.title).join(' | ')}`);
}
process.exit(ok ? 0 : 1);
