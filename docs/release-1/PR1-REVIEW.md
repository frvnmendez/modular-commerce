# Revisión del PR #1: hallazgos y correcciones

| Commit | Qué es |
|---|---|
| `059f25b` | **Original revisado.** Sobre él se hizo la revisión estática de la primera ronda |
| `be6af95` | **Primera corrección.** Corrige los cuatro hallazgos de la primera ronda |
| `0bcdea4` | **Segunda corrección.** Resultado de la segunda ronda, hecha sobre `be6af95` |
| `bb1961d` | Informe de la segunda ronda (solo documentación). Su CI **falló** por una prueba nueva que dependía de la collation (ver abajo) |
| `0640acd` | **Corrección del CI.** Una línea en `tests/isolation/test/tenant-isolation.test.ts`; no cambia código de la aplicación. CI en verde: [run 42532125447](https://github.com/frvnmendez/modular-commerce/actions/runs/42532125447) |

Todas las correcciones descritas en este informe están en `0640acd`, que era la cabeza del PR #1 al terminar la segunda ronda (`head.sha` consultado en la API de GitHub el 2026-11-08). Este documento se actualiza en un commit posterior que solo toca este fichero; su hash y su CI se indican en la descripción del PR.

En las dos rondas, cada hallazgo se reprodujo antes de corregirlo, y cada prueba nueva se comprobó contra el código con la corrección retirada (sabotaje): falla sin la corrección y pasa con ella.

---

## Primera ronda: hallazgos sobre `059f25b`, corregidos en `be6af95`

### 1. Identidad al aceptar invitaciones: **confirmado**

- **Problema en `059f25b`.** `control.accept_invitation(p_token_hash, p_user_email)` comparaba el email de la invitación con el que le pasaba quien llamaba.
- **Reproducción.** Una prueba desechable con el rol `mc_app` abrió la sesión de un atacante (`begin_session` con su propio token) y llamó a la función con el token de una invitación de admin y el email de la víctima. Resultado: `ACEPTADA por el atacante → true`, y los miembros pasaron a ser `reproowner…:owner, reproattacker…:admin`.
- **Impacto.** La API no estaba expuesta, porque pasaba el email de la sesión verificada. Pero quedaba un hueco en la capa de BD: el modelo de RT-R1 H1 supone que `mc_app` puede estar comprometido, y en ese caso se podía usar una invitación interceptada aunque fuera para otra cuenta.
- **Corrección en `be6af95` (migración 0009).**
  - La firma pasa a `control.accept_invitation(p_token_hash)`.
  - El email se lee de `auth."user"` con `control.current_user_id()`, y exige `emailVerified`.
  - La firma antigua se elimina.
- **Prueba.** `tests/isolation` → «mc_app no puede aceptar una invitación dirigida a otra cuenta…». Con `mc_app` directo comprueba:
  - Que la aceptación se rechaza (`INVITATION_INVALID`).
  - Que la firma con email ya no existe.
  - Que no hay efectos: ninguna membresía, la invitación sigue pendiente y no hay auditoría.

### 2. Continuación de invitaciones tras el login: **confirmado**

- **Problema en `059f25b`.** `sessionStorage.pendingInvite` se escribía en un 401, pero nadie lo leía (`grep` sin otros usos). Quien abría una invitación sin sesión terminaba en el onboarding o en su tienda, no en la invitación. Además, `sessionStorage` no se comparte entre pestañas, y el enlace de verificación del email se abre en otra.
- **Corrección en `be6af95`.**
  - Nuevo `apps/merchant-admin/lib/pending-invite.ts`. Guarda en `localStorage` y caduca a las 24 h.
  - Solo acepta la ruta interna exacta `/invitations/accept#<token>`, con la expresión `^/invitations/accept#[A-Za-z0-9_-]{20,200}$`.
  - La portada (`/`) la retoma después de iniciar sesión o de verificar el email.
  - El login muestra un aviso cuando llega desde una invitación.
- **Corrección del informe anterior.** Este informe decía que en `be6af95` el valor se borraba «ante un error definitivo (404)». **No era exacto:** el código lo borraba ante **cualquier** fallo que no fuera 401 o email sin verificar, incluidos 429, 5xx y fallos de red. Se corrige en `0bcdea4` (ver segunda ronda, punto 3).
- **Prueba.** E2E «invitación sin sesión → cuenta nueva → verificación en otra pestaña → acepta → vista de personal» y «… usuario existente inicia sesión → acepta como administrador». Si se desactiva la lectura en la portada, el primero falla (comprobado).

### 3. Límite de intentos detrás del proxy: **confirmado**

- **Reproducción sobre `059f25b`.** API con `TRUST_PROXY` vacío y peticiones a través del panel. El usuario A (127.0.0.2) obtuvo `401×5, 429×2`, y el usuario B (127.0.0.3) recibió **429 en su primer intento**: todos compartían la IP del panel.
- **Hallazgo adicional.** Los rewrites de Next.js 16 reenvían el `X-Forwarded-For` del cliente sin modificarlo y no añaden la IP real. Por eso no bastaba con poner la IP del panel en `TRUST_PROXY`: eso habría permitido falsificar la IP.
- **Corrección en `be6af95`.**
  - `apps/merchant-admin/server.mjs`, un servidor propio delante de Next. Fija una única IP de cliente según `PANEL_TRUST_PROXY` y descarta las cabeceras del cliente.
  - En la API, `TRUST_PROXY=127.0.0.1` en `.env.example`, con un log al arrancar que indica la configuración.
  - La cadena está documentada en `docs/DEPLOYMENT.md`.
- **Prueba.** E2E «límite de intentos a través del panel». Comprueba que A queda bloqueado aunque rote `X-Forwarded-For`, que B no hereda el bloqueo y que decir que se viene de la IP de A no sirve. Una segunda prueba recorre la cadena con un balanceador simulado. Con `TRUST_PROXY` vacío la prueba falla (comprobado).

### 4. Pruebas de navegador y CI: **confirmado**

- **Problema en `059f25b`.** `tests/e2e/smoke.cjs` hacía tres cosas mal:
  - Omitía la aceptación si no encontraba el enlace (`if (link)`).
  - Ignoraba los errores al leer el enlace (`.catch(() => null)`).
  - Solo imprimía los errores de consola, sin hacer fallar la prueba.

  No formaba parte de CI ni tenía dependencias declaradas.
- **Corrección en `be6af95`.**
  - Se sustituye por `tests/e2e`: Playwright `@playwright/test@1.63.0` declarado, con escenarios en serie (7 en `be6af95`, 11 en `0bcdea4`).
  - Cualquier error de JS, error de consola o respuesta ≥ 400 que el escenario no declare como esperado (método, ruta y código) hace fallar la prueba.
  - Playwright arranca la API y el panel por su cuenta, con el límite de intentos activado.
  - En CI se añaden la compilación del panel, la instalación de Chromium y el E2E, y el informe se sube si falla.
  - La propia E2E encontró un defecto: la auditoría no tenía etiqueta para `invitation.revoked`.
- **Controles negativos.** `tests/isolation/negative-controls.mjs` exige, para cada sabotaje, tres cosas:
  - Que pasen algunas pruebas, lo que demuestra que la preparación funcionó.
  - Que fallen las pruebas que detectan ese sabotaje concreto.
  - Que ningún fallo sea de infraestructura (conexión, hooks, timeouts).

  Sustituye al bucle anterior, que solo comprobaba que el código de salida no fuera 0.

---

## Segunda ronda: comprobaciones sobre `be6af95`, corregidas en `0bcdea4`

### 1. ¿Puede `mc_app` falsificar `current_user_id()` o cambiar el email o `emailVerified`? **No. Ya estaba cubierto; se añaden pruebas explícitas**

Por qué no puede:

- `control.current_user_id()` lee `control.request_context` filtrando por `pg_backend_pid()` y por la transacción actual (`packages/db/migrations/0006_red_team_r1.sql`).
- Esa tabla es de `mc_migrator` y tiene RLS FORCE sin políticas. `mc_app` no tiene ningún privilegio sobre ella.
- Solo la escribe `control.begin_session(token)`, que exige una sesión vigente en `auth.session` de un usuario con `emailVerified`. `mc_app` no puede leer `auth.session`, así que no puede obtener tokens ajenos.
- `mc_app` no tiene `USAGE` sobre el esquema `auth`: no puede leer ni escribir `auth."user"` ni `auth.session`.
- `mc_app` no es miembro de ningún rol, no puede crear objetos en `public` ni tablas temporales, y todas las funciones `SECURITY DEFINER` fijan `search_path` y califican sus tablas.
- Por la API de identidad tampoco: Better Auth responde `EMAIL_CAN_NOT_BE_UPDATED` a `update-user` con `email`, `CHANGE_EMAIL_DISABLED` a `change-email` (no está activado en `packages/auth/src/index.ts`) e ignora `emailVerified` en `update-user`.

Pruebas añadidas:

- `tests/isolation` → «mc_app no puede suplantar la identidad del contexto ni tocar email/emailVerified». Con `mc_app` directo comprueba que se deniegan:
  - `INSERT` y `UPDATE` en `control.request_context`;
  - `UPDATE auth."user"` de email y `emailVerified`, e `INSERT` de una sesión forjada en `auth.session`;
  - `SET ROLE mc_auth` y `SET ROLE mc_migrator`;
  - crear una función en `public` y una tabla temporal con el mismo nombre.

  Además, cambiar el `search_path` de la sesión no altera `current_user_id()` (sigue `NULL`) y `accept_invitation` responde `NO_USER_CONTEXT`. En el catálogo, solo `mc_auth` puede escribir en `auth."user"` y `auth.session`, y nadie salvo el dueño en `request_context`.
- `apps/commerce-api` → «update-user y change-email no cambian email ni emailVerified, y no sirven para aceptar una invitación ajena».

Límite de esta garantía: Better Auth (`mc_auth`) se ejecuta en el mismo proceso que la API. Si el proceso entero estuviera comprometido, el atacante tendría también las credenciales de `mc_auth`. La defensa en BD cubre que se abuse de la conexión `mc_app`, por ejemplo con una inyección SQL, no que se tome el control del proceso.

### 2. ¿El arranque de producción usa `server.mjs` y no hay forma de saltarse la normalización? **Hueco encontrado y corregido**

- **Comprobado en el repositorio.** `apps/merchant-admin/package.json` define `start` como `node server.mjs`. README, `DEPLOYMENT.md` y Playwright lo usan. No hay Dockerfile, Procfile ni salida `standalone`.
- **Hueco.** Nada impedía arrancar con `next start`. **Reproducido sobre `be6af95`:** con la API en `TRUST_PROXY=127.0.0.1` y el panel arrancado con `next start`, 8 intentos de login rotando `X-Forwarded-For` dieron `401×8`, sin ningún 429. Sin la cabecera, todos los clientes volvían a compartir un mismo contador.
- **Corrección en `0bcdea4`.**
  - `next.config.ts` lanza un error en la fase de servidor de producción si falta la marca `MC_PANEL_SERVER=1`.
  - `server.mjs` fija esa marca antes de cargar Next.
  - Comprobado: `next start` sale con código 1 y el mensaje «El panel debe arrancarse con `node server.mjs`»; `node server.mjs` sirve con normalidad.
- **Prueba.** E2E «el panel no arranca en producción con `next start`…». Falla si se retira la comprobación (comprobado).
- **Depende del despliegue real (no comprobado):**
  - que el orquestador ejecute `pnpm start`;
  - que la API no sea accesible salvo desde el panel. Un proceso local en la máquina de la API podría falsificar la IP;
  - el `PANEL_TRUST_PROXY` real y el comportamiento real del balanceador.

  Detalle en `docs/DEPLOYMENT.md` §Vías alternativas de arranque. La marca evita un error de configuración, no un ataque.

### 3. Invitación con otra cuenta, dos invitaciones en pestañas y caducidad

**Invitación abierta con una cuenta distinta de la destinataria.** El servidor ya lo rechazaba bien:

- responde 404 `INVITATION_INVALID`;
- la invitación no se consume, sigue pendiente para su destinataria;
- no da acceso a la tienda.

Hueco de UX encontrado: la página mostraba el error pero no ofrecía forma de continuar. **En `0bcdea4`** se añade «Cerrar sesión y usar otra cuenta», que guarda la invitación, cierra la sesión y la retoma al entrar con la cuenta correcta.

- **Prueba:** E2E «invitación abierta con otra cuenta: no se consume, se informa y se puede cambiar de cuenta».

**Dos invitaciones en pestañas distintas, sin sesión.** **Hueco confirmado en `be6af95`:** el valor guardado era único, así que la segunda pestaña sobrescribía la primera y solo se retomaba una. La otra seguía siendo válida en el servidor, pero había que volver a abrir su enlace.

**En `0bcdea4`** se guarda una lista: máximo 5, sin duplicados y en orden de apertura. Tras aceptar una invitación, si queda otra pendiente se retoma a continuación.

- **Prueba:** E2E «dos invitaciones abiertas en pestañas distintas sin sesión: se aceptan las dos tras iniciar sesión». Con dos tiendas distintas, termina siendo miembro de ambas. Falla con el valor único (comprobado).

**Caducidad.** El servidor la valida: `accept_invitation` rechaza si `expires_at < now()` (`packages/db/migrations/0009_accept_invitation_db_email.sql`). Las 24 h del navegador solo deciden si la invitación se retoma automáticamente. No conceden validez.

Hasta ahora ninguna prueba lo cubría. **En `0bcdea4`** se añade `tests/isolation` → «el servidor rechaza una invitación caducada aunque el email coincida, y la acepta si sigue vigente»:

- con la invitación vencida, responde 404, sin membresía, y la invitación sigue pendiente;
- control positivo: la misma invitación con fecha futura sí se acepta.

### Fallo de CI en `bb1961d` y corrección en `0640acd`

- **Qué falló.** El [run 42531989506](https://github.com/frvnmendez/modular-commerce/actions/runs/42531989506) sobre `bb1961d` se detuvo en «Suite de aislamiento (Gate C)». Solo falló una de las 20 pruebas: la nueva «mc_app no puede suplantar la identidad…». Los pasos siguientes (controles negativos, auditoría, compilación del panel y E2E) no llegaron a ejecutarse.
- **Por qué.** La prueba obtenía del catálogo las tablas en las que puede escribir cada rol, con `ORDER BY` en SQL, y comparaba la lista con un array fijo. El orden de `'auth."user"'` frente a `'auth.session'` depende de la collation de la base de datos:
  - en local la base de datos usa `C.UTF-8`, que compara bytes: la comilla (`"`, 0x22) va antes que la `s`, y sale `auth."user"` primero;
  - el Postgres del CI (imagen `postgres:16`) se inicializa con la locale de glibc `en_US.utf8`, según su propio log: «The database cluster will be initialized with locale "en_US.utf8"». Allí la consulta devolvió `auth.session` primero: el mensaje del fallo fue `expected [ 'mc_auth:auth.session', …(1) ] to deeply equal [ 'mc_auth:auth."user"', …(1) ]`. Es coherente con que glibc ignora la puntuación en la primera pasada de la comparación (`session` < `user`).

  Límite de la comprobación: este contenedor no tiene la locale `en_US.utf8` de glibc, así que el orden del CI no se reprodujo en local. La evidencia es el log del CI. La collation ICU `en-US-x-icu`, que sí está disponible aquí, ordena como `C` (`auth."user"` primero), lo que confirma que el resultado depende del proveedor y de la locale de cada base de datos.

  El contenido era el mismo (`mc_auth` puede escribir en esas dos tablas y nadie más); solo cambiaba el orden. No era un fallo de seguridad ni de la aplicación.
- **Corrección en `0640acd`.** La lista se ordena en JavaScript (`.sort()`) antes de compararla, así el resultado no depende de la collation. No se relajó ninguna aserción.
- **Comprobación.** En local, aislamiento 20/20 y los tres controles negativos detectados por la causa prevista. En CI, [run 42532125447](https://github.com/frvnmendez/modular-commerce/actions/runs/42532125447) en verde sobre `0640acd`, con todos los pasos:
  - lint y tipos;
  - core 6/6, API 30/30, aislamiento 20/20;
  - controles negativos: `rls-off` 8 fallan y 12 pasan, `permissive` 8/12, `membership` 9/11;
  - auditoría: una vulnerabilidad moderada (`minimatch`, solo en desarrollo);
  - compilación del panel y E2E 11/11.

### Cuándo se borra la invitación guardada (`0bcdea4`)

| Situación | ¿Se borra? |
|---|---|
| Aceptada (200) | Sí, esa entrada |
| 404 (no existe, caducada, usada, revocada o para otro email) o 400 (token mal formado) | Sí, esa entrada: es definitivo |
| 401 (sin sesión) o email sin verificar | No: se guarda y se va al login |
| 429, 5xx o sin conexión | **No:** se conserva y se muestra «Reintentar». E2E «un fallo transitorio…», que falla si se borra ante cualquier error (comprobado) |
| Más de 24 h guardada | Se descarta al leerla |
| Cerrar sesión | Sí, todas |
| «Cerrar sesión y usar otra cuenta» | Se borran todas y se vuelve a guardar solo la actual |

En `be6af95` se borraba ante cualquier fallo distinto de 401 o email sin verificar.

---

## Pendientes para producción (no validados, fuera del alcance de este PR)

- **Balanceador o CDN real.** Solo se ha probado la lógica de `PANEL_TRUST_PROXY` con un balanceador simulado (función `clientIp`) y la cadena panel → API en local. Falta comprobar con el balanceador real que añade `X-Forwarded-For` como se espera, y fijar `PANEL_TRUST_PROXY` y `TRUST_PROXY` reales.
- **Envío real de emails.** No hay remitente de producción: los emails se escriben en el log y, fuera de producción, en `MAIL_OUTBOX_FILE`. No se ha probado la entrega, ni los enlaces abiertos desde un cliente de correo real, ni los filtros de spam.
- **Topología de despliegue.** Que solo el panel sea público y que se arranque con `pnpm start` depende del despliegue, que en R1 no existe.
