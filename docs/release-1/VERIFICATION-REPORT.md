# Release 1: informe de verificación

- **Fecha:** 2026-11-08
- **Estado:** **Probado localmente**. No hay nada desplegado, ni en staging ni en producción.
- **Gates:** C (aislamiento, base) **superado localmente**; E (seguridad) **sin críticos ni altos abiertos** tras dos pasadas del Red Team.

Este informe solo recoge lo que se ejecutó de verdad. Cada resultado indica el comando, el entorno y dónde está la evidencia.

## 1. Alcance entregado

| Requisito R1 (plan maestro) | Estado | Dónde |
|---|---|---|
| Monorepo, CI | CI de GitHub en verde en `059f25b` (run 42509084197). Tras la revisión del PR (§5b), el CI añade la compilación del panel, el E2E y unos controles negativos más estrictos. Su resultado se anota en la descripción del PR | `package.json`, `turbo.json`, `.github/workflows/ci.yml` |
| Autenticación con verificación de email | Probado localmente | `packages/auth`, `r1-flows.test.ts` |
| Organizaciones y tiendas con provisionamiento transaccional | Probado localmente | `control.create_store`, `r1-flows.test.ts` |
| RBAC owner/admin/staff, invitaciones, último owner | Probado localmente y en E2E | `packages/core/src/rbac.ts`, migraciones 0001/0006–0009 |
| Auditoría por tienda | Probado localmente | `commerce.audit_events` |
| Panel inicial (onboarding → capacidades → navegación) | E2E con Playwright (local y CI) | `apps/merchant-admin`, `tests/e2e`, `screenshots/` |
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

## 3. Resultados (migraciones 0001–0009, tras la revisión del PR #1)

| Comando | Resultado |
|---|---|
| `pnpm lint` | 0 problemas. Incluye la regla que prohíbe fijar el contexto de tenant fuera de `@mc/db` (comprobada con un fichero sonda) |
| `pnpm typecheck` | 7/7 paquetes sin errores |
| `pnpm test` | core 6/6 · commerce-api 30/30 · isolation 20/20 |
| `pnpm test:negative` (`rls-off`) | Detectado: 8 fallan y 12 pasan. Fallan las pruebas previstas de capa de BD y catálogo, sin fallos de infraestructura |
| `pnpm test:negative` (`permissive`) | Detectado: 8 fallan y 12 pasan, por las mismas pruebas previstas |
| `pnpm test:negative` (`membership`) | Detectado: 9 fallan y 11 pasan. Fallan las pruebas HTTP entre tiendas; las de BD fallan en cascada porque los ataques HTTP llegan a tener efecto |
| `pnpm test:e2e` | 11/11 (Playwright, API y panel reales, límite de intentos activado) |
| `rate-limit.test.ts` con la corrección H2 retirada a mano | 1 fallo (esperado). Demuestra que la regresión detecta el fallo |
| `pnpm --filter @mc/merchant-admin build` | Compila |
| `pnpm audit --audit-level=high` | Pasa. 1 vulnerabilidad moderada (`minimatch` vía ESLint, solo en desarrollo) |

La salida de la suite y de los sabotajes está en [`isolation-sabotage.txt`](isolation-sabotage.txt).

Defensa en profundidad comprobada:

- **Sabotaje de RLS:** las pruebas HTTP siguen pasando, porque `enter_store` bloquea el acceso, y las pruebas a nivel de BD detectan el sabotaje.
- **Sabotaje de la pertenencia** (`store_role` devuelve owner para todo): lo detectan las pruebas HTTP.

## 4. Pruebas en navegador (E2E)

Desde la revisión del PR #1: `pnpm test:e2e` (Playwright, `tests/e2e/specs/r1.spec.ts`). Arranca la API y el panel, y falla ante cualquier error no declarado. Escenarios: propietario de principio a fin; invitación sin sesión con cuenta nueva y verificación en otra pestaña; invitación sin sesión con usuario existente; revocación; invitación abierta con otra cuenta; dos invitaciones en pestañas distintas; fallo transitorio al aceptar; vista móvil; límite de intentos a través del panel; cadena de confianza con balanceador; `next start` rechazado en producción. Ver [`PR1-REVIEW.md`](PR1-REVIEW.md).

Antes (histórico, sustituido): `node tests/e2e/smoke.cjs` con la API en :4000 y el panel en :3000. Recorría:

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

## 5b. Revisión del PR #1

Primera revisión (sobre `059f25b`, corregida en `be6af95`): cuatro hallazgos, todos confirmados y corregidos. Segunda revisión (sobre `be6af95`): la identidad en BD ya estaba cubierta; se encontraron y corrigieron tres huecos (arranque con `next start`, dos invitaciones en pestañas, borrado de la invitación guardada ante fallos transitorios). Detalle, reproducción y pruebas en [`PR1-REVIEW.md`](PR1-REVIEW.md).

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

1. ~~Conectar el repositorio y ejecutar el CI en GitHub.~~ Hecho: PR #1, CI en verde.
2. Aprobación del propietario y merge del PR #1.
