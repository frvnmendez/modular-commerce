# Revisión final del PR #1: correcciones y propuesta

Revisión independiente de `33b039b`. El informe completo está en la carpeta del proyecto (`release-1/PR1-FINAL-REVIEW.md`). Aquí se recoge qué se corrige en esta rama y qué queda como propuesta.

## Hallazgo 1 (media): el control de sesión y el de CSRF dependían del texto de `req.url`: **corregido**

- **Problema.** El router de Fastify decodifica la ruta (`/%761/me` → `/v1/me`), pero los hooks miraban `req.url` sin decodificar. Una ruta `/v1` escrita con %-codificación se saltaba el preHandler de sesión y el control 415. Hoy fallaba cerrado (500), pero cualquier ruta futura que no usara `user(req)` habría quedado abierta.
- **Corrección.** Los hooks deciden por `req.routeOptions.url`, que es la ruta que eligió el router. Además, `user(req)` responde 401 en lugar de lanzar un TypeError si el usuario no está presente.
- **Pruebas** (`apps/commerce-api/test/r1-redteam.test.ts`):
  - Las variantes codificadas sin sesión responden 401.
  - La mutación codificada con text/plain responde 415.
  - Control positivo: con sesión, la ruta codificada responde 200.
- **Sabotaje.** Con el hook en `req.url` fallan las pruebas del 415 y del control positivo. El 401 lo sigue garantizando la segunda barrera (`user(req)`).

## Hallazgo 2 (media): los permisos por rol no se comprobaban en la BD para escribir en el plano de comercio: **corregido**

- **Problema.** Las políticas de `commerce.*` solo miraban el tenant. Con la conexión `mc_app` (modelo de amenaza de RT-R1 H1), un staff reescribía `store_settings`, incluido `business_profile`, e insertaba auditoría con cualquier acción.
- **Corrección (migración 0010).**
  - `enter_store` guarda el rol en `request_context`.
  - `commerce.current_store_role()` expone ese rol.
  - Dos políticas `RESTRICTIVE` exigen owner/admin: `settings_write_role` (UPDATE de ajustes) y `audit_insert_role` (INSERT de auditoría).
  - Las funciones `SECURITY DEFINER` auditan igual que antes.
  - El patrón queda como regla 5b en `docs/TENANT-ISOLATION.md`.
- **Prueba** (`tests/isolation`, «staff con mc_app directo no puede cambiar ajustes ni escribir auditoría; el owner sí»):
  - El UPDATE del staff afecta a 0 filas y su INSERT de auditoría es rechazado por RLS.
  - Los ajustes quedan intactos.
  - Control positivo con el owner.
- **Sabotaje.** Sin las políticas, la prueba falla. Los tres controles negativos también la detectan.

## Hallazgo 3 (media): un xid y una escritura por petición: **propuesta, sin cambios en esta rama**

Medido: 20 GET consumen 20 xids, porque `begin_session` inserta en `request_context`. Consecuencias:

- Con 100 peticiones por segundo se gastan unos 8,6 M de xids al día, y se llega a `autovacuum_freeze_max_age` (200 M) cada ~23 días. Con 1.000 por segundo, cada ~2,3 días.
- Las lecturas autenticadas no pueden ir a réplicas, porque en hot standby no se asignan xids.

Opciones:

| Opción | Qué es | Coste |
|---|---|---|
| A | Contexto en una variable de transacción firmada con HMAC (pgcrypto), ligada a `pg_backend_pid()`, al id de transacción virtual y a `transaction_timestamp()`. Sin escrituras: las lecturas no consumen xid | Rehacer el mecanismo de identidad que ya pasó dos revisiones del Red Team; requiere pgcrypto, un secreto en BD y una revisión de seguridad nueva |
| B | Mantenerlo como está y vigilar la edad de los xid y el autovacuum | Ninguno ahora; el coste crece con el tráfico y no permite réplicas |
| C | B ahora y A cuando la prueba de carga de R2 lo pida (por ejemplo, > 300 peticiones/s sostenidas o necesidad de réplicas) | Bajo ahora; la decisión se toma con datos |

**Recomendación: C.** Cambiar ahora la pieza más sensible del aislamiento, sin datos de carga y sin una revisión del Red Team, añade más riesgo del que quita.
