# ADR-0005 — Editor visual: Puck con lista blanca de bloques

- Fecha: 2026-11-08 · Estado: **Aceptado** (2026-11-08; se implementa en R5)

## Alternativas (verificadas 2026-11-08)

| Editor | Licencia | Estado | Encaje |
|---|---|---|---|
| **Puck** (`@puckeditor/core` 0.24.0; `@measured/puck` deprecado) | MIT | Activo (2026-10-29) | React/Next, datos JSON `{type, props}`, `migrate()`, undo/redo, viewports, permisos por componente, `allow/disallow` por slot, `<Render>` como Server Component |
| Craft.js | MIT | Última versión 2025-02-14: mantenimiento bajo | React, pero riesgo de abandono |
| GrapesJS | BSD-3 | Activo | No React; produce HTML/CSS, más difícil de restringir |
| Plasmic / Easyblocks | AGPL (Studio) / contradictorio | — | Licencia incompatible o estancado |
| Builder.io | SDK MIT, editor alojado | — | Dependencia de servicio externo |

## Decisión

Puck. Reglas de seguridad:
- La configuración de bloques se genera en build a partir de módulos oficiales/revisados. Sin bloque de HTML libre ni scripts.
- Cada página guardada se valida en servidor con Zod (tipos de bloque conocidos, props válidas) y se versiona (borrador → publicado, historial y rollback).
- Campos personalizados, plugins y overrides de Puck solo en código propio (ejecutan React arbitrario en el admin).
- Configuraciones separadas para editor y renderizado en servidor.
