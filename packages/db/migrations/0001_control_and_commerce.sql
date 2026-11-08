-- 0001: plano de control y base del plano de comercio con aislamiento por RLS.
-- Se ejecuta como mc_migrator (dueño). Ver docs/TENANT-ISOLATION.md y docs/DATABASE-SCHEMA.md.

CREATE SCHEMA control;
CREATE SCHEMA commerce;
CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA control, commerce, auth FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Contexto de la petición. Solo se fija dentro de transacción (set_config(..., true)).
-- ---------------------------------------------------------------------------
CREATE FUNCTION control.current_user_id() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

CREATE FUNCTION commerce.current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- Plano de control
-- ---------------------------------------------------------------------------
CREATE TABLE control.organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.organization_members (
  org_id uuid NOT NULL REFERENCES control.organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX ON control.organization_members (user_id);

CREATE TABLE control.stores (
  id uuid PRIMARY KEY,                       -- = tenant_id en el plano de comercio
  org_id uuid NOT NULL REFERENCES control.organizations(id),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  country char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  cell text NOT NULL DEFAULT 'cell-1',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON control.stores (org_id);

CREATE TABLE control.store_members (
  store_id uuid NOT NULL REFERENCES control.stores(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, user_id)
);
CREATE INDEX ON control.store_members (user_id);

CREATE TABLE control.invitations (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES control.stores(id) ON DELETE CASCADE,
  email citext NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'staff')),   -- la propiedad no se invita: se transfiere (R2)
  token_hash text NOT NULL UNIQUE,
  invited_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON control.invitations (store_id);

CREATE TABLE control.platform_operators (
  user_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.platform_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_id text NOT NULL,
  action text NOT NULL,
  target text,
  at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Comprobaciones de pertenencia. SECURITY DEFINER (dueño con BYPASSRLS) para evitar recursión de políticas;
-- search_path fijado; solo leen, nunca escriben.
-- ---------------------------------------------------------------------------
CREATE FUNCTION control.org_role(p_org uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control AS $$
  SELECT role FROM control.organization_members WHERE org_id = p_org AND user_id = control.current_user_id()
$$;

CREATE FUNCTION control.store_role(p_store uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control AS $$
  SELECT sm.role FROM control.store_members sm
  JOIN control.stores s ON s.id = sm.store_id
  WHERE sm.store_id = p_store AND sm.user_id = control.current_user_id() AND s.status = 'active'
$$;

-- RLS del plano de control: cada usuario solo ve organizaciones y tiendas a las que pertenece.
ALTER TABLE control.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY member_read ON control.organizations FOR SELECT TO mc_app USING (control.org_role(id) IS NOT NULL);

ALTER TABLE control.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.organization_members FORCE ROW LEVEL SECURITY;
CREATE POLICY member_read ON control.organization_members FOR SELECT TO mc_app
  USING (user_id = control.current_user_id() OR control.org_role(org_id) IN ('owner', 'admin'));

ALTER TABLE control.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.stores FORCE ROW LEVEL SECURITY;
CREATE POLICY member_read ON control.stores FOR SELECT TO mc_app USING (control.store_role(id) IS NOT NULL);
CREATE POLICY ops_read ON control.stores FOR SELECT TO mc_ops USING (true);

ALTER TABLE control.store_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.store_members FORCE ROW LEVEL SECURITY;
CREATE POLICY member_read ON control.store_members FOR SELECT TO mc_app
  USING (user_id = control.current_user_id() OR control.store_role(store_id) IN ('owner', 'admin'));

ALTER TABLE control.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON control.invitations FOR SELECT TO mc_app
  USING (control.store_role(store_id) IN ('owner', 'admin'));

ALTER TABLE control.platform_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.platform_operators FORCE ROW LEVEL SECURITY;
CREATE POLICY self_read ON control.platform_operators FOR SELECT TO mc_app, mc_ops USING (user_id = control.current_user_id());

ALTER TABLE control.platform_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.platform_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY ops_insert ON control.platform_audit FOR INSERT TO mc_ops WITH CHECK (operator_id = control.current_user_id());
CREATE POLICY ops_read ON control.platform_audit FOR SELECT TO mc_ops USING (true);

CREATE POLICY ops_read ON control.organizations FOR SELECT TO mc_ops USING (true);

-- ---------------------------------------------------------------------------
-- Plano de comercio (R1: ajustes de tienda y auditoría). Toda tabla: tenant_id + RLS forzado.
-- ---------------------------------------------------------------------------
CREATE TABLE commerce.store_settings (
  tenant_id uuid PRIMARY KEY,
  business_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commerce.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_user_id text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON commerce.audit_events (tenant_id, at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['store_settings', 'audit_events'] LOOP
    EXECUTE format('ALTER TABLE commerce.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE commerce.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON commerce.%I TO mc_app
      USING (tenant_id = commerce.current_tenant())
      WITH CHECK (tenant_id = commerce.current_tenant())$p$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Entrada a una tienda: verifica pertenencia y fija el contexto de tenant en la transacción.
-- La API nunca llama a set_config('app.tenant_id') directamente.
-- ---------------------------------------------------------------------------
CREATE FUNCTION control.enter_store(p_store uuid) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control AS $$
DECLARE r text;
BEGIN
  IF control.current_user_id() IS NULL THEN RAISE EXCEPTION 'NO_USER_CONTEXT' USING ERRCODE = '42501'; END IF;
  r := control.store_role(p_store);
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  PERFORM set_config('app.tenant_id', p_store::text, true);
  RETURN r;
END $$;

-- ---------------------------------------------------------------------------
-- Operaciones privilegiadas del plano de control: funciones transaccionales y auditadas.
-- ---------------------------------------------------------------------------
CREATE FUNCTION control.create_organization(p_id uuid, p_name text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control AS $$
DECLARE me text := control.current_user_id();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'NO_USER_CONTEXT' USING ERRCODE = '42501'; END IF;
  INSERT INTO control.organizations (id, name, created_by) VALUES (p_id, p_name, me);
  INSERT INTO control.organization_members (org_id, user_id, role) VALUES (p_id, me, 'owner');
  RETURN p_id;
END $$;

CREATE FUNCTION control.create_store(p_id uuid, p_org uuid, p_name text, p_slug text, p_country text, p_currency text,
                                     p_profile jsonb, p_capabilities text[]) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE me text := control.current_user_id();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'NO_USER_CONTEXT' USING ERRCODE = '42501'; END IF;
  IF control.org_role(p_org) IS DISTINCT FROM 'owner' AND control.org_role(p_org) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'ORG_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO control.stores (id, org_id, name, slug, country, currency) VALUES (p_id, p_org, p_name, p_slug, p_country, p_currency);
  INSERT INTO control.store_members (store_id, user_id, role) VALUES (p_id, me, 'owner');
  INSERT INTO commerce.store_settings (tenant_id, business_profile, capabilities) VALUES (p_id, p_profile, p_capabilities);
  INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id)
    VALUES (p_id, me, 'store.created', 'store', p_id::text);
  RETURN p_id;
END $$;

CREATE FUNCTION control.create_invitation(p_id uuid, p_store uuid, p_email text, p_role text, p_token_hash text, p_ttl interval)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE me text := control.current_user_id(); r text := control.store_role(p_store);
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF r NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_role = 'admin' AND r <> 'owner' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  INSERT INTO control.invitations (id, store_id, email, role, token_hash, invited_by, expires_at)
    VALUES (p_id, p_store, p_email, p_role, p_token_hash, me, now() + p_ttl);
  INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_store, me, 'invitation.created', 'invitation', p_id::text, jsonb_build_object('role', p_role));
  RETURN p_id;
END $$;

-- El email del usuario lo aporta la API desde la sesión verificada; la función exige que coincida con el invitado.
CREATE FUNCTION control.accept_invitation(p_token_hash text, p_user_email text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE me text := control.current_user_id(); inv control.invitations%ROWTYPE;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'NO_USER_CONTEXT' USING ERRCODE = '42501'; END IF;
  SELECT * INTO inv FROM control.invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at < now()
     OR inv.email <> p_user_email::citext THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0002';
  END IF;
  UPDATE control.invitations SET accepted_at = now(), accepted_by = me WHERE id = inv.id;
  INSERT INTO control.store_members (store_id, user_id, role) VALUES (inv.store_id, me, inv.role)
    ON CONFLICT (store_id, user_id) DO NOTHING;
  INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id)
    VALUES (inv.store_id, me, 'invitation.accepted', 'invitation', inv.id::text);
  RETURN inv.store_id;
END $$;

CREATE FUNCTION control.set_member_role(p_store uuid, p_user text, p_role text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE me text := control.current_user_id(); r text := control.store_role(p_store); cur text;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF r <> 'owner' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_role NOT IN ('owner', 'admin', 'staff') THEN RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE = '22023'; END IF;
  SELECT role INTO cur FROM control.store_members WHERE store_id = p_store AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF cur = 'owner' AND p_role <> 'owner'
     AND (SELECT count(*) FROM control.store_members WHERE store_id = p_store AND role = 'owner') <= 1 THEN
    RAISE EXCEPTION 'LAST_OWNER' USING ERRCODE = '23514';
  END IF;
  UPDATE control.store_members SET role = p_role WHERE store_id = p_store AND user_id = p_user;
  INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_store, me, 'member.role_changed', 'user', p_user, jsonb_build_object('from', cur, 'to', p_role));
END $$;

CREATE FUNCTION control.remove_member(p_store uuid, p_user text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE me text := control.current_user_id(); r text := control.store_role(p_store); cur text;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT role INTO cur FROM control.store_members WHERE store_id = p_store AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  -- owner puede quitar a cualquiera; admin solo a staff; cualquiera puede salirse salvo el último owner.
  IF NOT (r = 'owner' OR (r = 'admin' AND cur = 'staff') OR p_user = me) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF cur = 'owner' AND (SELECT count(*) FROM control.store_members WHERE store_id = p_store AND role = 'owner') <= 1 THEN
    RAISE EXCEPTION 'LAST_OWNER' USING ERRCODE = '23514';
  END IF;
  DELETE FROM control.store_members WHERE store_id = p_store AND user_id = p_user;
  INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id)
    VALUES (p_store, me, 'member.removed', 'user', p_user);
END $$;

-- ---------------------------------------------------------------------------
-- Privilegios: mínimos. mc_app lee el control vía RLS y escribe solo con funciones.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA control, commerce FROM PUBLIC;
GRANT USAGE ON SCHEMA control, commerce TO mc_app;
GRANT SELECT ON control.organizations, control.organization_members, control.stores, control.store_members,
                control.invitations, control.platform_operators TO mc_app;
GRANT SELECT, UPDATE ON commerce.store_settings TO mc_app;
GRANT SELECT, INSERT ON commerce.audit_events TO mc_app;   -- auditoría de solo inserción
GRANT EXECUTE ON FUNCTION control.current_user_id(), commerce.current_tenant(), control.enter_store(uuid),
  control.create_organization(uuid, text),
  control.create_store(uuid, uuid, text, text, text, text, jsonb, text[]),
  control.create_invitation(uuid, uuid, text, text, text, interval),
  control.accept_invitation(text, text), control.set_member_role(uuid, text, text), control.remove_member(uuid, text)
  TO mc_app;

GRANT USAGE ON SCHEMA control TO mc_ops;
GRANT SELECT ON control.organizations, control.stores, control.platform_operators TO mc_ops;
GRANT SELECT, INSERT ON control.platform_audit TO mc_ops;
GRANT EXECUTE ON FUNCTION control.current_user_id() TO mc_ops;

GRANT USAGE ON SCHEMA auth TO mc_auth;  -- las tablas de auth las crea la migración 0002
