import pg from 'pg';
import { createHash } from 'node:crypto';

const base = { host: '127.0.0.1', port: 5432, database: 'rls_poc' };

export const appPool = new pg.Pool({ ...base, user: 'app_user', password: 'app_user', max: 4 });
// Pool de una sola conexión para demostrar que el contexto no se filtra entre peticiones.
export const singlePool = new pg.Pool({ ...base, user: 'app_user', password: 'app_user', max: 1 });
export const superPool = new pg.Pool({ ...base, user: 'postgres', password: 'postgres', max: 2 });

export type Session = { userId: string; tenantId: string };

/**
 * Única puerta de acceso a datos de comercio. El tenant sale SIEMPRE de la sesión autenticada,
 * nunca de parámetros de la petición. SET LOCAL (set_config(..., true)) muere con la transacción.
 */
export async function withTenant<T>(
  session: Session,
  fn: (c: pg.PoolClient) => Promise<T>,
  pool: pg.Pool = appPool,
  opts: { statementTimeoutMs?: number } = {},
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [session.tenantId]);
    if (opts.statementTimeoutMs) {
      await c.query(`SET LOCAL statement_timeout = ${Number(opts.statementTimeoutMs)}`);
    }
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    // Defensa extra: si algún código fijó un GUC a nivel de sesión por error, no sobrevive a la devolución al pool.
    // (En producción con PgBouncer: server_reset_query = DISCARD ALL.)
    await c.query('DISCARD ALL').catch(() => {});
    c.release();
  }
}

// Servicio de ejemplo: la firma no acepta tenantId; un atacante solo controla `productId`.
export async function getProduct(session: Session, productId: string) {
  return withTenant(session, async (c) => {
    const r = await c.query('SELECT id, tenant_id, title FROM commerce.products WHERE id = $1', [productId]);
    return r.rows[0] ?? null;
  });
}

export class IdempotencyConflict extends Error {
  constructor() { super('IDEMPOTENCY_KEY_REUSED'); }
}

export async function placeOrder(
  session: Session,
  input: { customerId: string; productId: string; quantity: number; idempotencyKey: string },
) {
  const requestHash = createHash('sha256').update(JSON.stringify([input.customerId, input.productId, input.quantity])).digest('hex');
  return withTenant(session, async (c) => {
    // 1) Reservar la clave. Si otra transacción la tiene sin confirmar, este INSERT espera a que termine.
    const reserved = await c.query(
      `INSERT INTO commerce.idempotency_keys (tenant_id, key, request_hash) VALUES (commerce.current_tenant(), $1, $2)
       ON CONFLICT DO NOTHING RETURNING key`,
      [input.idempotencyKey, requestHash],
    );
    if (!reserved.rows[0]) {
      const prev = await c.query('SELECT request_hash, order_id FROM commerce.idempotency_keys WHERE key = $1', [input.idempotencyKey]);
      if (prev.rows[0].request_hash !== requestHash) throw new IdempotencyConflict(); // → HTTP 409
      const o = await c.query('SELECT * FROM commerce.orders WHERE id = $1', [prev.rows[0].order_id]);
      return { order: o.rows[0], replayed: true };
    }
    // 2) Precio recalculado en servidor y stock bloqueado con FOR UPDATE: el cliente no envía precios.
    const p = await c.query('SELECT price_cents, stock FROM commerce.products WHERE id = $1 FOR UPDATE', [input.productId]);
    if (!p.rows[0]) throw new Error('PRODUCT_NOT_FOUND');
    if (p.rows[0].stock < input.quantity) throw new Error('OUT_OF_STOCK');
    await c.query('UPDATE commerce.products SET stock = stock - $1 WHERE id = $2', [input.quantity, input.productId]);
    const o = await c.query(
      `INSERT INTO commerce.orders (tenant_id, customer_id, product_id, quantity, total_cents, idempotency_key)
       VALUES (commerce.current_tenant(), $1, $2, $3, $4, $5) RETURNING *`,
      [input.customerId, input.productId, input.quantity, p.rows[0].price_cents * input.quantity, input.idempotencyKey],
    );
    await c.query('UPDATE commerce.idempotency_keys SET order_id = $1 WHERE key = $2', [o.rows[0].id, input.idempotencyKey]);
    return { order: o.rows[0], replayed: false };
  });
}
