-- 0012: Hito 2 — abrir la plataforma a otros comerciantes.
--
--  * Cobros por tienda (Stripe Connect, cargos con destino): cada tienda conecta su propia cuenta de Stripe.
--    El id de la cuenta lo guarda la API (mc_app, solo propietario/administrador) tras crearla en Stripe; su
--    estado («puede cobrar») solo lo cambia payments.update_account con datos leídos de Stripe, nunca el panel.
--  * El pedido guarda la cuenta a la que se cobró. attach_payment_session exige que sea la cuenta lista de
--    su tienda, así que un pedido no puede cobrarse en la cuenta de otra tienda.
--  * Diseño de la tienda: logo, portada, color, titular y subtítulo.
--  * Subdominios <slug>.<dominio>: se reservan los nombres que usa la plataforma.

-- ---------------------------------------------------------------------------------------------------------
-- Nombres reservados (subdominios de la plataforma)
-- ---------------------------------------------------------------------------------------------------------
ALTER TABLE control.stores ADD CONSTRAINT stores_slug_not_reserved CHECK (slug NOT IN (
  'www', 'app', 'api', 'admin', 'panel', 'mail', 'smtp', 'imap', 'pop', 'ftp', 'cdn', 'static', 'media', 'assets',
  'status', 'help', 'ayuda', 'soporte', 'support', 'blog', 'docs', 'tienda', 'tiendas', 'stores', 'store', 'login',
  'auth', 'billing', 'pagos', 'payments', 'stripe', 'webhooks', 'dev', 'staging', 'test', 'demo', 'platform', 'plataforma'
)) NOT VALID;

-- ---------------------------------------------------------------------------------------------------------
-- Diseño de la tienda
-- ---------------------------------------------------------------------------------------------------------
ALTER TABLE commerce.store_settings
  ADD COLUMN accent_color text CHECK (accent_color ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN logo_file text CHECK (logo_file ~ '^[a-f0-9]{32}\.(jpg|png|webp)$'),
  ADD COLUMN banner_file text CHECK (banner_file ~ '^[a-f0-9]{32}\.(jpg|png|webp)$'),
  ADD COLUMN headline text CHECK (length(headline) <= 120),
  ADD COLUMN tagline text CHECK (length(tagline) <= 300);

-- ---------------------------------------------------------------------------------------------------------
-- Cuentas de cobro de cada tienda
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE commerce.payment_accounts (
  tenant_id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'stripe'),
  account_id text NOT NULL UNIQUE CHECK (account_id ~ '^acct_[A-Za-z0-9]{6,64}$'),
  charges_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE commerce.payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.payment_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON commerce.payment_accounts TO mc_app
  USING (tenant_id = (SELECT commerce.current_tenant())) WITH CHECK (tenant_id = (SELECT commerce.current_tenant()));
CREATE POLICY payment_accounts_owner_insert ON commerce.payment_accounts AS RESTRICTIVE FOR INSERT TO mc_app
  WITH CHECK ((SELECT commerce.current_store_role()) IN ('owner', 'admin'));
-- mc_app crea la fila con el id que le devolvió Stripe; el estado nace en «no puede cobrar».
GRANT SELECT, INSERT (tenant_id, provider, account_id) ON commerce.payment_accounts TO mc_app;

ALTER TABLE commerce.orders ADD COLUMN payment_account_id text CHECK (payment_account_id ~ '^acct_[A-Za-z0-9]{6,64}$');

-- El trigger de transiciones trata la cuenta de cobro como el resto de datos de pago: solo la fija una
-- función de confianza. (Igual que en 0011: NO es SECURITY DEFINER, para que trusted_writer() vea al invocador.)
CREATE OR REPLACE FUNCTION commerce.order_transition_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, commerce AS $$
DECLARE role text := commerce.current_store_role(); trusted boolean := commerce.trusted_writer();
BEGIN
  IF (NEW.subtotal, NEW.shipping_total, NEW.tax_total, NEW.total, NEW.currency, NEW.customer_id, NEW.number, NEW.tenant_id,
      NEW.email, NEW.ship_address, NEW.access_token_hash, NEW.payment_provider)
     IS DISTINCT FROM (OLD.subtotal, OLD.shipping_total, OLD.tax_total, OLD.total, OLD.currency, OLD.customer_id, OLD.number,
      OLD.tenant_id, OLD.email, OLD.ship_address, OLD.access_token_hash, OLD.payment_provider) THEN
    RAISE EXCEPTION 'ORDER_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NOT trusted AND (NEW.payment_session_id, NEW.payment_intent_id, NEW.payment_account_id, NEW.paid_at)
                     IS DISTINCT FROM (OLD.payment_session_id, OLD.payment_intent_id, OLD.payment_account_id, OLD.paid_at) THEN
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

-- ---------------------------------------------------------------------------------------------------------
-- Escaparate: la tienda incluye su diseño y si puede cobrar
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION storefront.get_store(p_slug text) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
  SELECT jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'country', s.country, 'currency', s.currency,
           'shippingFlatAmount', st.shipping_flat_amount, 'freeShippingThreshold', st.free_shipping_threshold,
           'contactEmail', st.contact_email,
           'accentColor', st.accent_color, 'logo', CASE WHEN st.logo_file IS NULL THEN NULL ELSE s.id || '/' || st.logo_file END,
           'banner', CASE WHEN st.banner_file IS NULL THEN NULL ELSE s.id || '/' || st.banner_file END,
           'headline', st.headline, 'tagline', st.tagline,
           'paymentAccountReady', coalesce(pa.charges_enabled, false))
  FROM control.stores s JOIN commerce.store_settings st ON st.tenant_id = s.id
  LEFT JOIN commerce.payment_accounts pa ON pa.tenant_id = s.id
  WHERE s.id = storefront.resolve_store(p_slug)
$$;

-- Cuenta lista para cobrar de una tienda publicada (NULL si no tiene).
CREATE FUNCTION storefront.payment_account(p_slug text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
  SELECT pa.account_id FROM commerce.payment_accounts pa
  WHERE pa.tenant_id = storefront.resolve_store(p_slug) AND pa.charges_enabled
$$;

-- La sesión de pago se guarda con la cuenta en la que se cobra. Si se indica cuenta, debe ser la cuenta
-- lista de la tienda del pedido; si no, la tienda no puede tener exigida una (modo de cuenta única).
DROP FUNCTION storefront.attach_payment_session(uuid, text);
CREATE FUNCTION storefront.attach_payment_session(p_order uuid, p_session text, p_account text DEFAULT NULL) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
DECLARE t uuid;
BEGIN
  SELECT tenant_id INTO t FROM commerce.orders WHERE id = p_order;
  IF p_account IS NOT NULL AND NOT EXISTS (SELECT 1 FROM commerce.payment_accounts
       WHERE tenant_id = t AND account_id = p_account AND charges_enabled) THEN
    RAISE EXCEPTION 'PAYMENT_ACCOUNT_MISMATCH' USING ERRCODE = '22023';
  END IF;
  UPDATE commerce.orders SET payment_session_id = p_session, payment_account_id = p_account
  WHERE id = p_order AND status = 'pending' AND payment_session_id IS NULL AND payment_provider = 'stripe';
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Pagos: estado de la cuenta (solo con datos leídos de Stripe) y datos para reembolsar
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION payments.update_account(p_account text, p_charges boolean, p_details boolean, p_payouts boolean) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
DECLARE t uuid;
BEGIN
  UPDATE commerce.payment_accounts SET charges_enabled = p_charges, details_submitted = p_details,
    payouts_enabled = p_payouts, updated_at = now()
  WHERE account_id = p_account RETURNING tenant_id INTO t;
  RETURN t;   -- NULL si la cuenta no es de ninguna tienda
END $$;

CREATE FUNCTION payments.order_account(p_order uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, commerce AS $$
  SELECT payment_account_id FROM commerce.orders WHERE id = p_order
$$;

REVOKE ALL ON FUNCTION storefront.payment_account(text), storefront.attach_payment_session(uuid, text, text),
  payments.update_account(text, boolean, boolean, boolean), payments.order_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storefront.payment_account(text), storefront.attach_payment_session(uuid, text, text) TO mc_storefront;
GRANT EXECUTE ON FUNCTION payments.update_account(text, boolean, boolean, boolean), payments.order_account(uuid) TO mc_payments;
