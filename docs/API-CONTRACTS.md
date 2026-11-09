# API-CONTRACTS

Contrato **implementado** en Release 1 por `apps/commerce-api` (Fastify). Fuente de verdad: `apps/commerce-api/src/app.ts` y sus pruebas.

## Reglas generales

- **Autenticación:** cookie de sesión de Better Auth (`HttpOnly`, `SameSite=Lax`). Sin sesión → `401 UNAUTHENTICATED`. Email sin verificar → `403 EMAIL_NOT_VERIFIED`.
- **Tenant:** el tenant **nunca** viene del cliente como dato de confianza. Sale del `:storeId` de la ruta y se valida con la pertenencia del usuario en la BD (`control.enter_store`). Las cabeceras como `x-tenant-id` se ignoran. Si el cuerpo trae campos que no están en el esquema (`tenant_id`, `storeId`…), la respuesta es `400`.
- **Recursos ajenos:** una tienda de la que no eres miembro, un ID malformado o un ID inexistente devuelven siempre `404 NOT_FOUND`. Así no se puede saber si un recurso existe.
- **CSRF:** si una mutación llega con un `Origin` fuera de `ALLOWED_ORIGINS`, la respuesta es `403 ORIGIN_NOT_ALLOWED`. Un `POST` o `PATCH` en `/v1` sin `Content-Type: application/json` devuelve `415 JSON_REQUIRED`.
- **Errores:** `{ "error": "<CÓDIGO>", "detail"?: "…" }`. Los códigos son `VALIDATION` (400, con `issues`), `NOT_FOUND` (404), `FORBIDDEN` (403), `CONFLICT` (409, con `detail` = `DUPLICATE` o `LAST_OWNER`) e `INTERNAL` (500, sin detalles).
- **Cabeceras de respuesta:** `x-content-type-options: nosniff`, `referrer-policy: no-referrer` y `cache-control: no-store`. Los registros ocultan la cookie, la autorización y `set-cookie`.

## Identidad (`/api/auth/*`, Better Auth)

| Método y ruta | Cuerpo | Notas |
|---|---|---|
| `POST /api/auth/sign-up/email` | `{ email, password (10–128), name }` | Envía el email de verificación y no deja una sesión utilizable |
| `GET /api/auth/verify-email?token=…&callbackURL=/` | — | Verifica el email e inicia sesión |
| `POST /api/auth/sign-in/email` | `{ email, password }` | Un email no verificado recibe `403` |
| `POST /api/auth/sign-out` | `{}` | Invalida la sesión |

Límite de peticiones: 5 por minuto e IP en `sign-in` y `sign-up`. Solo se desactiva en pruebas, con `AUTH_RATE_LIMIT=off`. La IP la decide el servidor: se descartan `X-Forwarded-For` y las cabeceras similares que envía el cliente. Se usa la IP del socket, o la que fija el servidor del panel cuando la petición llega desde él (`TRUST_PROXY`). La cadena de confianza está en `docs/DEPLOYMENT.md`. Restablecer la contraseña revoca todas las sesiones.

## Plataforma de cuentas y tiendas (`/v1`)

| Método y ruta | Permiso | Cuerpo | Respuesta |
|---|---|---|---|
| `GET /v1/me` | sesión | — | `{ user, organizations[{id,name,role}], stores[{id,orgId,name,slug,role}], platformOperator }` |
| `POST /v1/organizations` | sesión | `{ name }` | `201 { id, name }` |
| `POST /v1/organizations/:orgId/stores` | owner/admin de la org | `{ name, slug, country, currency, profile: BusinessProfile }` | `201 { id, slug, capabilities[], recommendedModules[] }` · `409` (`detail: DUPLICATE`) si el slug existe |
| `GET /v1/stores/:storeId` | miembro | — | `{ id, orgId, name, slug, country, currency, status, cell, businessProfile, capabilities, role, permissions[] }` |
| `PATCH /v1/stores/:storeId` | `settings:write` (owner, admin) | `{ name?, country?, currency?, capabilities? }` | `{ ok: true }` · auditado |
| `GET /v1/stores/:storeId/navigation` | miembro | — | `{ items[{id,label,path}] }`: capacidades ∩ permisos |
| `GET /v1/stores/:storeId/members` | `members:read` (owner, admin; también en la BD) | — | `{ members[{userId,name,email,role}], pendingInvitations[{id,email,role,expiresAt}] }` |
| `POST /v1/stores/:storeId/invitations` | `members:invite`. El admin solo invita a `staff` | `{ email, role: admin\|staff }` | `201 { id, token }`. El token se devuelve **una sola vez** y en la BD solo queda su sha256. Caduca a los 7 días |
| `DELETE /v1/stores/:storeId/invitations/:invitationId` | owner; admin solo invitaciones de staff | — | `204` · auditado (`invitation.revoked`) |
| `POST /v1/invitations/accept` | sesión con el **mismo email** de la invitación | `{ token }` | `{ storeId }` · `404` si ya se usó, si caducó, si se revocó o si el email no coincide |
| `PATCH /v1/stores/:storeId/members/:userId` | `members:manage` (owner) | `{ role: owner\|admin\|staff }` | `{ ok: true }` · `409` (`detail: LAST_OWNER`) |
| `DELETE /v1/stores/:storeId/members/:userId` | owner; admin sobre staff; uno mismo | — | `204` · `409` (`detail: LAST_OWNER`) · el acceso se pierde en el acto |
| `GET /v1/stores/:storeId/audit` | `audit:read` (owner, admin) | — | `{ events[{action,actorUserId,targetType,targetId,metadata,at}] }` (últimos 100) |
| `GET /v1/platform/stores` | operador de plataforma | — | `{ stores[…] }` (200 como máximo). Si no eres operador, `404`. Cada acceso queda en `platform_audit` |
| `GET /health` | — | — | `{ ok: true }` |

### `BusinessProfile`

Esquema estricto en `packages/core/src/onboarding.ts`. Campos:

- `businessType`
- `productKinds`: `physical`, `digital` o `both`
- `fulfillment`: `own-inventory`, `dropshipping` o `both`
- `markets`: lista de códigos ISO-2
- `shippingNeeds`: `none`, `domestic` o `international`
- `technicalLevel`
- `goals`: lista de objetivos (opcional)

De él se derivan las capacidades (`capabilitiesFor`) y los módulos recomendados (`recommendedModules`).

### Acciones de auditoría (R1)

`store.created`, `store.updated`, `settings.capabilities_changed`, `invitation.created`, `invitation.accepted`, `invitation.revoked`, `member.role_changed`, `member.removed`.

## No incluido en R1

Catálogo, pedidos, pagos, módulos y escaparate empiezan en R2 o más tarde. En el panel, esas secciones muestran el estado "Disponible en la próxima versión". En R1 la invitación no se envía por email: el panel muestra el enlace para copiarlo.
