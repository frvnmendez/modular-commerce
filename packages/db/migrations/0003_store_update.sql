-- 0003: actualización de datos básicos de la tienda (plano de control), solo owner/admin, auditada.
CREATE FUNCTION control.update_store(p_store uuid, p_name text, p_country text, p_currency text) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce AS $$
DECLARE me text := control.current_user_id(); r text := control.store_role(p_store);
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'STORE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF r NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  UPDATE control.stores SET name = coalesce(p_name, name), country = coalesce(p_country, country),
         currency = coalesce(p_currency, currency) WHERE id = p_store;
  INSERT INTO commerce.audit_events (tenant_id, actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_store, me, 'store.updated', 'store', p_store::text,
            jsonb_strip_nulls(jsonb_build_object('name', p_name, 'country', p_country, 'currency', p_currency)));
END $$;
REVOKE ALL ON FUNCTION control.update_store(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control.update_store(uuid, text, text, text) TO mc_app;
