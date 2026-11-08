# Aislamiento entre tiendas

Decisión: ADR-0002. Evidencia: `docs/release-0/VERIFICATION-REPORT.md` §2–§3.

## Reglas obligatorias (se comprueban en revisión y CI)

1. Toda tabla con datos de una tienda tiene `tenant_id uuid NOT NULL`, `ENABLE` y `FORCE ROW LEVEL SECURITY`, política `tenant_isolation` con `USING` y `WITH CHECK`.
2. Las FKs entre tablas de tienda son compuestas `(tenant_id, x_id)`.
3. Los índices únicos de negocio incluyen `tenant_id` (`UNIQUE (tenant_id, email)`), nunca globales: un email puede ser cliente en dos tiendas como **dos clientes distintos** (contraste con Vendure, PoC B).
4. La aplicación conecta como `app_user` (no dueño, sin `BYPASSRLS`). Las migraciones usan `migrator`. Ningún proceso de aplicación usa superusuario.
5. El contexto se fija solo con `withTenant(session, fn)`: transacción + `set_config('app.tenant_id', $1, true)`. Prohibido `SET` de sesión.
6. Ningún endpoint, job ni webhook acepta `tenant_id` del exterior sin verificarlo contra una firma o sesión.
7. IDs UUIDv7. Respuestas 404 para recursos ajenos (no 403).
8. Caché: clave `t:{tenant}:…`. Objetos: `s3://bucket/{tenant}/…` con URLs firmadas de corta duración. Logs con `tenant_id` y sin datos personales en claro.
9. Jobs: el payload lleva `tenant_id` y el worker abre `withTenant` con él; el productor solo puede encolar para su propio tenant.
10. Operaciones de plataforma que cruzan tenants (soporte, analítica global) usan un rol separado, auditado y con acceso de solo lectura a vistas agregadas.

## Suite de aislamiento (Gate C)

Ampliación de la PoC A en R1–R2:
- Matriz automática: para cada endpoint del admin y cada recurso, el usuario de A intenta GET/PUT/PATCH/DELETE sobre IDs de B, con IDs manipulados en ruta, query, body y cabeceras. Esperado: 404 sin efectos.
- Jobs, webhooks entrantes con firma de otro tenant, claves de caché, rutas S3 y logs.
- **Control negativo** en CI: desactivar RLS y exigir que la suite falle.
