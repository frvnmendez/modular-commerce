-- PoC de aislamiento multi-tenant con PostgreSQL Row Level Security.
-- Se ejecuta como superusuario solo para crear roles; las tablas pertenecen a "migrator".
DROP SCHEMA IF EXISTS commerce CASCADE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator LOGIN PASSWORD 'migrator' NOSUPERUSER;
  END IF;
  -- Rol de migraciones/operación: dueño del esquema y con BYPASSRLS para que los backfills afecten a TODAS
  -- las filas (con FORCE RLS y sin contexto, un UPDATE afectaría a 0 filas sin error). Uso auditado, nunca desde la app.
  ALTER ROLE migrator BYPASSRLS;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT CREATE ON DATABASE rls_poc TO migrator;
CREATE SCHEMA commerce AUTHORIZATION migrator;
SET ROLE migrator;

CREATE TABLE commerce.tenants (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL
);

-- Función única para leer el tenant actual. Si no hay contexto devuelve NULL → ninguna fila visible.
CREATE FUNCTION commerce.current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE commerce.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce.tenants(id),
  title text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  UNIQUE (tenant_id, id)
);

CREATE TABLE commerce.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce.tenants(id),
  email text NOT NULL,
  UNIQUE (tenant_id, email),
  UNIQUE (tenant_id, id)
);

CREATE TABLE commerce.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce.tenants(id),
  customer_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  idempotency_key text NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  -- FKs compuestas: un pedido no puede apuntar a un cliente o producto de otro tenant.
  FOREIGN KEY (tenant_id, customer_id) REFERENCES commerce.customers(tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES commerce.products(tenant_id, id)
);

-- Idempotencia explícita: la clave se reserva al inicio de la transacción junto con el hash del payload.
CREATE TABLE commerce.idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES commerce.tenants(id),
  key text NOT NULL,
  request_hash text NOT NULL,
  order_id uuid,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE commerce.tenant_secrets (
  tenant_id uuid NOT NULL REFERENCES commerce.tenants(id),
  name text NOT NULL,
  ciphertext bytea NOT NULL,
  PRIMARY KEY (tenant_id, name)
);

CREATE INDEX ON commerce.products (tenant_id);
CREATE INDEX ON commerce.orders (tenant_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['products','customers','orders','tenant_secrets','idempotency_keys'] LOOP
    EXECUTE format('ALTER TABLE commerce.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE commerce.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON commerce.%I
      USING (tenant_id = commerce.current_tenant())
      WITH CHECK (tenant_id = commerce.current_tenant())$p$, t);
  END LOOP;
END $$;

-- La tabla de tenants también bajo RLS: cada tienda solo ve su propia fila.
ALTER TABLE commerce.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON commerce.tenants USING (id = commerce.current_tenant());

GRANT USAGE ON SCHEMA commerce TO app_user;
GRANT SELECT ON commerce.tenants TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON commerce.products, commerce.customers, commerce.orders, commerce.tenant_secrets, commerce.idempotency_keys TO app_user;
GRANT EXECUTE ON FUNCTION commerce.current_tenant() TO app_user;
RESET ROLE;
