-- 0005: el tipo citext vive en el esquema public; la función lo necesita en su search_path.
-- (Detectado por el test de invitaciones: la comparación de emails fallaba con error 500.)
CREATE OR REPLACE FUNCTION control.accept_invitation(p_token_hash text, p_user_email text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce, public AS $$
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
