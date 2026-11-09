# Aislamiento entre tiendas

Decisión: ADR-0002. Evidencia: `docs/release-0/VERIFICATION-REPORT.md` §2–§3.

## Reglas obligatorias (se comprueban en revisión y CI)

1. Toda tabla con datos de una tienda tiene `tenant_id uuid NOT NULL`, `ENABLE` y `FORCE ROW LEVEL SECURITY` y la política `tenant_isolation` con `USING` y `WITH CHECK`. La comparación se escribe como `tenant_id = (SELECT commerce.current_tenant())`: el subselect se evalúa una sola vez por consulta (RT-R1 N1). Además, un índice que empiece por `tenant_id`.
2. Las FKs entre tablas de tienda son compuestas `(tenant_id, x_id)`.
3. Los índices únicos de negocio incluyen `tenant_id` (`UNIQUE (tenant_id, email)`), nunca globales: un email puede ser cliente en dos tiendas como **dos clientes distintos** (contraste con Vendure, PoC B).
4. La aplicación conecta como `mc_app` (no es dueño y no tiene `BYPASSRLS`). Las migraciones usan `mc_migrator`. Ningún proceso de aplicación usa superusuario.
5. El contexto se abre solo con `withUser`/`withStore`/`withOperator` de `@mc/db`, que reciben el **token de sesión**. Dentro de una transacción, `control.begin_session(token)` valida la sesión en la BD y `control.enter_store(id)` valida la pertenencia. Ambas escriben en `control.request_context`, que `mc_app` no puede tocar. No se usan GUCs para el contexto, porque `mc_app` podría forjarlos (RT-R1 H1).
5b. Los permisos por rol también se comprueban en la BD. `enter_store` guarda el rol en `request_context` y `commerce.current_store_role()` lo expone. Toda escritura directa de comercio que dependa del rol lleva una política `AS RESTRICTIVE` con `(SELECT commerce.current_store_role()) IN (...)`, como `settings_write_role` y `audit_insert_role` (migración 0010). La comprobación de `@mc/core` en la API sigue existiendo, pero no es la única barrera.
6. Ningún endpoint, job ni webhook acepta `tenant_id` del exterior sin verificarlo contra una firma o sesión.
7. IDs UUIDv7. Respuestas 404 para recursos ajenos (no 403).
8. Caché: clave `t:{tenant}:…`. Objetos: `s3://bucket/{tenant}/…` con URLs firmadas de corta duración. Logs con `tenant_id` y sin datos personales en claro.
9. Jobs (R2+): el payload lleva `tenant_id` y el worker abre el contexto con él. El productor solo puede encolar para su propio tenant. El mecanismo para jobs sin sesión de usuario (un rol de worker y su propia función de entrada) se diseña en R2 con un ADR.
10. Operaciones de plataforma que cruzan tenants (soporte, analítica global) usan un rol separado, auditado y con acceso de solo lectura a vistas agregadas.

## Suite de aislamiento (Gate C)

Ampliación de la PoC A en R1–R2:
- Matriz automática: para cada endpoint del admin y cada recurso, el usuario de A intenta GET/PUT/PATCH/DELETE sobre IDs de B, con IDs manipulados en ruta, query, body y cabeceras. Esperado: 404 sin efectos.
- Jobs, webhooks entrantes con firma de otro tenant, claves de caché, rutas S3 y logs.
- **Control negativo** en CI: desactivar RLS y exigir que la suite falle.
