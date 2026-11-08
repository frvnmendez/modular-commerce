-- 0007: segunda pasada del Red Team de R1.
-- N1 (media): las políticas evaluaban current_tenant()/current_user_id() fila a fila. Envueltas en un
--   subselect, PostgreSQL las calcula una vez por consulta (InitPlan) y conserva índices y planes paralelos.
--   Patrón obligatorio para toda tabla de comercio futura (ver docs/TENANT-ISOLATION.md).
-- N2 (baja): las invitaciones pendientes de quien pierde el permiso de invitar se revocan en el acto,
--   para que no "revivan" si vuelve a la tienda.

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['store_settings', 'audit_events'] LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON commerce.%I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON commerce.%I TO mc_app
      USING (tenant_id = (SELECT commerce.current_tenant()))
      WITH CHECK (tenant_id = (SELECT commerce.current_tenant()))$p$, t);
  END LOOP;
END $$;

DROP POLICY actor_is_self ON commerce.audit_events;
CREATE POLICY actor_is_self ON commerce.audit_events AS RESTRICTIVE FOR INSERT TO mc_app
  WITH CHECK (actor_user_id = (SELECT control.current_user_id()));

CREATE FUNCTION control.revoke_orphan_invitations() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, control AS $$
DECLARE new_role text := CASE WHEN TG_OP = 'UPDATE' THEN NEW.role END;
BEGIN
  UPDATE control.invitations SET revoked_at = now()
  WHERE store_id = OLD.store_id AND invited_by = OLD.user_id
    AND accepted_at IS NULL AND revoked_at IS NULL
    AND NOT (new_role = 'owner' OR (new_role = 'admin' AND role = 'staff'));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION control.revoke_orphan_invitations() FROM PUBLIC;

CREATE TRIGGER revoke_orphan_invitations AFTER DELETE OR UPDATE OF role ON control.store_members
  FOR EACH ROW EXECUTE FUNCTION control.revoke_orphan_invitations();
