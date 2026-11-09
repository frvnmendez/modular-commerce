-- 0009 (revisión del PR #1, hallazgo 1): accept_invitation confiaba en el email que le pasaba quien llamaba.
-- Con una sesión propia, mc_app podía aceptar una invitación dirigida a otra cuenta indicando el email de
-- la víctima (reproducido: el atacante quedó como admin). Ahora el email verificado se lee de auth."user"
-- con la identidad de control.current_user_id(), y la firma antigua desaparece.
DROP FUNCTION control.accept_invitation(text, text);

CREATE FUNCTION control.accept_invitation(p_token_hash text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, control, commerce, auth, public AS $$
DECLARE me text := control.current_user_id(); my_email citext; inv control.invitations%ROWTYPE; inviter_role text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'NO_USER_CONTEXT' USING ERRCODE = '42501'; END IF;
  SELECT u.email INTO my_email FROM auth."user" u WHERE u.id = me AND u."emailVerified";
  IF my_email IS NULL THEN RAISE EXCEPTION 'NO_USER_CONTEXT' USING ERRCODE = '42501'; END IF;
  SELECT * INTO inv FROM control.invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.revoked_at IS NOT NULL OR inv.expires_at < now()
     OR inv.email <> my_email THEN
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
REVOKE ALL ON FUNCTION control.accept_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control.accept_invitation(text) TO mc_app;
