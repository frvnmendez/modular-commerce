# DATABASE-SCHEMA

Esquema **implementado** en Release 1 (PostgreSQL 16). Fuente de verdad: `packages/db/migrations/*.sql`. Este documento solo describe lo que existe.

## Roles

| Rol | Propósito | Atributos |
|---|---|---|
| `mc_migrator` | Dueño de todos los objetos; aplica migraciones | `BYPASSRLS` (solo para migrar y para funciones `SECURITY DEFINER`) |
| `mc_app` | Rol de la API | `NOBYPASSRLS`, no es dueño de nada; DML mínimo concedido tabla a tabla |
| `mc_auth` | Better Auth | Solo el esquema `auth` |
| `mc_ops` | Operadores de plataforma | Solo lectura de tiendas/organizaciones + escritura en `platform_audit` |

Ninguno es superusuario. La suite de aislamiento comprueba estos atributos en el catálogo.

## Contexto de petición

- El contexto (usuario y tienda) vive en `control.request_context`. Es una tabla `UNLOGGED` propiedad de `mc_migrator`, con clave (`pg_backend_pid()`, `pg_current_xact_id()`). `mc_app` no tiene ningún privilegio sobre ella.
- Solo la escriben dos funciones:
  - `control.begin_session(token)` valida en la BD el token de sesión de Better Auth: tiene que estar vigente y ser de un usuario con email verificado.
  - `control.enter_store(store)` exige pertenencia y fija el tenant.
- `control.current_user_id()` y `commerce.current_tenant()` leen la fila de la transacción actual. Al terminar la transacción, la fila deja de coincidir.
- `@mc/db` (`withUser`, `withStore`, `withOperator`) recibe el token de sesión, no un id de usuario. Si `mc_app` forja `set_config('app.*')`, no obtiene nada. Lo comprueba la suite de aislamiento (RT-R1 H1).
- Al devolver la conexión al pool se ejecuta `DISCARD ALL`.

## Esquema `control` (plano de control)

| Tabla | Columnas clave | Lectura para `mc_app` (RLS) | Escritura |
|---|---|---|---|
| `organizations` | `id uuid` PK, `name`, `created_by` | miembros de la organización | `create_organization()` |
| `organization_members` | PK (`org_id`, `user_id`), `role` ∈ owner/admin/member | miembros | funciones |
| `stores` | `id uuid` PK (= `tenant_id`), `org_id`, `name`, `slug` único `^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$`, `country` ISO-2, `currency` ISO-4217, `cell`, `status` ∈ active/suspended/closed | miembros de la tienda; `mc_ops` todo | `create_store()`, `update_store()` |
| `store_members` | PK (`store_id`, `user_id`), `role` ∈ owner/admin/staff | miembros de la tienda | `accept_invitation()`, `set_member_role()`, `remove_member()` |
| `invitations` | `id`, `store_id`, `email citext`, `role` ∈ admin/staff, `token_hash` único (sha256), `expires_at`, `accepted_at`, `revoked_at` | owner/admin de la tienda | `create_invitation()`, `accept_invitation()`, `revoke_invitation()` |
| `request_context` | (`pid`, `xid`) PK, `user_id`, `tenant_id`, `store_role` | nadie | `begin_session()`, `enter_store()` |
| `platform_operators` | `user_id` PK | solo la propia fila | solo administración de BD |
| `platform_audit` | `operator_id`, `action`, `target`, `at` | `mc_ops` | `mc_ops` (solo su propio `operator_id`) |

`mc_app` **no tiene INSERT/UPDATE/DELETE directo** sobre `control.*`; todo cambio pasa por funciones `SECURITY DEFINER` con `search_path` fijado que verifican el rol del usuario del contexto.

### Funciones

| Función | Quién | Efecto / errores |
|---|---|---|
| `org_role(org)`, `store_role(store)` | interno | Rol del usuario del contexto o `NULL` |
| `enter_store(store)` | cualquier miembro | Fija `app.tenant_id`; `STORE_NOT_FOUND` |
| `create_organization(id, name)` | usuario autenticado | Crea org con el usuario como owner |
| `create_store(id, org, name, slug, country, currency, profile, caps)` | owner/admin de la org | Crea tienda + owner + `store_settings` + `audit_events(store.created)` en una transacción; `ORG_NOT_FOUND`, `DUPLICATE` |
| `update_store(store, name, country, currency)` | owner/admin | Auditado (`store.updated`) |
| `create_invitation(id, store, email, role, token_hash, ttl)` | owner (cualquier rol), admin (solo staff) | Auditado |
| `begin_session(token)` | `mc_app`, `mc_ops` | Abre el contexto si la sesión es válida; `NO_USER_CONTEXT` |
| `accept_invitation(token_hash)` | invitado: el email verificado se lee de `auth."user"` con `current_user_id()`, nunca del llamante | Un solo uso, no caducada ni revocada, tienda activa y quien invitó conserva el permiso; `INVITATION_INVALID` (404) |
| `revoke_invitation(store, id)` | owner; admin solo invitaciones de staff | Auditado (`invitation.revoked`) |
| `set_member_role(store, user, role)` | owner | Bloquea la tienda (`FOR UPDATE`) y protege al último owner (`LAST_OWNER`, 409); auditado |
| `remove_member(store, user)` | owner; admin sobre staff; uno mismo | Bloquea la tienda y protege al último owner; auditado |
| `member_directory(store)` | owner/admin | Nombre y email de los miembros (une `auth."user"` sin exponer la tabla) |

## Esquema `commerce` (plano de comercio)

Toda tabla tiene `tenant_id` y RLS **ENABLE + FORCE**, con la política `tenant_isolation`: `tenant_id = (SELECT commerce.current_tenant())` en `USING` y en `WITH CHECK`. El subselect se evalúa una vez por consulta.

| Tabla | Columnas | Notas |
|---|---|---|
| `store_settings` | `tenant_id` PK, `business_profile jsonb`, `capabilities text[]`, `updated_at` | La navegación del panel = capacidades ∩ permisos del rol |
| `audit_events` | `id`, `tenant_id`, `actor_user_id`, `action`, `target_type`, `target_id`, `metadata jsonb`, `at` | `mc_app`: solo INSERT y SELECT (sin UPDATE/DELETE). Una política restrictiva exige `actor_user_id = current_user_id()` |

## Esquema `auth`

Tablas de Better Auth 1.7 (`user`, `session`, `account`, `verification`). Solo `mc_auth` tiene acceso; `mc_app` no puede leer contraseñas ni sesiones (comprobado en la suite).

## Migraciones

| Fichero | Contenido |
|---|---|
| `0001_control_and_commerce.sql` | Esquemas, tablas, RLS, funciones del plano de control |
| `0002_auth.sql` | Tablas de identidad, `member_directory` |
| `0003_store_update.sql` | `update_store` |
| `0004_grant_membership_helpers.sql` | `EXECUTE` de `org_role`/`store_role` a `mc_app` (las políticas los evalúan como `mc_app`) |
| `0005_fix_accept_invitation_citext.sql` | `accept_invitation` con `public` en `search_path` para el operador de `citext` |
| `0007_red_team_r1_pass2.sql` | Políticas con `(SELECT current_tenant())` (InitPlan); trigger que revoca invitaciones de quien pierde el permiso |
| `0008_fix_revoke_orphan_null.sql` | Corrige el trigger en `DELETE` (comparación con NULL) |
| `0009_accept_invitation_db_email.sql` | `accept_invitation` deja de recibir el email del llamante (revisión del PR #1) |
| `0010_store_role_in_context.sql` | Rol de tienda en `request_context`; políticas restrictivas por rol para escribir ajustes y auditoría (revisión final del PR #1) |
| `0006_red_team_r1.sql` | Correcciones del Red Team: `request_context` y `begin_session`, bloqueos del último owner, `revoke_invitation`, actor de auditoría, directorio restringido |

Las migraciones aplicadas se registran en `public.schema_migrations` con checksum; editar una ya aplicada hace fallar `migrate`.
