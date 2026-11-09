/** Ejecuta migraciones SQL en orden, cada una en su transacción, como rol migrator. */
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { connectionFor } from './config.ts';

const DIR = new URL('../migrations/', import.meta.url);

export async function migrate(log: (m: string) => void = console.log) {
  const c = new pg.Client(connectionFor('migrator'));
  await c.connect();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map((await c.query('SELECT id, checksum FROM public.schema_migrations')).rows.map((r) => [r.id, r.checksum]));
    const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = await readFile(new URL(f, DIR), 'utf8');
      const sum = createHash('sha256').update(sql).digest('hex');
      if (done.has(f)) {
        if (done.get(f) !== sum) throw new Error(`La migración ${f} ya aplicada fue modificada. Crea una nueva en su lugar.`);
        continue;
      }
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO public.schema_migrations (id, checksum) VALUES ($1, $2)', [f, sum]);
        await c.query('COMMIT');
        log(`aplicada ${f}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Falló ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
}
