-- SPIKE ADR-0001 (opción "núcleo propio"). NO es una migración de producción: la aplican los tests del spike
-- sobre una BD desechable que ya tiene las migraciones 0001–0010 de R1. Se ejecuta como mc_migrator (dueño).
--
-- Alcance: catálogo (producto + variantes), inventario de una ubicación, clientes por tienda, tipos de impuesto
-- por país, pedidos con líneas, numeración por tienda y máquina de estados.
-- Reglas de docs/TENANT-ISOLATION.md aplicadas: tenant_id NOT NULL, RLS ENABLE+FORCE con subselect, FKs
-- compuestas (tenant_id, x_id), únicos de negocio con tenant_id, roles con políticas RESTRICTIVE (regla 5b).

-- ---------------------------------------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE commerce.products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  handle text NOT NULL CHECK (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, handle)
);

CREATE TABLE commerce.product_variants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  sku text NOT NULL CHECK (length(sku) BETWEEN 1 AND 64),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  -- Dinero siempre en unidades menores (céntimos) y con su moneda. Nunca float.
  price_amount bigint NOT NULL CHECK (price_amount >= 0 AND price_amount <= 100000000000),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, sku),
  FOREIGN KEY (tenant_id, product_id) REFERENCES commerce.products (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ON commerce.product_variants (tenant_id, product_id);

-- Inventario de una ubicación. Separado de la variante para que el staff pueda descontar stock al crear un
-- pedido sin tener permiso para editar el catálogo.
CREATE TABLE commerce.inventory_levels (
  tenant_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  on_hand integer NOT NULL CHECK (on_hand >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, variant_id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES commerce.product_variants (tenant_id, id) ON DELETE CASCADE
);

-- Tipos de impuesto por país, por tienda (ADR-0001: tablas de tipos en el MVP, sin motor fiscal propio).
CREATE TABLE commerce.tax_rates (
  tenant_id uuid NOT NULL,
  country char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  rate_bp integer NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),  -- puntos básicos: 2100 = 21 %
  prices_include_tax boolean NOT NULL DEFAULT true,               -- B2C en la UE: precios con IVA incluido
  PRIMARY KEY (tenant_id, country)
);

-- ---------------------------------------------------------------------------------------------------------
-- Clientes: únicos por tienda. El mismo email en dos tiendas son dos clientes distintos (contraste con Vendure).
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE commerce.customers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  email citext NOT NULL CHECK (length(email) <= 254),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  address jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, email)
);

-- ---------------------------------------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------------------------------------
-- Numeración por tienda (1, 2, 3… dentro de cada tienda). Los IDs globales siguen siendo UUIDv7: nada
-- secuencial compartido entre tiendas (contraste con Vendure, PoC B hallazgo 4).
CREATE TABLE commerce.order_counters (
  tenant_id uuid PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);

CREATE TABLE commerce.orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  customer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
  currency char(3) NOT NULL,
  ship_country char(2) NOT NULL,
  tax_rate_bp integer NOT NULL,
  prices_include_tax boolean NOT NULL,
  subtotal bigint NOT NULL CHECK (subtotal >= 0),   -- suma de líneas, tal como se mostraron al cliente
  tax_total bigint NOT NULL CHECK (tax_total >= 0),
  total bigint NOT NULL CHECK (total >= 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES commerce.customers (tenant_id, id),
  CHECK (total = CASE WHEN prices_include_tax THEN subtotal ELSE subtotal + tax_total END)
);
CREATE INDEX ON commerce.orders (tenant_id, created_at DESC);

CREATE TABLE commerce.order_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  sku text NOT NULL,             -- copia en el momento de la compra: el catálogo puede cambiar después
  title text NOT NULL,
  unit_price bigint NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  line_total bigint NOT NULL,
  CHECK (line_total = unit_price * quantity),
  FOREIGN KEY (tenant_id, order_id) REFERENCES commerce.orders (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, variant_id) REFERENCES commerce.product_variants (tenant_id, id)
);
CREATE INDEX ON commerce.order_lines (tenant_id, order_id);

-- Invariante en la BD: al confirmar la transacción, el subtotal del pedido es la suma de sus líneas y hay al
-- menos una línea. Si el código TS calcula mal o inserta a medias, el COMMIT falla.
CREATE FUNCTION commerce.check_order_totals() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, commerce AS $$
DECLARE s bigint; n int; v_order uuid;
BEGIN
  IF TG_TABLE_NAME = 'order_lines' THEN v_order := NEW.order_id; ELSE v_order := NEW.id; END IF;
  SELECT COALESCE(sum(line_total), 0), count(*) INTO s, n FROM commerce.order_lines WHERE order_id = v_order;
  IF n = 0 THEN RAISE EXCEPTION 'ORDER_WITHOUT_LINES' USING ERRCODE = '23514'; END IF;
  IF s <> (SELECT subtotal FROM commerce.orders WHERE id = v_order) THEN
    RAISE EXCEPTION 'ORDER_SUBTOTAL_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER orders_totals AFTER INSERT OR UPDATE ON commerce.orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_order_totals();
CREATE CONSTRAINT TRIGGER order_lines_totals AFTER INSERT OR UPDATE ON commerce.order_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.check_order_totals();

-- Máquina de estados en la BD. Solo owner/admin cancelan o reembolsan; el staff puede marcar pagado/enviado.
-- Los importes, la moneda, el cliente y el número no se pueden cambiar tras crear el pedido.
CREATE FUNCTION commerce.order_transition_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, commerce AS $$
BEGIN
  IF (NEW.subtotal, NEW.tax_total, NEW.total, NEW.currency, NEW.customer_id, NEW.number, NEW.tenant_id)
     IS DISTINCT FROM (OLD.subtotal, OLD.tax_total, OLD.total, OLD.currency, OLD.customer_id, OLD.number, OLD.tenant_id) THEN
    RAISE EXCEPTION 'ORDER_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT ((OLD.status, NEW.status) IN (('pending','paid'), ('pending','cancelled'), ('paid','fulfilled'),
                                       ('paid','refunded'), ('paid','cancelled'), ('fulfilled','refunded'))) THEN
    RAISE EXCEPTION 'ILLEGAL_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('cancelled', 'refunded') AND commerce.current_store_role() NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'TRANSITION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER orders_transition BEFORE UPDATE ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.order_transition_guard();

-- ---------------------------------------------------------------------------------------------------------
-- RLS: aislamiento por tienda en todas las tablas nuevas
-- ---------------------------------------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'product_variants', 'inventory_levels', 'tax_rates', 'customers',
                           'order_counters', 'orders', 'order_lines'] LOOP
    EXECUTE format('ALTER TABLE commerce.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE commerce.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON commerce.%I TO mc_app
      USING (tenant_id = (SELECT commerce.current_tenant()))
      WITH CHECK (tenant_id = (SELECT commerce.current_tenant()))$p$, t);
  END LOOP;
END $$;

-- Regla 5b: escrituras de catálogo y de impuestos solo owner/admin, también si alguien usa mc_app directo.
DO $$ DECLARE t text; op text; BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'product_variants', 'tax_rates'] LOOP
    FOREACH op IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF op = 'INSERT' THEN
        EXECUTE format($p$CREATE POLICY catalog_write_role_%s ON commerce.%I AS RESTRICTIVE FOR INSERT TO mc_app
          WITH CHECK ((SELECT commerce.current_store_role()) IN ('owner', 'admin'))$p$, lower(op), t);
      ELSE
        EXECUTE format($p$CREATE POLICY catalog_write_role_%s ON commerce.%I AS RESTRICTIVE FOR %s TO mc_app
          USING ((SELECT commerce.current_store_role()) IN ('owner', 'admin'))$p$, lower(op), t, op);
      END IF;
    END LOOP;
  END LOOP;
END $$;
-- Dar de alta stock inicial también es una operación de catálogo; descontarlo lo puede hacer cualquier miembro.
CREATE POLICY inventory_insert_role ON commerce.inventory_levels AS RESTRICTIVE FOR INSERT TO mc_app
  WITH CHECK ((SELECT commerce.current_store_role()) IN ('owner', 'admin'));

-- Privilegios mínimos de mc_app. Sin DELETE en pedidos ni líneas (se cancelan, no se borran).
GRANT SELECT, INSERT, UPDATE, DELETE ON commerce.products, commerce.product_variants, commerce.tax_rates TO mc_app;
GRANT SELECT, INSERT, UPDATE (on_hand, updated_at) ON commerce.inventory_levels TO mc_app;
GRANT SELECT, INSERT, UPDATE (name, address) ON commerce.customers TO mc_app;
GRANT SELECT, INSERT, UPDATE (last_number) ON commerce.order_counters TO mc_app;
GRANT SELECT, INSERT, UPDATE (status, updated_at) ON commerce.orders TO mc_app;
GRANT SELECT, INSERT ON commerce.order_lines TO mc_app;
