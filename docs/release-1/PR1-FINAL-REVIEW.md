# Revisión final independiente del PR #1 (commit 33b039b)

> Copiado al repo el 2026-11-10 desde la carpeta compartida del proyecto, sin cambios en el contenido. Los hallazgos 1 y 2 se corrigieron en el PR #2; el 3 quedó como propuesta (ver `FINAL-REVIEW-FIXES.md`).

Fecha: 2026-11-09. Solo lectura: sin commits ni cambios en el PR. CI de 33b039b en verde (run 42533777604).
En local sobre 33b039b: API 30/30 y aislamiento 20/20. Las pruebas de abajo se hicieron con un test desechable que se borró después.

Veredicto: **aprobar con condiciones**. No hay fuga entre tiendas. Ningún hallazgo es crítico ni alto.

## Media

1. **Las comprobaciones de sesión y CSRF dependen del texto literal de `req.url`** (`apps/commerce-api/src/app.ts:54` y `:88`).
   El router de Fastify decodifica la ruta y `req.url` no, así que `/%761/me` entra en la ruta `/v1/me` sin pasar por el preHandler.
   Reproducido: `GET /%761/me`, con cookie o sin ella → 500 INTERNAL. `POST /%761/organizations` con text/plain se salta el control 415 y llega al handler.
   Hoy no se puede explotar porque falla cerrado: `req.user!` es undefined y el handler revienta. Pero cualquier ruta futura que no use `user(req)` quedaría abierta, y cualquiera puede llenar el log de errores 500.
   Corrección: registrar /v1 como plugin con `prefix` y hooks encapsulados, o decidirlo por `req.routeOptions.url`.
2. **Los permisos por rol no se comprueban en la BD para escribir en el plano de comercio.**
   Las políticas de `store_settings` y `audit_events` solo comprueban el tenant. Bajo el modelo de amenaza de H1 (abuso de la conexión `mc_app`), un staff puede reescribir `store_settings`, incluido `business_profile`, e insertar eventos de auditoría con cualquier acción.
   Reproducido: UPDATE con 1 fila y el owner ve `{"hack":1}`. Ocurre dentro de su propia tienda, no entre tiendas.
   Choca con el comentario de `rbac.ts` ("la BD vuelve a comprobar las operaciones privilegiadas"). Hay que decidir el patrón antes de añadir las tablas de comercio de R2: guardar el rol en `request_context` y usarlo en las políticas, o escribir solo a través de funciones.
3. **Cada petición asigna un xid y escribe en `request_context`, también los GET.**
   Reproducido: 20 GET consumen 20 xids. Con carga, esto acelera el vacuum anti-wraparound, genera tuplas muertas e impide leer de réplicas, porque en hot standby no se pueden asignar xids.
   No está entre lo documentado: N3 trata otra cosa, las filas que quedan. Conviene decidirlo antes de las pruebas de carga o de R2.

## Baja

4. **Aceptar una invitación siendo ya miembro la consume y devuelve 200 sin cambiar el rol** (`ON CONFLICT DO NOTHING`, 0009).
   Reproducido: un staff acepta una invitación de admin, sigue como staff, la invitación desaparece de pendientes y la auditoría dice "accepted".
5. **`transaction()` devuelve al pool un cliente roto** (`packages/db/src/index.ts`): llama a `c.release()` sin pasar el error aunque el ROLLBACK haya fallado. No afecta a la seguridad, porque el contexto va por xid. Encontrado leyendo el código, sin reproducir.
6. **El límite de intentos de Better Auth vive en memoria de cada instancia**, y las reglas estrictas solo cubren sign-in y sign-up. El reset de contraseña y el reenvío de verificación quedan en 100/min por IP. Sin reproducir.

Ya documentado y no contado aquí: H1–H6, N1–N4, mc_auth en el mismo proceso, balanceador, topología y email real.
