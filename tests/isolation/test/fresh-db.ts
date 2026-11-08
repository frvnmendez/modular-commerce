import pg from 'pg';
import { randomBytes } from 'node:crypto';

/**
 * Crea una base de datos desechable con todas las migraciones, para poder sabotearla sin riesgo.
 * Debe llamarse ANTES de crear la app (los pools leen DATABASE_NAME al crearse).
 */
export async function freshDatabase() {
  const name = `mc_iso_${randomBytes(4).toString('hex')}`;
  process.env.DATABASE_NAME = name;
  const { bootstrap } = await import('@mc/db/bootstrap');
  const { migrate } = await import('@mc/db');
  await bootstrap();
  await migrate(() => {});
  return name;
}

export function adminClient(db = process.env.DATABASE_NAME!) {
  return new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL!.replace(/\/[^/]*$/, `/${db}`) });
}

export async function dropDatabase(name: string) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL! });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await c.end();
}

/**
 * Controles negativos. Cada modo rompe una capa; la suite DEBE fallar con cada uno.
 *  - rls-off:      RLS desactivado en todas las tablas de control y comercio
 *  - permissive:   políticas reemplazadas por USING (true)
 *  - membership:   control.store_role devuelve 'owner' para cualquier tienda (bug de autorización)
 */
export async function sabotage(mode: string | undefined) {
  if (!mode) return;
  const c = adminClient();
  await c.connect();
  try {
    const tables = (await c.query(`SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('control','commerce')`)).rows;
    if (mode === 'rls-off') {
      for (const t of tables) await c.query(`ALTER TABLE ${t.schemaname}.${t.tablename} DISABLE ROW LEVEL SECURITY`);
    } else if (mode === 'permissive') {
      const pols = (await c.query(`SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname IN ('control','commerce')`)).rows;
      for (const p of pols) await c.query(`DROP POLICY ${p.policyname} ON ${p.schemaname}.${p.tablename}`);
      for (const t of tables) await c.query(`CREATE POLICY open ON ${t.schemaname}.${t.tablename} USING (true) WITH CHECK (true)`);
    } else if (mode === 'membership') {
      await c.query(`CREATE OR REPLACE FUNCTION control.store_role(p_store uuid) RETURNS text
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control AS $$ SELECT 'owner'::text $$`);
    } else {
      throw new Error(`modo de sabotaje desconocido: ${mode}`);
    }
  } finally {
    await c.end();
  }
}
