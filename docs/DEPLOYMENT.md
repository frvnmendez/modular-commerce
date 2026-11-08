# DEPLOYMENT

En R1 no hay ningún despliegue. Este documento describe cómo se ejecuta lo que existe y la configuración que un despliegue tendría que respetar.

## Procesos

| Proceso | Comando | Escucha | Notas |
|---|---|---|---|
| API | `node apps/commerce-api/src/server.ts` | `HOST:PORT` (por defecto `127.0.0.1:4000`) | No debe exponerse a Internet: solo la consume el panel |
| Panel | `pnpm --filter @mc/merchant-admin build` y después `node apps/merchant-admin/server.mjs` | `HOSTNAME:PORT` (por defecto `127.0.0.1:3000`) | Es el borde público. Reenvía `/api/auth/*` y `/v1/*` a la API (`API_URL`, que se fija al compilar) |

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

Lo comprueba `tests/e2e/specs/r1.spec.ts`:

- Dos IP de cliente distintas (`127.0.0.2` y `127.0.0.3`) que pasan por el panel no comparten el bloqueo.
- Rotar `X-Forwarded-For` no evita el bloqueo.
- Decir que se viene de la IP bloqueada no bloquea a otro.
- La cadena con un balanceador simulado (`PANEL_TRUST_PROXY=10.0.0.0/8`) devuelve la IP correcta.

## Otras variables

Están en `.env.example`. En producción la API se niega a arrancar si `AUTH_BASE_URL` o `ALLOWED_ORIGINS` no son `https://`, para que las cookies sean `Secure`. `MAIL_OUTBOX_FILE` solo se usa fuera de producción, para que las pruebas E2E lean los emails.
