-- 0008: en DELETE el rol nuevo es NULL y `NOT (NULL = ...)` es NULL, así que no se revocaba nada.
-- Detectado por la regresión N2 (apps/commerce-api/test/r1-redteam.test.ts).
CREATE OR REPLACE FUNCTION control.revoke_orphan_invitations() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, control AS $$
DECLARE new_role text := CASE WHEN TG_OP = 'UPDATE' THEN NEW.role ELSE 'none' END;
BEGIN
  UPDATE control.invitations SET revoked_at = now()
  WHERE store_id = OLD.store_id AND invited_by = OLD.user_id
    AND accepted_at IS NULL AND revoked_at IS NULL
    AND NOT coalesce(new_role = 'owner' OR (new_role = 'admin' AND role = 'staff'), false);
  RETURN NULL;
END $$;
