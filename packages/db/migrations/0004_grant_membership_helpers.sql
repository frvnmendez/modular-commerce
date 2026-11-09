-- 0004: las políticas RLS se evalúan con los privilegios de quien consulta; mc_app necesita EXECUTE
-- sobre las funciones de pertenencia (que siguen siendo SECURITY DEFINER y de solo lectura).
GRANT EXECUTE ON FUNCTION control.org_role(uuid), control.store_role(uuid) TO mc_app;
