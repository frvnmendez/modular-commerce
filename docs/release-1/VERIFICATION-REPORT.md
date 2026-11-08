# Release 1: informe de verificación

- **Fecha:** 2026-11-08
- **Estado:** **Probado localmente**. No hay nada desplegado, ni en staging ni en producción.
- **Gates:** C (aislamiento, base) **superado localmente**; E (seguridad) **sin críticos ni altos abiertos** tras dos pasadas del Red Team.

Este informe solo recoge lo que se ejecutó de verdad. Cada resultado indica el comando, el entorno y dónde está la evidencia.

## 1. Alcance entregado

| Requisito R1 (plan maestro) | Estado | Dónde |
|---|---|---|
| Monorepo, CI | Implementado. CI escrito pero **no ejecutado en GitHub**, porque el repositorio aún no está conectado | `package.json`, `turbo.json`, `.github/workflows/ci.yml` |
| Autenticación con verificación de email | Probado localmente | `packages/auth`, `r1-flows.test.ts` |
| Organizaciones y tiendas con provisionamiento transaccional | Probado localmente | `control.create_store`, `r1-flows.test.ts` |
| RBAC owner/admin/staff, invitaciones, último owner | Probado localmente | `packages/core/src/rbac.ts`, migraciones 0001/0006–0008 |
| Auditoría por tienda | Probado localmente | `commerce.audit_events` |
| Panel inicial (onboarding → capacidades → navegación) | Probado localmente en navegador | `apps/merchant-admin`, `tests/e2e/smoke.cjs`, `screenshots/` |
| Panel de plataforma | Probado localmente. **Desviación:** en R1 es la ruta `/platform` del panel del comerciante y no una app separada. Se separa cuando tenga funciones de escritura | `GET /v1/platform/stores` |
| Suite de aislamiento base con control negativo | Probado localmente | `tests/isolation` |

Fuera de R1, como dice el plan: catálogo, pedidos, pagos, módulos, escaparate y envío real de emails. En R1 los emails se escriben en el log y la invitación muestra un enlace para copiar.

## 2. Entorno

Contenedor Ubuntu 24.04 efímero en la nube con:

- Node v22.23.4
- pnpm 10.28.0
- PostgreSQL 16.15 local
- Chromium y Playwright preinstalados

No hay daemon de Docker. Sin secretos reales: `.env` está en `.gitignore` y solo contiene contraseñas de desarrollo.

## 3. Resultados (migraciones 0001–0008)

| Comando | Resultado |
|---|---|
| `pnpm lint` | 0 problemas. Incluye la regla que prohíbe fijar el contexto de tenant fuera de `@mc/db` (comprobada con un fichero sonda) |
| `pnpm typecheck` | 6/6 paquetes sin errores |
| `pnpm test` | core 6/6 · commerce-api 29/29 · isolation 17/17 |
| `pnpm test:isolation` con `ISOLATION_SABOTAGE=rls-off` | **7 fallos** (esperado) |
| `pnpm test:isolation` con `ISOLATION_SABOTAGE=permissive` | **7 fallos** (esperado) |
| `pnpm test:isolation` con `ISOLATION_SABOTAGE=membership` | **7 fallos** (esperado) |
| `rate-limit.test.ts` con la corrección H2 retirada a mano | 1 fallo (esperado). Demuestra que la regresión detecta el fallo |
| `next build` del panel | Compila las 11 rutas |
| `pnpm audit --audit-level=high` | Pasa. 1 vulnerabilidad moderada (`minimatch` vía ESLint, solo en desarrollo) |

La salida de la suite y de los sabotajes está en [`isolation-sabotage.txt`](isolation-sabotage.txt).

Defensa en profundidad comprobada:

- **Sabotaje de RLS:** las pruebas HTTP siguen pasando, porque `enter_store` bloquea el acceso, y las pruebas a nivel de BD detectan el sabotaje.
- **Sabotaje de la pertenencia** (`store_role` devuelve owner para todo): lo detectan las pruebas HTTP.

## 4. Prueba en navegador (E2E de humo)

`node tests/e2e/smoke.cjs` con la API en :4000 y el panel en :3000. Recorre:

1. Registro.
2. Verificación de email con el enlace del log.
3. Onboarding y módulos recomendados.
4. Panel.
5. Invitar y revocar una invitación.
6. Actividad.
7. Vista móvil a 390 px, sin scroll horizontal.
8. El invitado se registra, acepta y solo ve las secciones de staff.

Resultado: completo. El único error de consola es el 401 esperado de `/v1/me` antes de iniciar sesión. Las capturas están en [`screenshots/`](screenshots/).

Esta prueba encontró y corrigió tres defectos:

- Los enlaces de verificación apuntaban a la API y no al panel.
- El patrón HTML del slug era inválido en el modo `v` de las expresiones regulares.
- Se ofrecía "Quitar" al último owner.

## 5. Revisión independiente

Ver [`RED-TEAM.md`](RED-TEAM.md).

- **Primera pasada: NO-GO.** Dos hallazgos altos: el contexto de BD se podía forjar y el límite de intentos se esquivaba. Hubo además tres medios y varios bajos.
- **Corrección:** todos se corrigieron con pruebas de regresión.
- **Segunda pasada: GO con condiciones.** Dos hallazgos nuevos (N1 rendimiento de RLS, N2 invitación que revive) quedaron corregidos. N3 y N4 se aceptan como bajos para R2.

## 6. Decisiones y desviaciones registradas

- ADR-0002 a ADR-0005 **aceptados** el 2026-11-08 por decisión del propietario. ADR-0001 (motor comercial) sigue pendiente del spike de 3 días, **antes de R2**.
- **Mecanismo de contexto de tenant.** Cambia respecto a ADR-0002 y a la PoC A: ya no usa GUCs sino `control.request_context` validado por token de sesión (RT-R1 H1). `TENANT-ISOLATION.md` está actualizado.
- **Acceso a datos.** No se usa Drizzle (ADR-0004): en R1 basta con SQL propio en `@mc/db`. Se revisará en R2, cuando entre el catálogo.

## 7. Pendiente para cerrar R1 fuera de este entorno

1. Conectar el repositorio de GitHub, subir el código y **ejecutar el CI en GitHub**. Hasta entonces, el CI está escrito pero no validado.
2. Aprobación del propietario.
