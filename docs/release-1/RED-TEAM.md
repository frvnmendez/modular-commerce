# Revisión independiente (Red Team) — Release 1

Revisor: un agente independiente al que no se le dio la opinión del implementador. Solo recibió el código y la consigna de buscar formas de romper el aislamiento entre tiendas, los roles y la sesión. Ejecutó los exploits en BD desechables y fuera del repositorio.

## Primera pasada: **NO-GO**

| ID | Severidad | Hallazgo | Corrección | Regresión |
|---|---|---|---|---|
| H1 | Alta | `mc_app` podía forjar `app.user_id`/`app.tenant_id` con `set_config` y leer y escribir en otra tienda, incluso crear invitaciones de admin | Contexto en `control.request_context` (pid, xid), escrito solo por `begin_session(token)` y `enter_store`. Migración 0006 | `tests/isolation`: «forjar el contexto…», «el contexto de una transacción no sirve en la siguiente…» |
| H2 | Alta | El límite de intentos de login se esquivaba rotando `X-Forwarded-For`. Sin esa cabecera, todo el tráfico compartía un único cubo global | El servidor descarta las cabeceras de reenvío del cliente y fija la IP del socket o del proxy de confianza (`TRUST_PROXY`) | `apps/commerce-api/test/rate-limit.test.ts`, que falla si se quita la corrección (comprobado) |
| H3 | Media | Una carrera en la regla del último owner dejaba tiendas sin owner (9 de cada 10 intentos concurrentes) | `FOR UPDATE` sobre la tienda y relectura del rol en `set_member_role`/`remove_member` | `r1-redteam.test.ts` H3 (10 iteraciones concurrentes + expulsión cruzada) |
| H4 | Media | Las invitaciones no se podían revocar y seguían valiendo aunque quien invitó hubiera sido expulsado | `revoke_invitation` (API y panel). La aceptación exige que quien invitó conserve el permiso | `r1-redteam.test.ts` H4 |
| H5 | Media | Restablecer la contraseña no cerraba las sesiones abiertas | `revokeSessionsOnPasswordReset: true` | `r1-redteam.test.ts` H5 |
| H6 | Baja | Auditoría firmable por otro usuario; 500 con un orgId de 36 guiones; directorio de emails visible para staff en BD; invitaciones aceptables en tiendas suspendidas; cookies `Secure` no exigidas | Política restrictiva `actor_is_self`, `isUuid`, directorio solo para owner/admin, comprobación de tienda activa, HTTPS obligatorio en producción | `r1-redteam.test.ts` H6, `tests/isolation` («auditoría: no se puede firmar…») |

## Segunda pasada: **GO con condiciones**

H1–H6 quedaron verificados como corregidos, cada uno con su evidencia. El revisor atacó también el mecanismo nuevo y todo resistió:

- Replay tras `COMMIT` o `ROLLBACK`.
- Reutilización de pid y wraparound de xid8.
- Subtransacciones.
- Llamar a `begin_session` dos veces.
- Sesiones caducadas, cerradas o sin verificar.
- Rutas de `mc_ops`.
- Ataques entre tiendas con `revoke_invitation`.

| ID | Severidad | Hallazgo | Estado |
|---|---|---|---|
| N1 | Media | `current_tenant()` se evaluaba fila a fila: unas 60 veces más lento en un seq scan de 600k filas, y sin planes paralelos | **Corregido** (0007): políticas con `(SELECT commerce.current_tenant())`. La regla queda en `TENANT-ISOLATION.md` §1 y el catálogo la comprueba |
| N2 | Baja | La invitación de un admin expulsado volvía a valer si lo readmitían | **Corregido** (0007 + 0008): un trigger revoca las invitaciones pendientes de quien pierde el permiso. La regresión detectó un fallo con NULL en la primera versión, que se arregló en 0008 |
| N3 | Baja | Quedan filas antiguas en `request_context`, como mucho una por backend | Aceptado. Solo las ve el dueño. Se añadirá limpieza periódica cuando haya jobs (R2) |
| N4 | Baja | `mc_ops` lee tiendas sin pasar por `begin_session`. El control de operador lo hace solo la app | Backlog de R2: hacer que la política de `mc_ops` exija operador en `request_context` |

Condición del revisor: corregir N1 antes de añadir tablas de comercio en R2. Ya está cumplida.

Riesgos conocidos y aceptados en R1:

- El slug es global, así que un 409 permite saber si un slug existe. Es inevitable con URLs públicas.
- Crear una organización no se audita, porque no tiene tenant. Se registrará en la auditoría de plataforma en R2.
- La única vulnerabilidad de dependencias es moderada: `minimatch` vía ESLint, solo en desarrollo.
