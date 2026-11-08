# DEPLOYMENT

En R1 no hay ningún despliegue. Este documento describe cómo se ejecuta lo que existe y la configuración que un despliegue tendría que respetar.

## Procesos

| Proceso | Comando | Escucha | Notas |
|---|---|---|---|
| API | `node apps/commerce-api/src/server.ts` | `HOST:PORT` (por defecto `127.0.0.1:4000`) | No debe exponerse a Internet: solo la consume el panel |
| Panel | `pnpm --filter @mc/merchant-admin build` y después `pnpm --filter @mc/merchant-admin start` (= `node server.mjs`). `next start` se niega a arrancar | `HOSTNAME:PORT` (por defecto `127.0.0.1:3000`) | Es el borde público. Reenvía `/api/auth/*` y `/v1/*` a la API (`API_URL`, que se fija al compilar) |

## Cadena de confianza de la IP del cliente

El límite de intentos de inicio de sesión y de registro (5 por minuto) se cuenta **por IP**. Por eso la API tiene que ver la IP real de cada usuario y no la del proxy que tiene delante, y ningún cliente debe poder inventársela.

```
navegador ──► [balanceador/CDN: PANEL_TRUST_PROXY] ──► panel (server.mjs) ──► API (TRUST_PROXY = IP del panel)
```

1. **Panel (`server.mjs`).**
   - Descarta las cabeceras `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, etc. que lleguen del cliente.
   - Las sustituye por **una sola IP**:
     - si quien conecta no está en `PANEL_TRUST_PROXY`, la del socket;
     - si está, la primera dirección que no es de confianza, leyendo `X-Forwarded-For` de derecha a izquierda.
   - Hace falta este servidor propio porque los rewrites de Next.js reenvían el `X-Forwarded-For` del cliente tal cual y no añaden la IP real. Está comprobado: un `X-Forwarded-For: 6.6.6.6` enviado por el cliente llegaba intacto a la API.
2. **API.**
   - Fastify usa `X-Forwarded-For` solo si la conexión llega desde una dirección de `TRUST_PROXY`.
   - Después vuelve a descartar las cabeceras de reenvío y pasa a Better Auth únicamente `req.ip`.

| Variable | Dónde | Valor |
|---|---|---|
| `TRUST_PROXY` | API | Dirección o direcciones desde las que el panel conecta con la API. Si están en la misma máquina: `127.0.0.1`. Vacío solo si la API recibe a los usuarios directamente, sin proxy |
| `PANEL_TRUST_PROXY` | Panel | IP o CIDR de los proxies que hay delante del panel (balanceador, CDN), separados por comas. Vacío si el panel es el borde |

Errores que hay que evitar:

- **`TRUST_PROXY` vacío con el panel delante.** Todos los usuarios comparten la IP del panel, y 5 intentos fallidos de cualquiera bloquean el login de todos. Se reprodujo antes de la corrección: el usuario B recibía 429 en su primer intento.
- **Confiar en rangos amplios.** Por ejemplo, `loopback` o `0.0.0.0/0` en `TRUST_PROXY`, o la red de los clientes en `PANEL_TRUST_PROXY`. Permite que el cliente elija su IP.
- **Exponer la API directamente** con `TRUST_PROXY` configurado.

### Vías alternativas de arranque

| Vía | Estado | Cómo se comprueba |
|---|---|---|
| `pnpm start` / `node server.mjs` | Única vía de producción. Marca el proceso con `MC_PANEL_SERVER=1` antes de cargar Next | E2E y `README.md` lo usan |
| `next start` | **Rechazado**: `next.config.ts` lanza un error en la fase de servidor de producción si falta la marca. Antes de esta comprobación se reprodujo el hueco: rotando `X-Forwarded-For`, 8 intentos de login dieron 8×401 sin ningún 429 | E2E «el panel no arranca en producción con `next start`» |
| `next dev` | Solo desarrollo, sin normalización. No debe exponerse | — |
| Salida `standalone` de Next | No está configurada (`output` no aparece en `next.config.ts`) | Revisión del fichero |
| Llamar a la API directamente | La API escucha en `127.0.0.1` por defecto. Un cliente remoto no está en `TRUST_PROXY`, así que se usa la IP de su socket y su `X-Forwarded-For` se ignora. Un proceso **local** en la máquina de la API sí podría falsificarla | Depende del despliegue |

La marca `MC_PANEL_SERVER` evita un error de configuración, no un ataque: quien controla el entorno del proceso puede fijarla.

### Qué está comprobado y qué depende del despliegue real

- **Comprobado localmente y en CI:** el panel sustituye las cabeceras de IP del cliente; la API solo confía en `127.0.0.1`; IP distintas no comparten bloqueo; falsificar `X-Forwarded-For` no lo elude; `next start` no arranca; la lógica de `PANEL_TRUST_PROXY` con un balanceador **simulado** (función `clientIp`).
- **Pendiente, depende del despliegue real:** que el orquestador ejecute `pnpm start` y no otra orden; que solo el panel sea accesible desde fuera y la API quede en una red privada; el valor real de `PANEL_TRUST_PROXY` y que el balanceador real **añada** (no sustituya ni reenvíe sin más) `X-Forwarded-For`; y el `TRUST_PROXY` real si panel y API están en máquinas distintas. **No se ha validado con ningún balanceador real.**

Lo comprueba `tests/e2e/specs/r1.spec.ts`:

- Dos IP de cliente distintas (`127.0.0.2` y `127.0.0.3`) que pasan por el panel no comparten el bloqueo.
- Rotar `X-Forwarded-For` no evita el bloqueo.
- Decir que se viene de la IP bloqueada no bloquea a otro.
- La cadena con un balanceador simulado (`PANEL_TRUST_PROXY=10.0.0.0/8`) devuelve la IP correcta.
- `next start` falla al arrancar con un mensaje que remite a `server.mjs`.

## Otras variables

Están en `.env.example`. En producción la API se niega a arrancar si `AUTH_BASE_URL` o `ALLOWED_ORIGINS` no son `https://`, para que las cookies sean `Secure`. `MAIL_OUTBOX_FILE` solo se usa fuera de producción, para que las pruebas E2E lean los emails. **No hay envío real de emails:** el remitente de producción no está implementado ni probado (pendiente).
