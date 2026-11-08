-- 0006: correcciones de la revisión del Red Team de R1 (docs/release-1/RED-TEAM.md).
--
-- H1 (alta): mc_app podía forjar app.user_id / app.tenant_id con set_config y saltarse enter_store.
--   El contexto deja de vivir en GUCs. Pasa a una tabla propiedad de mc_migrator, que mc_app no puede tocar,
--   con clave (pid del backend, xid de la transacción). Solo la escriben begin_session, que exige un token
--   de sesión válido de un usuario verificado, y enter_store, que exige pertenencia.
-- H3 (media): carrera en la regla del último owner → se bloquea la fila de la tienda.
-- H4 (media): invitaciones revocables y ligadas a que quien invitó conserve el permiso.
-- H6 (baja): actor de auditoría = usuario del contexto; directorio de miembros solo para owner/admin;
--   no se aceptan invitaciones de tiendas no activas.

CREATE UNLOGGED TABLE control.request_context (
  pid integer NOT NULL,
  xid xid8 NOT NULL,
  user_id text NOT NULL,
  tenant_id uuid,
  PRIMARY KEY (pid, xid)
);
ALTER TABLE control.request_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.request_context FORCE ROW LEVEL SECURITY;   -- sin políticas: nadie salvo el dueño
REVOKE ALL ON control.request_context FROM PUBLIC;

CREATE OR REPLACE FUNCTION control.current_user_id() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control AS $$
  SELECT user_id FROM control.request_context
  WHERE pid = pg_backend_pid() AND xid = pg_current_xact_id_if_assigned()
$$;

CREATE OR REPLACE FUNCTION commerce.current_tenant() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control AS $$
  SELECT tenant_id FROM control.request_context
  WHERE pid = pg_backend_pid() AND xid = pg_current_xact_id_if_assigned()
$$;

-- Abre el contexto de la transacción a partir del token de sesión (el que Better Auth guarda en auth.session).
CREATE FUNCTION control.begin_session(p_token text) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, auth AS $$
DECLARE uid text;
BEGIN
  SELECT s."userId" INTO uid FROM auth.session s JOIN auth."user" u ON u.id = s."userId"
  WHERE s.token = p_token AND s."expiresAt" > now() AND u."emailVerified";
  IF uid IS NULL THEN RAISE EXCEPTION 'NO_USER_CONTEXT' USING ERRCODE = '42501'; END IF;
  DELETE FROM control.request_context WHERE pid = pg_backend_pid();   -- restos de transacciones anteriores
  INSERT INTO control.request_context (pid, xid, user_id) VALUES (pg_backend_pid(), pg_current_xact_id(), uid);
  RETURN uid;
END $$;

CREATE OR REPLACE FUNCTION control.enter_store(p_store uuid) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control AS $$
DECLARE r text;
BEGIN
  IF control.current_user_id() IS NULL THEN RAISE EXCEPTION 'NO_USER_CONTEXT' USING ERRCODE = '42501'; END IF;
  r := control.store_role(p_store);
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  UPDATE control.request_context SET tenant_id = p_store
  WHERE pid = pg_backend_pid() AND xid = pg_current_xact_id_if_assigned();
  RETURN r;
END $$;

-- H3: ambas funciones serializan por tienda antes de contar owners.
CREATE OR REPLACE FUNCTION control.set_member_role(p_store uuid, p_user text, p_role text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE me text := control.current_user_id(); r text := control.store_role(p_store); cur text;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF r <> 'owner' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_role NOT IN ('owner', 'admin', 'staff') THEN RAISE EXCEPTION 'INVALID_ROLE' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM control.stores WHERE id = p_store FOR UPDATE;
  IF control.store_role(p_store) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
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

CREATE OR REPLACE FUNCTION control.remove_member(p_store uuid, p_user text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE me text := control.current_user_id(); r text; cur text;
BEGIN
  PERFORM 1 FROM control.stores WHERE id = p_store FOR UPDATE;
  r := control.store_role(p_store);   -- releído tras el bloqueo
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT role INTO cur FROM control.store_members WHERE store_id = p_store AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
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

-- H4: revocación explícita (owner cualquiera; admin solo invitaciones de staff).
CREATE FUNCTION control.revoke_invitation(p_store uuid, p_id uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE me text := control.current_user_id(); r text := control.store_role(p_store); inv control.invitations%ROWTYPE;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO inv FROM control.invitations WHERE id = p_id AND store_id = p_store FOR UPDATE;
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (r = 'owner' OR (r = 'admin' AND inv.role = 'staff')) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  UPDATE control.invitations SET revoked_at = now() WHERE id = p_id;
  INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id)
    VALUES (p_store, me, 'invitation.revoked', 'invitation', p_id::text);
END $$;

-- H4 + H6: la invitación solo vale si la tienda está activa y quien invitó sigue pudiendo invitar ese rol.
CREATE OR REPLACE FUNCTION control.accept_invitation(p_token_hash text, p_user_email text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce, public AS $$
DECLARE me text := control.current_user_id(); inv control.invitations%ROWTYPE; inviter_role text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'NO_USER_CONTEXT' USING ERRCODE = '42501'; END IF;
  SELECT * INTO inv FROM control.invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at < now()
     OR inv.email <> p_user_email::citext THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0002';
  END IF;
  SELECT sm.role INTO inviter_role FROM control.store_members sm JOIN control.stores s ON s.id = sm.store_id
  WHERE sm.store_id = inv.store_id AND sm.user_id = inv.invited_by AND s.status = 'active';
  IF inviter_role IS NULL OR NOT (inviter_role = 'owner' OR (inviter_role = 'admin' AND inv.role = 'staff')) THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0002';
  END IF;
  UPDATE control.invitations SET accepted_at = now(), accepted_by = me WHERE id = inv.id;
  INSERT INTO control.store_members (store_id, user_id, role) VALUES (inv.store_id, me, inv.role)
    ON CONFLICT (store_id, user_id) DO NOTHING;
  INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id)
    VALUES (inv.store_id, me, 'invitation.accepted', 'invitation', inv.id::text);
  RETURN inv.store_id;
END $$;

-- H6: el directorio (nombres y emails) solo para owner/admin, también a nivel de BD.
CREATE OR REPLACE FUNCTION control.member_directory(p_store uuid)
  RETURNS TABLE (user_id text, name text, email text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control, auth AS $$
  SELECT sm.user_id, u.name, u.email, sm.role
  FROM control.store_members sm JOIN auth."user" u ON u.id = sm.user_id
  WHERE sm.store_id = p_store AND control.store_role(p_store) IN ('owner', 'admin')
  ORDER BY sm.created_at
$$;

-- H6: mc_app no puede firmar eventos de auditoría en nombre de otro usuario.
CREATE POLICY actor_is_self ON commerce.audit_events AS RESTRICTIVE FOR INSERT TO mc_app
  WITH CHECK (actor_user_id = control.current_user_id());

REVOKE ALL ON FUNCTION control.begin_session(text), control.revoke_invitation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control.begin_session(text) TO mc_app, mc_ops;
GRANT EXECUTE ON FUNCTION control.revoke_invitation(uuid, uuid) TO mc_app;
