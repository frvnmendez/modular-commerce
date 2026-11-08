# Release 0 — Informe de verificación

Fecha: 2026-11-08 · Estado: **pendiente de aprobación del propietario** · Gate A (viabilidad): propuesto GO condicionado

Este informe recoge solo lo que se ejecutó de verdad. Cada resultado indica comando, entorno y evidencia. Los estados siguen la escala del plan maestro: aquí todo es como mucho **"Probado localmente"**.

## 1. Entorno

| Elemento | Valor verificado |
|---|---|
| Contenedor de trabajo | Ubuntu 24.04.5, x86_64, 4 vCPU, 15 GiB RAM, sesión efímera en la nube |
| Node.js / npm / pnpm / bun | v22.23.4 / 10.9.9 / 10.28.0 / 1.4.4 (Deno ausente) |
| PostgreSQL / Redis | 16.15 / 7.0.15 (locales, arrancados manualmente) |
| Docker | Cliente 29.9.2 **sin daemon** (no se pueden levantar contenedores aquí) |
| Red | npm, PyPI y `git clone` de GitHub funcionan; `api.github.com` y `curl github.com` devuelven 403 (política del proxy). WebFetch/WebSearch funcionan |
| Repositorios GitHub accesibles | `frvnmendez/veredicto`, `frvnmendez/0xblvcknode` (no relacionados). **No existe repositorio del proyecto** |
| Dispositivo del usuario | macOS arm64 enlazado, sin carpetas compartidas. No se ha tocado |
| Subagentes | Disponibles. Se usaron 2 investigadores en paralelo (motores; herramientas/editores). La verificación de sus hallazgos críticos se hizo con pruebas propias (Vendure, Medusa) |
| Secretos | Ninguno encontrado ni creado. Credenciales de PoC son locales y triviales (`postgres/postgres`, `superadmin`) |

## 2. PoC A — Aislamiento propio con PostgreSQL RLS

Código: `poc/rls-isolation/` (`schema.sql`, `src/db.ts`, `test/isolation.test.ts`).

Diseño probado: tablas con `tenant_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, rol de aplicación `app_user` sin `BYPASSRLS` y que no es dueño de las tablas, contexto de tenant con `set_config('app.tenant_id', $1, true)` (local a la transacción), FKs compuestas `(tenant_id, id)`, tenant tomado de la sesión y nunca de la petición.

Comando: `npx vitest run` → **20/20 tests pasan** tras las correcciones del Red Team (§6) (`vitest-run.log`). `tsc --strict` sin errores.

| # | Escenario (requisito §4 del directive) | Resultado |
|---|---|---|
| 1-4 | Productos, clientes, pedidos y secretos independientes; A no ve nada de B | ✅ |
| 7 | IDOR: A pide por ID un producto de B → `null`; UPDATE/DELETE por ID → 0 filas | ✅ |
| 7 | A inserta con `tenant_id` de B o mueve una fila suya a B → error RLS | ✅ |
| 7 | Pedido de A que referencia cliente o producto de B → error de FK / no encontrado | ✅ |
| 7 | Sin contexto de tenant → 0 filas. `SET row_security = off` → error, no bypass | ✅ |
| 8 | Secretos por tenant aislados (tabla bajo RLS) | ✅ |
| — | Pool de 1 conexión: el contexto no se filtra a la siguiente petición | ✅ |
| — | 200 peticiones concurrentes intercaladas A/B: ninguna ve datos ajenos | ✅ |
| — | Idempotencia: 10 envíos concurrentes con la misma clave → 1 pedido, stock descontado una vez | ✅ |
| — | Misma clave de idempotencia en dos tenants → pedidos distintos | ✅ |
| — | Total calculado en servidor; stock nunca negativo | ✅ |
| 9 | Transacción bloqueante en A no bloquea a B (<1 s); `statement_timeout` por tenant corta a A | ✅ |
| 10 | Migración que falla a mitad → rollback completo (DDL transaccional), datos de A y B intactos | ✅ |

**Controles negativos** (`vitest-sabotage.log`): la suite debe fallar con cada sabotaje, y falla:

| Sabotaje | Tests que fallan |
|---|---|
| `SABOTAGE_RLS=1` (RLS desactivado) | 16/20 |
| `=permissive` (política `USING (true)`) | 15/20 |
| `=noforce` (sin `FORCE`) | 1/20 (lo detecta el test de catálogo, que existe para eso) |
| `=owner` (`app_user` dueño de las tablas) | 3/20 (catálogo) |

Límites honestos de esta PoC:
- No cubre la capa HTTP, colas, caché, almacenamiento de objetos ni logs (§12 del directive). Se cubrirán en R1/R2.
- RLS por variable de sesión **no protege frente a inyección SQL**: quien ejecuta SQL arbitrario puede cambiar `app.tenant_id`. Mitigación: solo consultas parametrizadas (ORM), revisión estática, y rol sin privilegios. Registrado como riesgo R-03.
- Los "administradores y permisos independientes" (#5, #6) se demostraron en la PoC de Vendure y en el gestor de módulos, no aún en nuestro propio RBAC (R1).

## 3. PoC B — Vendure 3.8.1: ¿son los canales una frontera de seguridad?

Código: `poc/vendure-channels/`. Vendure `@vendure/core@3.8.1` (npm, publicado 2026-10-23) sobre PostgreSQL 16, sin plugins. Dos canales, un rol por canal, un administrador por rol, producto y cliente por canal.

Comando: `node poc-channels.mjs` → 7/7 controles de acceso del Admin API correctos (`poc-channels.log`):
- A lista solo sus productos; producto de B por ID → `null`.
- A envía la cabecera `vendure-token` del canal B → `FORBIDDEN`.
- A intenta renombrar o borrar el producto de B → `ENTITY_NOT_FOUND`.
- A lista/pide clientes de B por ID → no los ve.

**Hallazgos que descartan los canales como frontera entre comerciantes:**
1. **Fuga de datos personales entre tiendas (reproducida).** `poc-extra.mjs` + `poc-pii.mjs`: el mismo email se registra en la tienda A y en la B → Vendure crea **un único cliente global** asociado a 3 canales (por defecto, A y B). El admin de A añade una dirección ("Dato privado de A, Calle Secreta 1"); el admin de B la lee por la API (`poc-pii.log`). Para un SaaS donde cada comerciante es responsable de tratamiento independiente (RGPD), esto es un defecto de diseño, no un bug puntual. Coincide con la documentación oficial que confirma clientes compartidos (ver `docs/research/motores-comerciales.md`).
2. Todo producto creado en A o B queda asignado también al canal por defecto (visible para el superadmin; esperado, pero implica que el aislamiento es solo de aplicación).
3. Países, zonas y categorías de impuestos son globales y visibles para cualquier admin de canal.
4. IDs secuenciales (1, 2, 3…) compartidos entre tiendas: filtran volumen de negocio y facilitan enumeración.
5. Los plugins de Vendure se ejecutan **en el mismo proceso** con acceso completo a la base de datos: incompatible con el requisito de que módulos externos no ejecuten código en el proceso principal.

Huella: proceso Vendure en reposo ≈ **171–233 MB RSS** (medido con `ps`).

## 4. PoC C — Medusa 2.18.0: huella de una instancia

Starter oficial `medusa-starter-default` (commit `9565d9d`, 2026-07-24, fija `@medusajs/medusa@2.18.0`; la última en npm es 2.22.4 del 2026-11-06). `medusa db:migrate` crea **143 tablas**. `medusa start` con admin desactivado: health OK en ≈3,6 s, **≈340 MB RSS** en reposo y 6 conexiones a Postgres abiertas.
- `GET /admin/stores` devuelve una tienda; `POST /admin/stores` → **404**: una instancia = una tienda. No hay modelo multi-tenant nativo (el investigador no encontró postura oficial; discusiones sin respuesta del equipo).
- `@medusajs/medusa@2.22.4` incluye ahora una sección **Enterprise Edition propietaria** (fichero LICENSE del paquete npm) y un chequeo remoto de licencia que solo actúa si se configura una clave.

Conclusión cuantitativa (estimación, no medición a escala): una instancia por tienda costaría del orden de **0,3 GB de RAM por tienda en reposo** → ~3 TB para 10.000 tiendas, más ~6 conexiones Postgres por tienda. Inviable para planes de entrada; viable solo como opción Enterprise dedicada.

## 5. PoC D — Ciclo de vida del sistema de módulos

Código: `poc/module-lifecycle/` (manifiesto Zod 4.6.7 + semver, gestor de estados). Comando: `npx vitest run` → **29/29 pasan** (19 originales + 10 de regresión del Red Team, §6). `tsc --strict` limpio. En la primera ejecución los tests encontraron 2 defectos propios (un test con IDs inválidos y un rollback que intentaba una transición ilegal).

Casos cubiertos (§7 del directive): manifiesto válido/ inválido (id, semver, HTTPS, campos desconocidos), coherencia capacidad↔permiso, PII reservada a módulos oficiales, ciclo completo INSTALL→CONFIGURE→ACTIVATE→UPDATE→DISABLE→UNINSTALL, actualización compatible e incompatible, versión mayor y permisos nuevos requieren aprobación, dependencia ausente, dependencia circular, instalación duplicada, independencia entre tenants, configuración incompleta, módulo defectuoso, credencial revocada al deshabilitar y sin acceso a otro tenant, dependientes activos, desinstalación con pedidos pendientes, fallo de migración en instalación (compensación + reintentos limitados a 3) y en actualización (rollback a versión anterior), reinicio a mitad de instalación, transiciones ilegales, secretos nunca en el log de auditoría.

Límite: es un modelo en memoria. Persistencia, ejecución fuera de proceso, firma de webhooks, cuotas y circuit breakers se implementan en R3.

## 6. Revisión independiente (Red Team)

Un agente revisor distinto del que implementó reprodujo las suites y ejecutó sondas propias. Veredicto: **GO condicionado**. Hallazgos y estado:

| # | Sev. | Hallazgo | Estado |
|---|---|---|---|
| 1 | Crítica | Con FORCE RLS, el rol de migración sin contexto actualizaba 0 filas sin error (backfills a medias); el test de migración no lo detectaba | **Corregido**: `migrator` con BYPASSRLS (uso auditado); tests RT-1 comprueban filas afectadas |
| 2 | Crítica | `activate()` repetido dejaba una credencial huérfana viva | **Corregido**: validación de transición antes de efectos + revocación previa (test RT-2) |
| 3 | Crítica | El módulo podía autodeclararse `official` y obtener PII | **Corregido**: el tier lo asigna el registro, no el manifiesto (RT-3) |
| 4 | Alta | Instalación fallida se podía activar | **Corregido** (RT-4) |
| 5 | Alta | Reintentos ilimitados vía `install()`, `configure()` mutaba antes de fallar, update rompía dependientes, reactivación sin dependencia, rollback fallido tragado, `approveMajor` aprobaba permisos | **Corregidos** (RT-5a…f) |
| 6 | Alta | SSRF (`http://localhost.evil.com`, `169.254.169.254`) y suplantación de eventos de plataforma | **Corregido** en validación estática (RT-6). Falta comprobación al resolver DNS/conectar (R3) |
| 7 | Alta | Vistas creadas por superusuario evaden RLS; nada lo vigilaba | **Corregido**: test de catálogo (RT-7) en la suite |
| 8 | Media | `commerce.tenants` sin RLS | **Corregido** (RT-8) |
| 9 | Media | GUC de sesión puesto por error sobrevive en el pool | **Corregido**: `DISCARD ALL` al devolver la conexión (RT-9). Lint que prohíba `SET`/`set_config(...,false)`: R1 |
| 10 | Media | Misma clave de idempotencia con payload distinto → error 500; replay con otro payload silencioso | **Corregido**: tabla `idempotency_keys` con hash, conflicto explícito (409) (RT-10, 20 rondas concurrentes) |
| 11 | Baja | Oráculo de existencia por PK global; `pg_class.reltuples` revela volumen global; UUIDv7 lleva timestamp | Aceptado y registrado (R-16). Revocar acceso a estadísticas del catálogo a `app_user` en R1 |
| 12 | Opinión | ADR-0001 descarta el híbrido Medusa sin PoC ni estimación del núcleo propio | **Parcialmente aceptado**: ver ADR-0001 §Revisión. Se propone decidir el motor antes de R2 tras un spike corto |
| 13 | Opinión | La fuga de clientes de Vendure quizá se arregla con un plugin | Aceptado como hipótesis a probar en el spike |
| 14 | Opinión | Faltan: agotamiento de pool por tenant, borrado/exportación RGPD por tienda, restore de una tienda, IVA UE/OSS, rol de soporte entre tenants | Añadidos al registro de riesgos y al plan de R1/R2/R8 |

## 7. Qué NO se ha verificado

- Rendimiento a escala, carga o Core Web Vitals (no hay producto aún).
- Saleor y Bagisto: solo investigación documental, sin PoC (stack Python/PHP fuera del objetivo TypeScript).
- Postura de Vendure GmbH sobre SaaS con GPLv3 (requiere consulta escrita).
- Ningún pago, ni siquiera sandbox (no hay credenciales de Stripe; se pedirán en R2/R4).
- Fechas de último commit en GitHub (bloqueado para scraping); se usaron fechas de publicación en npm/PyPI/Packagist.
