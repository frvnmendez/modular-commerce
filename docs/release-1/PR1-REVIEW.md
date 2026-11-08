# Revisión del PR #1 (commit `059f25b`): hallazgos y correcciones

Cada hallazgo se reprodujo sobre `059f25b` antes de corregirlo. La prueba que lo cubre falla con el código anterior y pasa con el nuevo.

## 1. Identidad al aceptar invitaciones: **confirmado**

- **Problema.** `control.accept_invitation(p_token_hash, p_user_email)` comparaba el email de la invitación con el que le pasaba quien llamaba.
- **Reproducción.** Una prueba desechable con el rol `mc_app` abrió la sesión de un atacante (`begin_session` con su propio token) y llamó a la función con el token de una invitación de admin y el email de la víctima. Resultado: `ACEPTADA por el atacante → true`, y los miembros pasaron a ser `reproowner…:owner, reproattacker…:admin`.
- **Impacto.** La API no estaba expuesta, porque pasaba el email de la sesión verificada. Pero quedaba un hueco en la capa de BD: el modelo de RT-R1 H1 supone que `mc_app` puede estar comprometido, y en ese caso se podía usar una invitación interceptada aunque fuera para otra cuenta.
- **Corrección (migración 0009).**
  - La firma pasa a `control.accept_invitation(p_token_hash)`.
  - El email se lee de `auth."user"` con `control.current_user_id()`, y exige `emailVerified`.
  - La firma antigua se elimina.
- **Prueba.** `tests/isolation` → «mc_app no puede aceptar una invitación dirigida a otra cuenta…». Con `mc_app` directo comprueba:
  - Que la aceptación se rechaza (`INVITATION_INVALID`).
  - Que la firma con email ya no existe.
  - Que no hay efectos: ninguna membresía, la invitación sigue pendiente y no hay auditoría.

## 2. Continuación de invitaciones tras el login: **confirmado**

- **Problema.** `sessionStorage.pendingInvite` se escribía en un 401, pero nadie lo leía (`grep` sin otros usos). Quien abría una invitación sin sesión terminaba en el onboarding o en su tienda, no en la invitación. Además, `sessionStorage` no se comparte entre pestañas, y el enlace de verificación del email se abre en otra.
- **Corrección.**
  - Nuevo `apps/merchant-admin/lib/pending-invite.ts`. Guarda en `localStorage` y caduca a las 24 h.
  - Solo acepta la ruta interna exacta `/invitations/accept#<token>`, con la expresión `^/invitations/accept#[A-Za-z0-9_-]{20,200}$`.
  - La portada (`/`) la retoma después de iniciar sesión o de verificar el email.
  - El valor se borra al aceptar, ante un error definitivo (404) y al cerrar sesión.
  - El login muestra un aviso cuando llega desde una invitación.
- **Prueba.** E2E «invitación sin sesión → cuenta nueva → verificación en otra pestaña → acepta → vista de personal» y «… usuario existente inicia sesión → acepta como administrador». Si se desactiva la lectura en la portada, el primero falla (comprobado).

## 3. Límite de intentos detrás del proxy: **confirmado**

- **Reproducción.** API con `TRUST_PROXY` vacío y peticiones a través del panel. El usuario A (127.0.0.2) obtuvo `401×5, 429×2`, y el usuario B (127.0.0.3) recibió **429 en su primer intento**: todos compartían la IP del panel.
- **Hallazgo adicional.** Los rewrites de Next.js 16 reenvían el `X-Forwarded-For` del cliente sin modificarlo y no añaden la IP real. Por eso no bastaba con poner la IP del panel en `TRUST_PROXY`: eso habría permitido falsificar la IP.
- **Corrección.**
  - `apps/merchant-admin/server.mjs`, un servidor propio delante de Next. Fija una única IP de cliente según `PANEL_TRUST_PROXY` y descarta las cabeceras del cliente.
  - En la API, `TRUST_PROXY=127.0.0.1` en `.env.example`, con un log al arrancar que indica la configuración.
  - La cadena está documentada en `docs/DEPLOYMENT.md`.
- **Prueba.** E2E «límite de intentos a través del panel». Comprueba que A queda bloqueado aunque rote `X-Forwarded-For`, que B no hereda el bloqueo y que decir que se viene de la IP de A no sirve. Una segunda prueba recorre la cadena con un balanceador simulado. Con `TRUST_PROXY` vacío la prueba falla (comprobado).

## 4. Pruebas de navegador y CI: **confirmado**

- **Problema.** `tests/e2e/smoke.cjs` hacía tres cosas mal:
  - Omitía la aceptación si no encontraba el enlace (`if (link)`).
  - Ignoraba los errores al leer el enlace (`.catch(() => null)`).
  - Solo imprimía los errores de consola, sin hacer fallar la prueba.

  No formaba parte de CI ni tenía dependencias declaradas.
- **Corrección.**
  - Se sustituye por `tests/e2e`: Playwright `@playwright/test@1.63.0` declarado, con 7 escenarios en serie.
  - Cualquier error de JS, error de consola o respuesta ≥ 400 que el escenario no declare como esperado (método, ruta y código) hace fallar la prueba.
  - Playwright arranca la API y el panel por su cuenta, con el límite de intentos activado.
  - En CI se añaden la compilación del panel, la instalación de Chromium y el E2E, y el informe se sube si falla.
  - La propia E2E encontró un defecto: la auditoría no tenía etiqueta para `invitation.revoked`.
- **Controles negativos.** `tests/isolation/negative-controls.mjs` exige, para cada sabotaje, tres cosas:
  - Que pasen algunas pruebas, lo que demuestra que la preparación funcionó.
  - Que fallen las pruebas que detectan ese sabotaje concreto.
  - Que ningún fallo sea de infraestructura (conexión, hooks, timeouts).

  Sustituye al bucle anterior, que solo comprobaba que el código de salida no fuera 0.
