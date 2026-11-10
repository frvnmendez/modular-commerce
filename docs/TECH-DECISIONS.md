# Decisiones técnicas (índice de ADRs)

| ADR | Decisión | Estado |
|---|---|---|
| [0001](decisions/ADR-0001-motor-comercial.md) | Núcleo comercial propio en TypeScript; Vendure/Medusa descartados como plano de datos | Aceptado (2026-11-09) |
| [0002](decisions/ADR-0002-aislamiento-multitenant.md) | BD compartida + RLS forzado + FKs compuestas, organizada en celdas | Aceptado (2026-11-08) |
| [0003](decisions/ADR-0003-modulos-fuera-de-proceso.md) | Módulos fuera de proceso, manifiesto Zod, webhooks firmados, tokens por instalación | Aceptado (2026-11-08) |
| [0004](decisions/ADR-0004-stack-base.md) | pnpm + Turborepo, Fastify, Next.js 16, Drizzle, pg-boss, Better Auth, Zod; sin Redis en MVP | Aceptado (2026-11-08) con desviación: R1 usa `pg` + SQL propio en lugar de Drizzle, y no hay pg-boss ni worker todavía |
| [0005](decisions/ADR-0005-editor-visual.md) | Puck con lista blanca de bloques validados en servidor | Aceptado (2026-11-08) |

Investigación de soporte: [`research/motores-comerciales.md`](research/motores-comerciales.md), [`research/herramientas-y-editores.md`](research/herramientas-y-editores.md).

Nota: ADR-0002 y ARCHITECTURE describen el contexto de tenant con `set_config`/GUC; el código usa `control.request_context` + token de sesión (migración 0006). Pendiente enmendarlos o sustituirlos por un ADR-0006.
