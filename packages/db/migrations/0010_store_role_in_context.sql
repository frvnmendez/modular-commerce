-- 0010 (revisión final del PR #1, hallazgo 2): los permisos por rol también se comprueban en la BD
-- para las escrituras directas del plano de comercio.
--
-- Antes, las políticas de commerce.* solo comprobaban el tenant. Con la conexión mc_app (el modelo de amenaza
-- de RT-R1 H1), un miembro con rol staff podía reescribir commerce.store_settings (incluido business_profile,
-- que la API no expone) e insertar eventos de auditoría con cualquier acción en su tienda.
--
-- Ahora enter_store guarda también el rol en control.request_context, commerce.current_store_role() lo
-- expone, y unas políticas RESTRICTIVE exigen owner/admin para esas escrituras. Las funciones SECURITY DEFINER
-- (dueño con BYPASSRLS) siguen auditando como antes.
-- Patrón para R2: toda escritura de comercio que dependa del rol lleva su política restrictiva con
-- (SELECT commerce.current_store_role()), igual que el tenant (ver docs/TENANT-ISOLATION.md).

ALTER TABLE control.request_context ADD COLUMN store_role text CHECK (store_role IN ('owner', 'admin', 'staff'));

CREATE FUNCTION commerce.current_store_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control AS $$
  SELECT store_role FROM control.request_context
  WHERE pid = pg_backend_pid() AND xid = pg_current_xact_id_if_assigned()
$$;
REVOKE ALL ON FUNCTION commerce.current_store_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION commerce.current_store_role() TO mc_app;

CREATE OR REPLACE FUNCTION control.enter_store(p_store uuid) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control AS $$
DECLARE r text;
BEGIN
  IF control.current_user_id() IS NULL THEN RAISE EXCEPTION 'NO_USER_CONTEXT' USING ERRCODE = '42501'; END IF;
  r := control.store_role(p_store);
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  UPDATE control.request_context SET tenant_id = p_store, store_role = r
  WHERE pid = pg_backend_pid() AND xid = pg_current_xact_id_if_assigned();
  RETURN r;
END $$;

CREATE POLICY settings_write_role ON commerce.store_settings AS RESTRICTIVE FOR UPDATE TO mc_app
  USING ((SELECT commerce.current_store_role()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT commerce.current_store_role()) IN ('owner', 'admin'));

CREATE POLICY audit_insert_role ON commerce.audit_events AS RESTRICTIVE FOR INSERT TO mc_app
  WITH CHECK ((SELECT commerce.current_store_role()) IN ('owner', 'admin'));
