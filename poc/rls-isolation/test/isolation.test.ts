import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { appPool, getProduct, IdempotencyConflict, placeOrder, singlePool, superPool, withTenant, type Session } from '../src/db';

const A: Session = { userId: 'admin-a', tenantId: randomUUID() };
const B: Session = { userId: 'admin-b', tenantId: randomUUID() };
const ids: Record<string, string> = {};

async function seed(s: Session, tag: string) {
  await withTenant(s, async (c) => {
    const p = await c.query(
      `INSERT INTO commerce.products (tenant_id, title, price_cents, stock) VALUES (commerce.current_tenant(), $1, 1000, 5) RETURNING id`,
      [`Producto ${tag}`],
    );
    const cu = await c.query(
      `INSERT INTO commerce.customers (tenant_id, email) VALUES (commerce.current_tenant(), 'cliente@ejemplo.com') RETURNING id`,
    );
    await c.query(
      `INSERT INTO commerce.tenant_secrets (tenant_id, name, ciphertext) VALUES (commerce.current_tenant(), 'stripe_key', $1)`,
      [Buffer.from(`secreto-${tag}`)],
    );
    ids[`product${tag}`] = p.rows[0].id;
    ids[`customer${tag}`] = cu.rows[0].id;
  });
}

beforeAll(async () => {
  await superPool.query(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  await superPool.query('INSERT INTO commerce.tenants (id, slug) VALUES ($1, $2), ($3, $4)', [A.tenantId, 'tienda-a', B.tenantId, 'tienda-b']);
  await seed(A, 'A');
  await seed(B, 'B');
  // Controles negativos: la suite DEBE fallar con cada sabotaje.
  //   SABOTAGE_RLS=1 → RLS desactivado · =permissive → política USING (true) · =noforce → sin FORCE · =owner → app_user dueño
  const sab = process.env.SABOTAGE_RLS;
  for (const t of ['products', 'customers', 'orders', 'tenant_secrets', 'idempotency_keys']) {
    if (sab === '1') await superPool.query(`ALTER TABLE commerce.${t} DISABLE ROW LEVEL SECURITY`);
    if (sab === 'permissive') {
      await superPool.query(`DROP POLICY tenant_isolation ON commerce.${t}`);
      await superPool.query(`CREATE POLICY tenant_isolation ON commerce.${t} USING (true) WITH CHECK (true)`);
    }
    if (sab === 'noforce') await superPool.query(`ALTER TABLE commerce.${t} NO FORCE ROW LEVEL SECURITY`);
    if (sab === 'owner') await superPool.query(`ALTER TABLE commerce.${t} OWNER TO app_user`);
  }
});

afterAll(async () => {
  await Promise.all([appPool.end(), singlePool.end(), superPool.end()]);
});

describe('Lectura aislada', () => {
  it('cada tenant ve solo sus productos, clientes y secretos', async () => {
    for (const [s, tag] of [[A, 'A'], [B, 'B']] as const) {
      const r = await withTenant(s, async (c) => ({
        p: (await c.query('SELECT title FROM commerce.products')).rows,
        c: (await c.query('SELECT id FROM commerce.customers')).rows,
        s: (await c.query('SELECT convert_from(ciphertext, $$UTF8$$) v FROM commerce.tenant_secrets')).rows,
      }));
      expect(r.p).toEqual([{ title: `Producto ${tag}` }]);
      expect(r.c).toEqual([{ id: ids[`customer${tag}`] }]);
      expect(r.s).toEqual([{ v: `secreto-${tag}` }]);
    }
  });

  it('IDOR: el admin de A pide por ID un producto de B y obtiene null', async () => {
    expect(await getProduct(A, ids.productB)).toBeNull();
    expect((await getProduct(B, ids.productB))?.title).toBe('Producto B');
  });

  it('sin contexto de tenant no se ve nada', async () => {
    const r = await appPool.query('SELECT count(*)::int n FROM commerce.products');
    expect(r.rows[0].n).toBe(0);
  });

  it('desactivar row_security no sirve de bypass para app_user (Postgres lanza error)', async () => {
    const c = await appPool.connect();
    try {
      await c.query('SET row_security = off');
      await expect(c.query('SELECT * FROM commerce.products')).rejects.toThrow(/row-level security/i);
    } finally {
      await c.query('RESET row_security');
      c.release();
    }
  });
});

describe('Catálogo de seguridad (lo que un humano olvidaría)', () => {
  it('[RT-7] toda tabla con tenant_id tiene RLS+FORCE y política estricta; ninguna vista evade RLS; app_user no es dueño ni BYPASSRLS', async () => {
    const tables = await superPool.query(`
      SELECT c.relname, c.relrowsecurity rls, c.relforcerowsecurity force, pg_get_userbyid(c.relowner) owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'commerce' AND c.relkind = 'r'
        AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id') OR c.relname = 'tenants')`);
    expect(tables.rows.length).toBeGreaterThanOrEqual(6);
    for (const t of tables.rows) {
      expect({ t: t.relname, rls: t.rls, force: t.force }).toEqual({ t: t.relname, rls: true, force: true });
      expect(t.owner, t.relname).not.toBe('app_user');
    }
    const pols = await superPool.query(`SELECT tablename, qual, with_check, cmd FROM pg_policies WHERE schemaname = 'commerce'`);
    for (const p of pols.rows) {
      expect(p.qual, p.tablename).toMatch(/current_tenant\(\)/);
      if (p.tablename !== 'tenants') expect(p.with_check, p.tablename).toMatch(/current_tenant\(\)/);
    }
    const views = await superPool.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'commerce' AND c.relkind IN ('v','m')
        AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false)`);
    expect(views.rows).toEqual([]);
    const bad = await superPool.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'commerce' AND r.rolsuper`);
    expect(bad.rows).toEqual([]);
    const role = await superPool.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_user'`);
    expect(role.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('[RT-8] la tabla de tenants no permite listar otras tiendas', async () => {
    expect((await appPool.query('SELECT count(*)::int n FROM commerce.tenants')).rows[0].n).toBe(0);
    const r = await withTenant(A, async (c) => (await c.query('SELECT slug FROM commerce.tenants')).rows);
    expect(r).toEqual([{ slug: 'tienda-a' }]);
  });

  it('[RT-9] un GUC fijado a nivel de sesión por error no sobrevive a la devolución al pool', async () => {
    await withTenant(A, (c) => c.query("SELECT set_config('app.tenant_id', $1, false)", [A.tenantId]), singlePool);
    const r = await singlePool.query('SELECT count(*)::int n FROM commerce.products');
    expect(r.rows[0].n).toBe(0);
  });
});

describe('Escritura aislada', () => {
  it('A no puede actualizar ni borrar filas de B por ID (0 filas afectadas)', async () => {
    const r = await withTenant(A, async (c) => ({
      u: (await c.query("UPDATE commerce.products SET title = 'hackeado' WHERE id = $1", [ids.productB])).rowCount,
      d: (await c.query('DELETE FROM commerce.customers WHERE id = $1', [ids.customerB])).rowCount,
    }));
    expect(r).toEqual({ u: 0, d: 0 });
    expect((await getProduct(B, ids.productB))?.title).toBe('Producto B');
  });

  it('A no puede insertar filas con tenant_id de B', async () => {
    await expect(
      withTenant(A, (c) =>
        c.query("INSERT INTO commerce.products (tenant_id, title, price_cents) VALUES ($1, 'x', 1)", [B.tenantId]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('A no puede mover una fila propia al tenant B', async () => {
    await expect(
      withTenant(A, (c) => c.query('UPDATE commerce.products SET tenant_id = $1 WHERE id = $2', [B.tenantId, ids.productA])),
    ).rejects.toThrow(/row-level security/i);
  });

  it('A no puede crear un pedido que referencie un cliente o producto de B', async () => {
    await expect(
      placeOrder(A, { customerId: ids.customerB, productId: ids.productA, quantity: 1, idempotencyKey: randomUUID() }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      placeOrder(A, { customerId: ids.customerA, productId: ids.productB, quantity: 1, idempotencyKey: randomUUID() }),
    ).rejects.toThrow('PRODUCT_NOT_FOUND');
  });
});

describe('Pool de conexiones y concurrencia', () => {
  it('el contexto de una transacción no se filtra a la siguiente petición en la misma conexión', async () => {
    await withTenant(A, (c) => c.query('SELECT 1'), singlePool);
    const r = await singlePool.query("SELECT current_setting('app.tenant_id', true) t, (SELECT count(*)::int FROM commerce.products) n");
    expect(r.rows[0].t ?? '').toBe('');
    expect(r.rows[0].n).toBe(0);
  });

  it('200 peticiones intercaladas A/B nunca ven datos ajenos', async () => {
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) => {
        const s = i % 2 ? A : B;
        return withTenant(s, async (c) => {
          const r = await c.query('SELECT tenant_id FROM commerce.products, pg_sleep(0.001)');
          return r.rows.every((row) => row.tenant_id === s.tenantId) && r.rows.length === 1;
        });
      }),
    );
    expect(results.every(Boolean)).toBe(true);
  });
});

describe('Integridad de pedidos', () => {
  it('idempotencia: 10 envíos concurrentes con la misma clave crean un único pedido y descuentan stock una vez', async () => {
    const key = randomUUID();
    const res = await Promise.all(
      Array.from({ length: 10 }, () => placeOrder(A, { customerId: ids.customerA, productId: ids.productA, quantity: 2, idempotencyKey: key })),
    );
    expect(new Set(res.map((r) => r.order.id)).size).toBe(1);
    expect(res.filter((r) => !r.replayed)).toHaveLength(1);
    const stock = await withTenant(A, async (c) => (await c.query('SELECT stock FROM commerce.products WHERE id=$1', [ids.productA])).rows[0].stock);
    expect(stock).toBe(3);
  });

  it('[RT-10] misma clave con payload distinto en concurrencia → un pedido y conflicto explícito (409), nunca error 500', async () => {
    const extra = await withTenant(A, async (c) => (await c.query(
      `INSERT INTO commerce.products (tenant_id, title, price_cents, stock) VALUES (commerce.current_tenant(), 'Extra', 500, 100) RETURNING id`)).rows[0].id);
    for (let n = 0; n < 20; n++) {
      const key = randomUUID();
      const res = await Promise.allSettled([
        placeOrder(A, { customerId: ids.customerA, productId: extra, quantity: 1, idempotencyKey: key }),
        placeOrder(A, { customerId: ids.customerA, productId: extra, quantity: 2, idempotencyKey: key }),
      ]);
      const ok = res.filter((r) => r.status === 'fulfilled');
      const rejected = res.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(IdempotencyConflict);
    }
  });

  it('la misma clave de idempotencia es independiente entre tenants', async () => {
    const key = 'clave-compartida';
    const a = await placeOrder(A, { customerId: ids.customerA, productId: ids.productA, quantity: 1, idempotencyKey: key });
    const b = await placeOrder(B, { customerId: ids.customerB, productId: ids.productB, quantity: 1, idempotencyKey: key });
    expect(a.order.id).not.toBe(b.order.id);
    expect(a.order.tenant_id).toBe(A.tenantId);
    expect(b.order.tenant_id).toBe(B.tenantId);
  });

  it('el total se calcula en servidor y el stock no puede quedar negativo', async () => {
    await expect(
      placeOrder(B, { customerId: ids.customerB, productId: ids.productB, quantity: 999, idempotencyKey: randomUUID() }),
    ).rejects.toThrow('OUT_OF_STOCK');
  });
});

describe('Fallos y mantenimiento', () => {
  it('una transacción bloqueada o lenta en A no bloquea a B, y el timeout por tenant la corta', async () => {
    const holder = await appPool.connect();
    await holder.query('BEGIN');
    await holder.query("SELECT set_config('app.tenant_id', $1, true)", [A.tenantId]);
    await holder.query('SELECT * FROM commerce.products FOR UPDATE'); // A bloquea sus filas
    try {
      const t0 = Date.now();
      expect((await getProduct(B, ids.productB))?.title).toBe('Producto B');
      expect(Date.now() - t0).toBeLessThan(1000);
      await expect(
        withTenant(A, (c) => c.query('UPDATE commerce.products SET stock = stock WHERE id = $1', [ids.productA]), appPool, { statementTimeoutMs: 300 }),
      ).rejects.toThrow(/statement timeout/i);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });

  it('[RT-1] el rol de migración ve TODAS las filas en un backfill (no 0 silencioso)', async () => {
    const mig = new pg.Client({ host: '127.0.0.1', port: 5432, database: 'rls_poc', user: 'migrator', password: 'migrator' });
    await mig.connect();
    try {
      const total = (await superPool.query('SELECT count(*)::int n FROM commerce.products')).rows[0].n;
      await mig.query('BEGIN');
      const r = await mig.query('UPDATE commerce.products SET title = title');
      await mig.query('ROLLBACK');
      expect(total).toBeGreaterThanOrEqual(2);
      expect(r.rowCount).toBe(total);
    } finally {
      await mig.end();
    }
  });

  it('una migración (como migrator) que falla a mitad se revierte entera: ni columna ni backfill parcial', async () => {
    const mig = new pg.Client({ host: '127.0.0.1', port: 5432, database: 'rls_poc', user: 'migrator', password: 'migrator' });
    await mig.connect();
    try {
      await mig.query('BEGIN');
      await mig.query('ALTER TABLE commerce.products ADD COLUMN sku text');
      const upd = await mig.query("UPDATE commerce.products SET sku = 'SKU-' || left(id::text, 8)");
      expect(upd.rowCount).toBeGreaterThanOrEqual(2); // afecta a filas de A y B
      await expect(mig.query('ALTER TABLE commerce.products ADD CONSTRAINT bad CHECK (price_cents > 1000000)')).rejects.toThrow();
      await mig.query('ROLLBACK');
    } finally {
      await mig.end();
    }
    const cols = await superPool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='commerce' AND table_name='products'");
    expect(cols.rows.map((r) => r.column_name)).not.toContain('sku');
    expect((await getProduct(A, ids.productA))?.title).toBe('Producto A');
    expect((await getProduct(B, ids.productB))?.title).toBe('Producto B');
  });

});
