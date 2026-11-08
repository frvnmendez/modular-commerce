# Decisiones técnicas (índice de ADRs)

| ADR | Decisión | Estado |
|---|---|---|
| [0001](decisions/ADR-0001-motor-comercial.md) | Núcleo comercial propio en TypeScript; Vendure/Medusa descartados como plano de datos | Propuesto |
| [0002](decisions/ADR-0002-aislamiento-multitenant.md) | BD compartida + RLS forzado + FKs compuestas, organizada en celdas | Propuesto |
| [0003](decisions/ADR-0003-modulos-fuera-de-proceso.md) | Módulos fuera de proceso, manifiesto Zod, webhooks firmados, tokens por instalación | Propuesto |
| [0004](decisions/ADR-0004-stack-base.md) | pnpm + Turborepo, Fastify, Next.js 16, Drizzle, pg-boss, Better Auth, Zod; sin Redis en MVP | Propuesto |
| [0005](decisions/ADR-0005-editor-visual.md) | Puck con lista blanca de bloques validados en servidor | Propuesto |

Investigación de soporte: [`research/motores-comerciales.md`](research/motores-comerciales.md), [`research/herramientas-y-editores.md`](research/herramientas-y-editores.md).
