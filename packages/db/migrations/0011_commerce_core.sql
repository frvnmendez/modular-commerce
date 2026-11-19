-- 0011: núcleo de venta (Hito 1 de la R2). Catálogo, inventario, imágenes, clientes, pedidos, pagos y el
-- escaparate público. Basado en el spike del ADR-0001 (spikes/own-core), con estos cambios:
--
--  * Contexto v2 (bloqueante 1 del análisis 2026-11-10). El comprador y los avisos de pago no tienen sesión
--    de staff, así que no usan mc_app ni request_context. Entran por dos roles nuevos sin acceso a tablas:
--      - mc_storefront: solo puede ejecutar las funciones storefront.* (leer el escaparate publicado de una
--        tienda y crear un pedido pendiente).
--      - mc_payments:   solo puede ejecutar las funciones payments.* (confirmar o caducar un pago).
--    Cada función recibe la tienda de forma explícita (slug o pedido) y solo toca filas de esa tienda.
--  * Los pedidos ya no los inserta mc_app (bloqueante 2): mc_app solo puede leerlos y cambiar su estado.
--    Crear un pedido es storefront.create_checkout, que calcula los importes en la BD a partir del catálogo.
--  * Pasar un pedido a «pagado» solo lo puede hacer payments.mark_paid (ni siquiera el propietario desde el
--    panel), y solo si el importe y la sesión de pago coinciden con el pedido.
--  * Importes en bigint de céntimos de punta a punta (bloqueante 4: nada de ::int).
--  * Los precios van en la moneda de la tienda; la moneda se bloquea en cuanto hay productos.

-- ---------------------------------------------------------------------------------------------------------
-- Ajustes de venta de la tienda
-- ---------------------------------------------------------------------------------------------------------
ALTER TABLE commerce.store_settings
  ADD COLUMN storefront_published boolean NOT NULL DEFAULT false,
  ADD COLUMN shipping_flat_amount bigint NOT NULL DEFAULT 0 CHECK (shipping_flat_amount BETWEEN 0 AND 100000000),
  ADD COLUMN free_shipping_threshold bigint CHECK (free_shipping_threshold BETWEEN 0 AND 100000000000),
  ADD COLUMN contact_email citext CHECK (length(contact_email) <= 254);

-- ---------------------------------------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE commerce.products (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  handle text NOT NULL CHECK (handle ~ '^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$'),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, handle)
);
CREATE INDEX ON commerce.products (tenant_id, created_at DESC);

CREATE TABLE commerce.product_variants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  sku text CHECK (length(sku) BETWEEN 1 AND 64),
  price_amount bigint NOT NULL CHECK (price_amount BETWEEN 0 AND 100000000000),          -- céntimos
  compare_at_amount bigint CHECK (compare_at_amount BETWEEN 0 AND 100000000000),          -- precio «antes»
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES commerce.products (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ON commerce.product_variants (tenant_id, product_id);
CREATE UNIQUE INDEX ON commerce.product_variants (tenant_id, sku) WHERE sku IS NOT NULL;

-- Inventario de una ubicación. El stock se descuenta al crear el pedido pendiente (reserva) y se devuelve si
-- el pedido caduca o se cancela.
CREATE TABLE commerce.inventory_levels (
  tenant_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  on_hand integer NOT NULL CHECK (on_hand BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, variant_id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES commerce.product_variants (tenant_id, id) ON DELETE CASCADE
);

-- Imágenes. El fichero vive en disco (UPLOAD_DIR/<tenant>/<file_name>); el nombre es aleatorio.
CREATE TABLE commerce.product_images (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  file_name text NOT NULL CHECK (file_name ~ '^[a-f0-9]{32}\.(jpg|png|webp)$'),
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES commerce.products (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ON commerce.product_images (tenant_id, product_id, position);

-- IVA por país. En el Hito 1 solo se vende al país de la tienda; precios con impuesto incluido por defecto.
CREATE TABLE commerce.tax_rates (
  tenant_id uuid NOT NULL,
  country char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  rate_bp integer NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),  -- puntos básicos: 2100 = 21 %
  prices_include_tax boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, country)
);

-- ---------------------------------------------------------------------------------------------------------
-- Clientes (únicos por tienda: el mismo email en dos tiendas son dos clientes distintos)
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE commerce.customers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  email citext NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  phone text CHECK (length(phone) <= 40),
  address jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, email)
);

-- ---------------------------------------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE commerce.order_counters (
  tenant_id uuid PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);

CREATE TABLE commerce.orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  customer_id uuid NOT NULL,
  email citext NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
  currency char(3) NOT NULL,
  ship_country char(2) NOT NULL,
  ship_address jsonb NOT NULL,
  tax_rate_bp integer NOT NULL,
  prices_include_tax boolean NOT NULL,
  subtotal bigint NOT NULL CHECK (subtotal >= 0),
  shipping_total bigint NOT NULL CHECK (shipping_total >= 0),
  tax_total bigint NOT NULL CHECK (tax_total >= 0),
  total bigint NOT NULL CHECK (total >= 0),
  access_token_hash text NOT NULL CHECK (access_token_hash ~ '^[a-f0-9]{64}$'),   -- enlace de «gracias» del comprador
  checkout_expires_at timestamptz NOT NULL,
  payment_provider text NOT NULL CHECK (payment_provider IN ('stripe', 'fake')),
  payment_session_id text UNIQUE CHECK (length(payment_session_id) <= 255),
  payment_intent_id text CHECK (length(payment_intent_id) <= 255),
  paid_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES commerce.customers (tenant_id, id),
  CHECK (total = subtotal + shipping_total + CASE WHEN prices_include_tax THEN 0 ELSE tax_total END)
);
CREATE INDEX ON commerce.orders (tenant_id, created_at DESC);
CREATE INDEX ON commerce.orders (checkout_expires_at) WHERE status = 'pending';

CREATE TABLE commerce.order_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  product_title text NOT NULL,   -- copias en el momento de la compra: el catálogo puede cambiar después
  variant_title text NOT NULL,
  sku text,
  unit_price bigint NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  line_total bigint NOT NULL,
  CHECK (line_total = unit_price * quantity),
  FOREIGN KEY (tenant_id, order_id) REFERENCES commerce.orders (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, variant_id) REFERENCES commerce.product_variants (tenant_id, id)
);
CREATE INDEX ON commerce.order_lines (tenant_id, order_id);
CREATE INDEX ON commerce.order_lines (variant_id);

-- Avisos de pago recibidos (idempotencia: un mismo evento del proveedor solo se procesa una vez).
CREATE TABLE commerce.payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  provider text NOT NULL,
  event_id text NOT NULL CHECK (length(event_id) BETWEEN 1 AND 255),
  type text NOT NULL,
  result text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES commerce.orders (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ON commerce.payment_events (tenant_id, order_id);

-- Invariante: al confirmar la transacción el subtotal es la suma de las líneas y hay al menos una línea.
-- SECURITY DEFINER porque es diferido: se ejecuta en el COMMIT, ya fuera de storefront.create_checkout, con el
-- rol de la sesión (mc_storefront no tiene acceso al esquema). Solo lee.
CREATE FUNCTION commerce.check_order_totals() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
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

-- ¿Escribe una función de confianza (SECURITY DEFINER del dueño) y no mc_app directamente?
CREATE FUNCTION commerce.trusted_writer() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT current_user = 'mc_migrator' $$;

-- Máquina de estados en la BD.
--   pending → paid        solo payments.mark_paid (importe y sesión verificados)
--   pending → cancelled   caducidad (función de confianza) u owner/admin
--   paid → fulfilled      cualquier miembro de la tienda
--   paid|fulfilled → refunded   owner/admin (la API hace antes el reembolso en el proveedor)
-- Importes, cliente, número y datos de envío son inmutables tras crear el pedido.
CREATE FUNCTION commerce.order_transition_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, commerce AS $$
DECLARE role text := commerce.current_store_role(); trusted boolean := commerce.trusted_writer();
BEGIN
  IF (NEW.subtotal, NEW.shipping_total, NEW.tax_total, NEW.total, NEW.currency, NEW.customer_id, NEW.number, NEW.tenant_id,
      NEW.email, NEW.ship_address, NEW.access_token_hash, NEW.payment_provider)
     IS DISTINCT FROM (OLD.subtotal, OLD.shipping_total, OLD.tax_total, OLD.total, OLD.currency, OLD.customer_id, OLD.number,
      OLD.tenant_id, OLD.email, OLD.ship_address, OLD.access_token_hash, OLD.payment_provider) THEN
    RAISE EXCEPTION 'ORDER_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NOT trusted AND (NEW.payment_session_id, NEW.payment_intent_id, NEW.paid_at)
                     IS DISTINCT FROM (OLD.payment_session_id, OLD.payment_intent_id, OLD.paid_at) THEN
    RAISE EXCEPTION 'ORDER_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT ((OLD.status, NEW.status) IN (('pending','paid'), ('pending','cancelled'), ('paid','fulfilled'),
                                       ('paid','refunded'), ('fulfilled','refunded'))) THEN
    RAISE EXCEPTION 'ILLEGAL_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'paid' AND NOT trusted THEN
    RAISE EXCEPTION 'PAYMENT_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('cancelled', 'refunded') AND NOT trusted AND coalesce(role, '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'TRANSITION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  CASE NEW.status
    WHEN 'paid' THEN NEW.paid_at := coalesce(NEW.paid_at, now());
    WHEN 'fulfilled' THEN NEW.fulfilled_at := now();
    WHEN 'cancelled' THEN NEW.cancelled_at := now();
    WHEN 'refunded' THEN NEW.refunded_at := now();
  END CASE;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_transition BEFORE UPDATE ON commerce.orders
  FOR EACH ROW EXECUTE FUNCTION commerce.order_transition_guard();

-- Cancelar un pedido sin pagar devuelve su stock reservado. Solo toca las líneas de ese pedido.
CREATE FUNCTION commerce.restock_cancelled_order() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
BEGIN
  UPDATE commerce.inventory_levels i SET on_hand = i.on_hand + l.quantity, updated_at = now()
  FROM commerce.order_lines l
  WHERE l.order_id = NEW.id AND l.tenant_id = NEW.tenant_id AND i.tenant_id = NEW.tenant_id AND i.variant_id = l.variant_id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION commerce.restock_cancelled_order() FROM PUBLIC;
CREATE TRIGGER orders_restock AFTER UPDATE OF status ON commerce.orders
  FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status = 'cancelled')
  EXECUTE FUNCTION commerce.restock_cancelled_order();

-- ---------------------------------------------------------------------------------------------------------
-- RLS: aislamiento por tienda en todas las tablas nuevas (patrón con subselect, ver 0007)
-- ---------------------------------------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'product_variants', 'inventory_levels', 'product_images', 'tax_rates', 'customers',
                           'order_counters', 'orders', 'order_lines', 'payment_events'] LOOP
    EXECUTE format('ALTER TABLE commerce.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE commerce.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON commerce.%I TO mc_app
      USING (tenant_id = (SELECT commerce.current_tenant()))
      WITH CHECK (tenant_id = (SELECT commerce.current_tenant()))$p$, t);
  END LOOP;
END $$;

-- Regla 5b: el IVA es un ajuste de la tienda (owner/admin), también si alguien usa mc_app directamente.
CREATE POLICY tax_write_role_insert ON commerce.tax_rates AS RESTRICTIVE FOR INSERT TO mc_app
  WITH CHECK ((SELECT commerce.current_store_role()) IN ('owner', 'admin'));
CREATE POLICY tax_write_role_update ON commerce.tax_rates AS RESTRICTIVE FOR UPDATE TO mc_app
  USING ((SELECT commerce.current_store_role()) IN ('owner', 'admin'));
CREATE POLICY tax_write_role_delete ON commerce.tax_rates AS RESTRICTIVE FOR DELETE TO mc_app
  USING ((SELECT commerce.current_store_role()) IN ('owner', 'admin'));

-- Privilegios de mc_app. El catálogo lo edita cualquier miembro (permiso catalog:write del rol staff).
-- Pedidos, líneas, clientes y contadores: sin INSERT ni DELETE. De los pedidos solo puede cambiar el estado.
GRANT SELECT, INSERT, UPDATE, DELETE ON commerce.products, commerce.product_variants, commerce.product_images TO mc_app;
GRANT SELECT, INSERT, UPDATE (on_hand, updated_at) ON commerce.inventory_levels TO mc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON commerce.tax_rates TO mc_app;
GRANT SELECT ON commerce.customers, commerce.order_lines, commerce.payment_events TO mc_app;
GRANT SELECT, UPDATE (status) ON commerce.orders TO mc_app;

-- La moneda de la tienda no se puede cambiar cuando ya hay productos (los precios están en esa moneda).
CREATE OR REPLACE FUNCTION control.update_store(p_store uuid, p_name text, p_country text, p_currency text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE me text := control.current_user_id(); r text := control.store_role(p_store); cur text;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF r NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT currency INTO cur FROM control.stores WHERE id = p_store FOR UPDATE;
  IF p_currency IS NOT NULL AND p_currency <> cur AND EXISTS (SELECT 1 FROM commerce.products WHERE tenant_id = p_store) THEN
    RAISE EXCEPTION 'CURRENCY_LOCKED' USING ERRCODE = '23514';
  END IF;
  UPDATE control.stores SET name = coalesce(p_name, name), country = coalesce(p_country, country),
         currency = coalesce(p_currency, currency) WHERE id = p_store;
  INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_store, me, 'store.updated', 'store', p_store::text,
            jsonb_strip_nulls(jsonb_build_object('name', p_name, 'country', p_country, 'currency', p_currency)));
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Escaparate público (rol mc_storefront)
-- ---------------------------------------------------------------------------------------------------------
CREATE SCHEMA storefront;
CREATE SCHEMA payments;
REVOKE ALL ON SCHEMA storefront, payments FROM PUBLIC;

-- Tienda activa y publicada por su slug. Interna: no se concede a nadie.
CREATE FUNCTION storefront.resolve_store(p_slug text) RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE sid uuid;
BEGIN
  SELECT s.id INTO sid FROM control.stores s JOIN commerce.store_settings st ON st.tenant_id = s.id
  WHERE s.slug = p_slug AND s.status = 'active' AND st.storefront_published;
  IF sid IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  RETURN sid;
END $$;

CREATE FUNCTION storefront.get_store(p_slug text) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
  SELECT jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'country', s.country, 'currency', s.currency,
           'shippingFlatAmount', st.shipping_flat_amount, 'freeShippingThreshold', st.free_shipping_threshold,
           'contactEmail', st.contact_email)
  FROM control.stores s JOIN commerce.store_settings st ON st.tenant_id = s.id
  WHERE s.id = storefront.resolve_store(p_slug)
$$;

-- Productos activos con al menos una variante. Importes como texto para no perder precisión en JSON.
CREATE FUNCTION storefront.list_products(p_slug text) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
  WITH sid AS (SELECT storefront.resolve_store(p_slug) AS id)
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
    SELECT p.created_at, jsonb_build_object(
      'handle', p.handle, 'title', p.title,
      'priceFrom', (SELECT min(v.price_amount)::text FROM commerce.product_variants v WHERE v.tenant_id = p.tenant_id AND v.product_id = p.id),
      'image', (SELECT p.tenant_id::text || '/' || i.file_name FROM commerce.product_images i
                WHERE i.tenant_id = p.tenant_id AND i.product_id = p.id ORDER BY i.position, i.created_at LIMIT 1),
      'available', EXISTS (SELECT 1 FROM commerce.product_variants v JOIN commerce.inventory_levels l
                           ON l.tenant_id = v.tenant_id AND l.variant_id = v.id
                           WHERE v.tenant_id = p.tenant_id AND v.product_id = p.id AND l.on_hand > 0)) AS j
    FROM commerce.products p, sid
    WHERE p.tenant_id = sid.id AND p.status = 'active'
      AND EXISTS (SELECT 1 FROM commerce.product_variants v WHERE v.tenant_id = p.tenant_id AND v.product_id = p.id)
    ORDER BY p.created_at DESC LIMIT 500
  ) x
$$;

CREATE FUNCTION storefront.get_product(p_slug text, p_handle text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
DECLARE sid uuid := storefront.resolve_store(p_slug); p commerce.products%ROWTYPE;
BEGIN
  SELECT * INTO p FROM commerce.products WHERE tenant_id = sid AND handle = p_handle AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object(
    'handle', p.handle, 'title', p.title, 'description', p.description,
    'images', (SELECT coalesce(jsonb_agg(sid::text || '/' || i.file_name ORDER BY i.position, i.created_at), '[]'::jsonb)
               FROM commerce.product_images i WHERE i.tenant_id = sid AND i.product_id = p.id),
    'variants', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', v.id, 'title', v.title, 'price', v.price_amount::text, 'compareAt', v.compare_at_amount::text,
                   'available', least(coalesce(l.on_hand, 0), 20)) ORDER BY v.position, v.created_at), '[]'::jsonb)
                 FROM commerce.product_variants v LEFT JOIN commerce.inventory_levels l ON l.tenant_id = v.tenant_id AND l.variant_id = v.id
                 WHERE v.tenant_id = sid AND v.product_id = p.id));
END $$;

-- Cancela los pedidos pendientes caducados (todas las tiendas, o una). Devuelve cuántos.
CREATE FUNCTION payments.expire_overdue(p_tenant uuid DEFAULT NULL) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
DECLARE n integer;
BEGIN
  WITH due AS (
    SELECT id FROM commerce.orders
    WHERE status = 'pending' AND checkout_expires_at < now() AND (p_tenant IS NULL OR tenant_id = p_tenant)
    ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 500
  )
  UPDATE commerce.orders o SET status = 'cancelled' FROM due WHERE o.id = due.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Crea un pedido pendiente: valida el carrito contra el catálogo publicado, reserva stock y calcula los
-- importes en la BD. El cliente no envía precios: solo variantes y cantidades.
CREATE FUNCTION storefront.create_checkout(p_slug text, p_order_id uuid, p_lines jsonb, p_customer jsonb,
                                           p_access_token_hash text, p_provider text, p_ttl interval)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE
  sid uuid := storefront.resolve_store(p_slug);
  st commerce.store_settings%ROWTYPE;
  store control.stores%ROWTYPE;
  qty jsonb := '{}'::jsonb;
  ln jsonb; vid uuid; q integer; n_lines integer := 0;
  rec record; found_count integer := 0; lines jsonb := '[]'::jsonb;
  v_subtotal bigint := 0; v_shipping bigint; v_tax bigint; v_rate integer := 0; v_incl boolean := true; v_total bigint;
  v_customer uuid; v_number integer; v_email text; v_name text; v_phone text; v_addr jsonb;
BEGIN
  IF p_provider NOT IN ('stripe', 'fake') THEN RAISE EXCEPTION 'INVALID_PROVIDER' USING ERRCODE = '22023'; END IF;
  IF p_ttl < interval '5 minutes' OR p_ttl > interval '2 hours' THEN RAISE EXCEPTION 'INVALID_TTL' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'INVALID_CART' USING ERRCODE = '22023';
  END IF;
  -- Cantidades agrupadas por variante (máx. 20 unidades por variante).
  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    vid := (ln->>'variantId')::uuid; q := (ln->>'quantity')::integer;
    IF vid IS NULL OR q IS NULL OR q < 1 THEN RAISE EXCEPTION 'INVALID_CART' USING ERRCODE = '22023'; END IF;
    qty := jsonb_set(qty, ARRAY[vid::text], to_jsonb(coalesce((qty->>vid::text)::integer, 0) + q));
    IF (qty->>vid::text)::integer > 20 THEN RAISE EXCEPTION 'QUANTITY_LIMIT' USING ERRCODE = '23514'; END IF;
  END LOOP;

  v_email := lower(trim(p_customer->>'email'));
  v_name := trim(p_customer->>'name');
  v_phone := nullif(trim(coalesce(p_customer->>'phone', '')), '');
  v_addr := p_customer->'address';
  IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254
     OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 200 OR jsonb_typeof(v_addr) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE = '22023';
  END IF;

  -- Libera reservas caducadas de esta tienda antes de comprobar stock.
  PERFORM payments.expire_overdue(sid);

  SELECT * INTO store FROM control.stores WHERE id = sid;
  SELECT * INTO st FROM commerce.store_settings WHERE tenant_id = sid;

  -- Bloqueo en orden estable (por id) para evitar interbloqueos entre compras simultáneas.
  FOR rec IN
    SELECT v.id, v.title AS vtitle, v.sku, v.price_amount, p.title AS ptitle, l.on_hand
    FROM commerce.product_variants v
    JOIN commerce.products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
    JOIN commerce.inventory_levels l ON l.tenant_id = v.tenant_id AND l.variant_id = v.id
    WHERE v.tenant_id = sid AND p.status = 'active' AND v.id IN (SELECT k::uuid FROM jsonb_object_keys(qty) k)
    ORDER BY v.id FOR UPDATE OF l
  LOOP
    found_count := found_count + 1;
    q := (qty->>rec.id::text)::integer;
    IF rec.on_hand < q THEN RAISE EXCEPTION 'OUT_OF_STOCK' USING ERRCODE = '23514'; END IF;
    UPDATE commerce.inventory_levels SET on_hand = on_hand - q, updated_at = now() WHERE tenant_id = sid AND variant_id = rec.id;
    lines := lines || jsonb_build_object('variant_id', rec.id, 'product_title', rec.ptitle, 'variant_title', rec.vtitle,
                                         'sku', rec.sku, 'unit_price', rec.price_amount, 'quantity', q);
    v_subtotal := v_subtotal + rec.price_amount * q;
  END LOOP;
  SELECT count(*) INTO n_lines FROM jsonb_object_keys(qty);
  -- Una variante de otra tienda, inexistente o de un producto no publicado: mismo error.
  IF found_count <> n_lines THEN RAISE EXCEPTION 'VARIANT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  v_shipping := CASE WHEN st.free_shipping_threshold IS NOT NULL AND v_subtotal >= st.free_shipping_threshold THEN 0
                     ELSE st.shipping_flat_amount END;
  SELECT rate_bp, prices_include_tax INTO v_rate, v_incl FROM commerce.tax_rates WHERE tenant_id = sid AND country = store.country;
  v_rate := coalesce(v_rate, 0); v_incl := coalesce(v_incl, true);
  -- IVA sobre productos y envío, redondeado una vez por pedido (mitad hacia arriba).
  IF v_incl THEN
    v_tax := (v_subtotal + v_shipping) - round((v_subtotal + v_shipping)::numeric * 10000 / (10000 + v_rate))::bigint;
    v_total := v_subtotal + v_shipping;
  ELSE
    v_tax := round((v_subtotal + v_shipping)::numeric * v_rate / 10000)::bigint;
    v_total := v_subtotal + v_shipping + v_tax;
  END IF;

  INSERT INTO commerce.customers (id, tenant_id, email, name, phone, address)
    VALUES (p_order_id, sid, v_email, v_name, v_phone, v_addr)
    ON CONFLICT (tenant_id, email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, address = EXCLUDED.address, updated_at = now()
    RETURNING id INTO v_customer;

  INSERT INTO commerce.order_counters (tenant_id, last_number) VALUES (sid, 1)
    ON CONFLICT (tenant_id) DO UPDATE SET last_number = commerce.order_counters.last_number + 1 RETURNING last_number INTO v_number;

  INSERT INTO commerce.orders (id, tenant_id, number, customer_id, email, currency, ship_country, ship_address, tax_rate_bp,
      prices_include_tax, subtotal, shipping_total, tax_total, total, access_token_hash, checkout_expires_at, payment_provider,
      payment_session_id)
    VALUES (p_order_id, sid, v_number, v_customer, v_email, store.currency, store.country, v_addr, v_rate, v_incl,
      v_subtotal, v_shipping, v_tax, v_total, p_access_token_hash, now() + p_ttl, p_provider,
      CASE WHEN p_provider = 'fake' THEN 'fake_' || p_order_id::text END);

  INSERT INTO commerce.order_lines (id, tenant_id, order_id, variant_id, product_title, variant_title, sku, unit_price, quantity, line_total)
    SELECT gen_random_uuid(), sid, p_order_id, x.variant_id, x.product_title, x.variant_title, x.sku, x.unit_price, x.quantity,
           x.unit_price * x.quantity
    FROM jsonb_to_recordset(lines) AS x(variant_id uuid, product_title text, variant_title text, sku text, unit_price bigint, quantity integer);

  RETURN storefront.order_json(p_order_id);
END $$;

-- Representación JSON de un pedido para el comprador (sin datos internos). Interna.
CREATE FUNCTION storefront.order_json(p_order uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
  SELECT jsonb_build_object('orderId', o.id, 'number', o.number, 'status', o.status, 'currency', o.currency, 'email', o.email,
    'storeId', o.tenant_id, 'storeName', s.name, 'storeSlug', s.slug, 'contactEmail', st.contact_email,
    'subtotal', o.subtotal::text, 'shippingTotal', o.shipping_total::text, 'taxTotal', o.tax_total::text, 'total', o.total::text,
    'taxRateBp', o.tax_rate_bp, 'pricesIncludeTax', o.prices_include_tax, 'expiresAt', o.checkout_expires_at,
    'provider', o.payment_provider, 'shipAddress', o.ship_address,
    'lines', (SELECT jsonb_agg(jsonb_build_object('productTitle', l.product_title, 'variantTitle', l.variant_title,
                'unitPrice', l.unit_price::text, 'quantity', l.quantity, 'lineTotal', l.line_total::text) ORDER BY l.product_title, l.variant_title)
              FROM commerce.order_lines l WHERE l.tenant_id = o.tenant_id AND l.order_id = o.id))
  FROM commerce.orders o JOIN control.stores s ON s.id = o.tenant_id JOIN commerce.store_settings st ON st.tenant_id = o.tenant_id
  WHERE o.id = p_order
$$;

-- Guarda la sesión de pago del proveedor en un pedido pendiente que aún no tiene ninguna.
CREATE FUNCTION storefront.attach_payment_session(p_order uuid, p_session text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
BEGIN
  UPDATE commerce.orders SET payment_session_id = p_session
  WHERE id = p_order AND status = 'pending' AND payment_session_id IS NULL AND payment_provider = 'stripe';
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
END $$;

-- Resumen del pedido para la página de «gracias»: exige el token del enlace (solo lo conoce el comprador).
CREATE FUNCTION storefront.order_summary(p_slug text, p_order uuid, p_token_hash text) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE ok boolean;
BEGIN
  SELECT true INTO ok FROM commerce.orders o JOIN control.stores s ON s.id = o.tenant_id
  WHERE o.id = p_order AND s.slug = p_slug AND o.access_token_hash = p_token_hash;
  IF ok IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  RETURN storefront.order_json(p_order);
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Pagos (rol mc_payments). La API solo llama aquí tras verificar la firma del aviso del proveedor.
-- ---------------------------------------------------------------------------------------------------------
-- Resultado: paid | duplicate | mismatch | late | unknown. Solo «paid» cambia el pedido.
CREATE FUNCTION payments.mark_paid(p_order uuid, p_provider text, p_session text, p_intent text, p_amount bigint,
                                   p_currency text, p_event_id text) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
DECLARE o commerce.orders%ROWTYPE; res text; inserted integer;
BEGIN
  SELECT * INTO o FROM commerce.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'unknown'); END IF;
  INSERT INTO commerce.payment_events (tenant_id, order_id, provider, event_id, type, result)
    VALUES (o.tenant_id, o.id, p_provider, p_event_id, 'payment.succeeded', 'pending')
    ON CONFLICT (provider, event_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN RETURN storefront.order_json(o.id) || jsonb_build_object('result', 'duplicate'); END IF;

  IF o.payment_provider <> p_provider OR o.payment_session_id IS DISTINCT FROM p_session
     OR o.total <> p_amount OR upper(p_currency) <> o.currency THEN
    res := 'mismatch';
  ELSIF o.status = 'pending' THEN
    UPDATE commerce.orders SET status = 'paid', paid_at = now(), payment_intent_id = p_intent WHERE id = o.id;
    res := 'paid';
  ELSIF o.status IN ('paid', 'fulfilled', 'refunded') THEN
    res := 'duplicate';
  ELSE
    res := 'late';   -- pagado después de caducar: la API lo reembolsa
  END IF;
  UPDATE commerce.payment_events SET result = res WHERE provider = p_provider AND event_id = p_event_id;
  RETURN storefront.order_json(o.id) || jsonb_build_object('result', res);
END $$;

-- La sesión de pago caducó sin pagarse: cancela el pedido y devuelve el stock.
CREATE FUNCTION payments.expire_session(p_order uuid, p_session text, p_event_id text) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
DECLARE o commerce.orders%ROWTYPE; inserted integer;
BEGIN
  SELECT * INTO o FROM commerce.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR o.payment_session_id IS DISTINCT FROM p_session THEN RETURN 'unknown'; END IF;
  INSERT INTO commerce.payment_events (tenant_id, order_id, provider, event_id, type, result)
    VALUES (o.tenant_id, o.id, o.payment_provider, p_event_id, 'session.expired', 'ok')
    ON CONFLICT (provider, event_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN RETURN 'duplicate'; END IF;
  IF o.status = 'pending' THEN UPDATE commerce.orders SET status = 'cancelled' WHERE id = o.id; RETURN 'cancelled'; END IF;
  RETURN 'ignored';
END $$;

-- Datos mínimos para que la API reembolse un pago tardío. Interna de payments.
CREATE FUNCTION payments.record_refund(p_order uuid, p_event_id text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
DECLARE o commerce.orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM commerce.orders WHERE id = p_order;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO commerce.payment_events (tenant_id, order_id, provider, event_id, type, result)
    VALUES (o.tenant_id, o.id, o.payment_provider, p_event_id, 'refund.late_payment', 'ok')
    ON CONFLICT (provider, event_id) DO NOTHING;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA storefront, payments FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce.check_order_totals(), commerce.order_transition_guard(), commerce.trusted_writer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commerce.trusted_writer() TO mc_app;
GRANT USAGE ON SCHEMA storefront TO mc_storefront;
GRANT EXECUTE ON FUNCTION storefront.get_store(text), storefront.list_products(text), storefront.get_product(text, text),
  storefront.create_checkout(text, uuid, jsonb, jsonb, text, text, interval), storefront.attach_payment_session(uuid, text),
  storefront.order_summary(text, uuid, text) TO mc_storefront;
GRANT USAGE ON SCHEMA payments TO mc_payments;
GRANT EXECUTE ON FUNCTION payments.mark_paid(uuid, text, text, text, bigint, text, text), payments.expire_session(uuid, text, text),
  payments.expire_overdue(uuid), payments.record_refund(uuid, text) TO mc_payments;
