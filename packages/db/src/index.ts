import pg from 'pg';
import { connectionFor, type DbRole } from './config.ts';

export { connectionFor, ROLE_USERS, type DbRole } from './config.ts';
export { migrate } from './migrate.ts';

const pools = new Map<DbRole, pg.Pool>();

/** Pool por rol. `max` bajo por proceso: el límite global lo impone la celda (ver R-17). */
export function pool(role: Exclude<DbRole, 'migrator'>): pg.Pool {
  let p = pools.get(role);
  if (!p) {
    p = new pg.Pool({ ...connectionFor(role), max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    pools.set(role, p);
  }
  return p;
}

export async function closePools() {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}

export type Tx = pg.PoolClient;
export type StoreRole = 'owner' | 'admin' | 'staff';

export class NotFoundError extends Error {
  constructor(what = 'NOT_FOUND') { super(what); this.name = 'NotFoundError'; }
}
export class ForbiddenError extends Error {
  constructor(what = 'FORBIDDEN') { super(what); this.name = 'ForbiddenError'; }
}
export class ConflictError extends Error {
  constructor(what = 'CONFLICT') { super(what); this.name = 'ConflictError'; }
}

/** Traduce errores de las funciones SQL a errores de dominio. */
export function mapDbError(e: unknown): never {
  const err = e as { code?: string; message?: string };
  const msg = err.message ?? '';
  // Solo se traducen los errores de dominio que lanzan nuestras funciones (mensajes en MAYÚSCULAS).
  // Un "permission denied" real de Postgres es un bug de privilegios y debe aflorar como 500.
  const domain = /^[A-Z][A-Z_:]*$/.test(msg);
  if (err.code === 'P0002' && domain) throw new NotFoundError(msg);
  if (err.code === '42501' && domain) throw new ForbiddenError(msg);
  if (err.code === '23505') throw new ConflictError('DUPLICATE');
  if (err.code === '23514' && domain) throw new ConflictError(msg);
  throw e;
}

async function transaction<T>(role: Exclude<DbRole, 'migrator'>, setup: (c: Tx) => Promise<void>, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool(role).connect();
  try {
    await c.query('BEGIN');
    await setup(c);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    // Si algún código fijó un GUC de sesión por error, no sobrevive a la devolución al pool (RT-9).
    await c.query('DISCARD ALL').catch(() => {});
    c.release();
  }
}

/**
 * Abre el contexto de la transacción con el token de sesión. La BD valida el token (sesión vigente de un usuario
 * verificado) y guarda el usuario en control.request_context, que mc_app no puede escribir (RT-R1 H1).
 */
const beginSession = (c: Tx, sessionToken: string) => c.query('SELECT control.begin_session($1)', [sessionToken]).then(() => undefined);

/** Operaciones del plano de control como un usuario autenticado (sin tienda). */
export function withUser<T>(sessionToken: string, fn: (c: Tx) => Promise<T>): Promise<T> {
  return transaction('app', (c) => beginSession(c, sessionToken), fn).catch(mapDbError);
}

/**
 * Operaciones dentro de una tienda. La BD verifica la pertenencia (control.enter_store) y fija el tenant.
 * Si el usuario no pertenece a la tienda, lanza NotFoundError (404, nunca 403 que confirme existencia).
 */
export function withStore<T>(sessionToken: string, storeId: string, fn: (c: Tx, role: StoreRole) => Promise<T>): Promise<T> {
  let role: StoreRole = 'staff';
  return transaction(
    'app',
    async (c) => {
      if (!isUuid(storeId)) throw new NotFoundError('STORE_NOT_FOUND');
      await beginSession(c, sessionToken);
      const r = await c.query('SELECT control.enter_store($1) AS role', [storeId]);
      role = r.rows[0].role;
    },
    (c) => fn(c, role),
  ).catch(mapDbError);
}

/** Operaciones de plataforma (rol mc_ops). Siempre auditadas por quien llama. */
export function withOperator<T>(sessionToken: string, fn: (c: Tx) => Promise<T>): Promise<T> {
  return transaction('ops', (c) => beginSession(c, sessionToken), fn).catch(mapDbError);
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
