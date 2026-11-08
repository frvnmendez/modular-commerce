# Investigación Release 0: herramientas de análisis, editor visual y stack base

- **Fecha de verificación:** 2026-11-08. Todas las URLs citadas se consultaron ese día (WebFetch, WebSearch o `curl` al registro npm/PyPI).
- **Método:** las páginas de GitHub se leyeron con WebFetch. El acceso por API a GitHub está bloqueado y las páginas `/commits` devuelven `robots_disallowed`, así que **no se pudieron verificar las fechas del último commit** de los repos de GitHub. Las versiones y fechas salen de `https://registry.npmjs.org/<pkg>` (campos `dist-tags` y `time`) o de PyPI.
- **Regla:** todo lo que no se verificó aparece como **"no verificado"**. Las opiniones y recomendaciones se marcan como **(criterio)**.

---

## Parte A: herramientas de ingeniería inversa funcional y estudio de UX

### A.1 Verificación repo por repo

| Repo | ¿Existe? | Qué hace (según su README) | Licencia | Señales de mantenimiento | Valoración (criterio) |
|---|---|---|---|---|---|
| [greekr4/rever-browser](https://github.com/greekr4/rever-browser) | Sí | "AI agent browser for web reverse engineering". App Electron con un Chromium real y un agente IA (Claude Code por defecto). Captura tráfico por CDP y expone 156 herramientas MCP para analizar JS/WASM, reproducir y **manipular peticiones**, hacer sondeos de seguridad y un "Red Team mode" ofensivo | MIT | 51 estrellas, 394 commits. Releases recientes: v0.2.4 el "05 Nov" ([releases](https://github.com/greekr4/rever-browser/releases)); la página no muestra el año. Fecha del último commit: no verificada | Activo pero muy joven y orientado a *pentesting* y manipulación de tráfico. **No usar** contra plataformas de terceros: choca con los ToS (ver A.3) |
| [sumanrox/mimic](https://github.com/sumanrox/mimic) | Sí | Skill de Claude Code para "reverse-engineer and rebuild any website… to pixel fidelity". Mide la web de referencia y la reconstruye. Dice que respeta auth, CAPTCHA y paywalls | MIT | 1 estrella, 8 commits, sin releases. Fecha del último commit: no verificada | **Proyecto personal sin tracción, posible abandono.** Su objetivo (clonar al píxel) es justo lo que **no** queremos: copiar UI protegida |
| [jongko54/webEmbedding](https://github.com/jongko54/webEmbedding) | Sí | "Source-first website cloning engine for AI agents": captura con Playwright, reproduce HAR, se autoverifica y ofrece MCP. No cubre apps que exigen login | MIT | 4 estrellas, 88 commits. Paquete npm `web-embedding` 0.3.12, publicado el 2026-10-28 ([npm](https://registry.npmjs.org/web-embedding)) | Clonador de sitios, de nicho y con muy poca adopción. **Descartar** (mismo problema de copia) |
| [mikulgohil/Morph](https://github.com/mikulgohil/Morph) | Sí | "Clone any website into a clean, production-ready Next.js + Tailwind CSS codebase" (CLI `npx morph clone`) | MIT | **1 commit**, 1 estrella, sin releases | **Parece abandonado o un experimento de un solo commit.** Descartar |
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | Sí | Librería Python para que un LLM controle un navegador (local o en la nube) | MIT | ~120k estrellas. PyPI `browser-use` 0.13.14, subido el 2026-10-26 ([PyPI](https://pypi.org/pypi/browser-use/json)) | Madura y mantenida. Útil para **probar nuestra propia app**. Contra Shopify, el ToS §1.9 prohíbe el acceso automatizado |
| [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code) | Sí | Convierte capturas, mockups o vídeos en código (HTML/Tailwind/React/Vue) con LLMs | MIT | ~80.8k estrellas, 1.457 commits. Fecha del último commit: no verificada | Popular. Riesgo: reproduce la UI tal cual. Usarlo solo con **nuestros propios** wireframes o diseños |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Sí | Automatización y testing E2E: codegen, trace viewer, capturas y vídeo | Apache-2.0 | ~98.8k estrellas. npm `playwright` 1.65.0, publicado el 2026-11-05 ([npm](https://registry.npmjs.org/playwright)) | Estándar de facto. **Sí lo usaremos**, para E2E de nuestra plataforma |

Capacidades de Playwright verificadas en [playwright.dev/docs/mock](https://playwright.dev/docs/mock):
- Grabar HAR con `npx playwright open --save-har=example.har --save-har-glob="**/api/**" <url>`.
- Reproducir HAR con `routeFromHAR` (con `update: true` graba, sin él reproduce).

### A.2 Alternativas mejores (criterio)

Para **estudiar flujos observables** (qué pasos tiene un checkout, qué estados tiene un pedido, qué opciones de configuración existen) hace falta **documentación y observación manual**. Las herramientas de clonado no sirven para eso.

1. **Documentación pública oficial** (shopify.dev, centro de ayuda, changelogs). Es la fuente de mayor valor y riesgo legal nulo. Describe modelos de datos y flujos sin tocar la UI de nadie.
2. **Cuenta autorizada (trial o dev store) + observación manual** registrada en una plantilla propia: pasos, estados, validaciones y mensajes **parafraseados**. Capturas solo para uso interno de referencia.
3. **APIs oficiales del proveedor** con credenciales de la propia cuenta, dentro de sus API Terms ([shopify.com/legal/api-terms](https://www.shopify.com/legal/api-terms), enlazados desde los ToS; contenido no leído, **no verificado**). Sirven para entender entidades y relaciones del dominio (producto, variante, pedido, fulfillment).
4. **Playwright + trace viewer sobre NUESTRA app**, para validar que nuestros flujos cubren los casos inventariados.

### A.3 Advertencias legales y de ToS (breve)

Cláusulas de los [Términos de Servicio de Shopify](https://www.shopify.com/legal/terms) (consultados el 2026-11-08):
- **§1.7:** prohíbe "reproduce, duplicate, copy, sell, resell or exploit any portion of the Service" sin permiso escrito.
- **§1.8:** prohíbe "decompile, disassemble or otherwise reverse engineer the Services" y eludir limitaciones técnicas.
- **§1.9:** prohíbe acceder o monitorizar los Servicios "using any robot, spider, scraper, or other automated means".

Por tanto, **browser-use, rever-browser, Playwright, mimic, Morph o webEmbedding contra el admin o los storefronts de Shopify incumplirían los ToS**, aunque se usen con una cuenta autorizada. Además, copiar la UI (layout, textos, iconos, marcas) puede infringir derechos de autor, *trade dress* y marcas (§8.2 sobre marcas confusas).

Esto no es asesoramiento legal. Recomendamos una revisión legal antes de cualquier actividad de *benchmarking*.

### A.4 Conclusión Parte A

- **Usar:** Playwright (Apache-2.0) **solo para nuestra app** (E2E, trazas, HAR de nuestras APIs). browser-use es opcional, para pruebas exploratorias con IA **sobre nuestro entorno**.
- **Para estudiar Shopify y similares:** documentación oficial + observación **manual** con cuenta autorizada + APIs oficiales. Se documentan **comportamientos y requisitos**, nunca UI.
- **No usar:** rever-browser, mimic, Morph y webEmbedding. Están orientados a clonar o manipular tráfico; tres de ellos tienen tracción mínima y Morph tiene un solo commit.

---

## Parte B: base del editor visual de páginas del storefront

### B.1 Comparativa

| Criterio | **Puck** | **Craft.js** | **GrapesJS** | **Builder.io** | **Plasmic** | **Easyblocks** |
|---|---|---|---|---|---|---|
| Paquete actual | `@puckeditor/core`. **`@measured/puck` está deprecado**: "Puck has moved. Please use @puckeditor/core" ([npm](https://registry.npmjs.org/@measured/puck)) | `@craftjs/core` | `grapesjs` (+ `@grapesjs/react`) | `@builder.io/sdk-react` / `@builder.io/react` | `@plasmicapp/loader-nextjs` | `@easyblocks/core` |
| Licencia | MIT ([repo](https://github.com/puckeditor/puck), [npm](https://registry.npmjs.org/@puckeditor/core)) | MIT ([repo](https://github.com/prevwong/craft.js)) | BSD-3-Clause ([repo](https://github.com/GrapesJS/grapesjs), [npm](https://registry.npmjs.org/grapesjs)) | Repo MIT ([repo](https://github.com/BuilderIO/builder)). `@builder.io/sdk-react` no declara licencia en npm. El editor parece SaaS (**no verificado**) | MIT fuera de `platform/`, **AGPL en `platform/`** (el Studio) ([repo](https://github.com/plasmicapp/plasmic)) | **AGPL-3.0** en el repo ([repo](https://github.com/easyblockshq/easyblocks)), pero npm dice ISC: **contradicción** |
| Última versión estable | 0.24.0 (2026-10-29); canary 2026-11-06 | 0.2.12 (**2025-02-14**); `next` = 0.3.0-alpha.4 de 2022 | 0.23.9 (2026-11-03) | react 9.4.11 (2026-11-05); sdk-react 5.4.2 (2026-10-20) | 2.0.30 (2026-10-26) | 1.0.10 (**2024-07-24**) |
| Estrellas | ~13.6k | ~8.7k (211 issues abiertos) | ~26.4k | ~8.8k | ~7k | 579 |
| Mantenimiento (criterio) | Activo | **Bajo:** ~21 meses sin release | Activo | Activo, comercial | Activo, comercial | **Parece estancado:** >2 años sin publicar en npm |
| Encaje React/Next.js | Nativo React; RSC soportado (ver abajo) | Nativo React | **No es React**: componentes HTML/DOM, React solo como wrapper | SDK React/Next; contenido en su nube | Loader Next.js; Studio alojado o self-host AGPL | React |
| Modelo de datos | JSON `{ content: [{type, props}], root: {props} }`. Los slots anidan arrays dentro de `props` ([slot docs](https://puckeditor.com/docs/api-reference/fields/slot.md)). Incluye `migrate()` para actualizar datos antiguos ([docs](https://puckeditor.com/docs/api-reference/functions/migrate)) | Nodos serializables a JSON (`query.serialize()`, `actions.deserialize`) ([docs](https://craft.js.org/docs/api/useEditor)) | Project data + HTML/CSS (detalle de `getProjectData`: **no verificado**) | JSON en su CMS (no verificado) | Proyecto en Studio (no verificado) | no verificado |
| ¿Validable con esquema? | Sí, en la práctica (criterio): forma `{type, props}` simple, validable por bloque con Zod | Sí, pero el formato es un mapa de nodos internos, menos ergonómico (criterio) | Más difícil: mezcla estilos CSS y estructura (criterio) | n/a (lo gestiona el SaaS) | n/a | n/a |
| Undo/redo | Sí: `history.back()/forward()`, `initialHistory` ([API](https://puckeditor.com/docs/api-reference/puck-api), [Puck](https://puckeditor.com/docs/api-reference/components/puck)) | Sí: `actions.history.undo()/redo()` ([docs](https://craft.js.org/docs/api/useEditor)) | UndoManager listado en la documentación; detalle no verificado | no verificado | no verificado | no verificado |
| Responsive | `viewports` (preview en iframe) ([docs](https://puckeditor.com/docs/api-reference/components/puck)) | Lo implementas tú (no verificado) | DeviceManager ([docs](https://grapesjs.com/docs/api/device_manager.html)) | no verificado | no verificado | no verificado |
| Lista blanca de componentes | Sí. Solo existen los componentes del `config`. Además, `allow`/`disallow` por slot ([docs](https://puckeditor.com/docs/api-reference/fields/slot.md)) y `permissions` globales, por componente o dinámicos ([blog 0.16](https://puckeditor.com/blog/puck-016)) | Por `resolver` registrado; reglas de drop parciales (`canDropInParent`) | Block Manager configurable (detalle no verificado) | Registro de componentes propios (no verificado) | `registerComponent` ([repo](https://github.com/plasmicapp/plasmic)) | no verificado |
| SSR de datos guardados | Sí: `<Render>` y `resolveAllData` funcionan en RSC si el config es server-friendly ([docs RSC](https://next.puckeditor.com/docs/integrating-puck/server-components)) | Renderiza el Frame en React (SSR: no verificado) | Exporta HTML/CSS estático (criterio) | Vía SDK / fetch a su API | Vía loader | no verificado |

### B.2 Modelo de seguridad para bloques de terceros (criterio, requisito de diseño)

Requisito: los módulos de terceros solo aportan bloques mediante una API restringida y revisada, y no puede ejecutarse JS arbitrario de un tenant en el contexto privilegiado de otro. Con Puck lo proponemos así:

1. **Registro estático de bloques.** El `config` de Puck se construye **en build time** a partir de un registro de bloques que vienen de módulos **revisados y versionados**. Nunca se carga código de bloque en runtime desde la base de datos ni desde un tenant.
2. **Manifiesto de bloque.** Cada bloque declara un esquema de props (Zod), sus campos de editor (solo tipos de campo nativos de Puck por defecto) y su componente de render. Los *custom fields* y *overrides*/*plugins* de Puck (marcados como "Experimental" en la [documentación](https://puckeditor.com/docs/api-reference/components/puck)) ejecutan React arbitrario en el admin, así que **solo se permiten a módulos de primera parte**.
3. **Validación en el servidor al guardar y al publicar.** Recorremos el árbol `{type, props}`. Se rechaza todo `type` que no esté en la lista blanca habilitada para ese tenant/plan y se valida `props` con el esquema del bloque. Así un payload manipulado no puede inyectar componentes.
4. **Sin HTML crudo.** No habrá bloque "HTML/script libre" en R0. El richtext se sanea.
5. **Aislamiento.** El editor corre en la app de admin (origen distinto al storefront). El storefront renderiza en servidor con `<Render>` y un config de servidor separado. La documentación RSC de Puck recomienda configs separados para editor y servidor ([docs](https://next.puckeditor.com/docs/integrating-puck/server-components)).
6. **Versionado de datos.** Guardamos `schemaVersion` por página y por bloque, y usamos `migrate()` de Puck más migraciones propias por bloque.

### B.3 Recomendación Parte B

**Puck (`@puckeditor/core`, MIT, 0.24.0 del 2026-10-29).** Motivos:
- Es React nativo con soporte RSC para `<Render>`.
- Su JSON `{type, props}` es simple y validable con Zod.
- Trae undo/redo, viewports, permisos y `allow`/`disallow` por slot.
- Está activamente mantenido.

Riesgos (criterio):
- Sigue en 0.x: habrá cambios incompatibles, así que fijaremos la versión y usaremos `migrate()`.
- Plugins y overrides son experimentales.
- Existe "Puck AI" (aparece en la documentación), pero no lo evaluamos.

Descartes:
- **Craft.js:** sin release desde febrero de 2025.
- **GrapesJS:** no es React; está pensado para HTML/CSS y newsletters.
- **Builder.io:** SaaS, crea dependencia de un proveedor.
- **Plasmic:** el Studio es AGPL o SaaS.
- **Easyblocks:** AGPL según el repo y sin publicaciones desde 2024.

---

## Parte C: notas verificadas del stack

Versiones y fechas tomadas de `https://registry.npmjs.org/<paquete>` el 2026-11-08, salvo que se indique otra fuente.

### C.1 Framework

| Paquete | Versión `latest` | Fecha | Licencia |
|---|---|---|---|
| `next` | **16.4.5** | 2026-11-03 | MIT |

Recomendación: Next.js 16.x (App Router), con la versión menor fijada.

### C.2 Autenticación

| Opción | Versión | Fecha | Licencia | Estado verificado | Encaje multi-tenant (criterio) |
|---|---|---|---|---|---|
| **Better Auth** | 1.7.18 | 2026-11-05 | MIT | Activo. Se unió a Vercel el 2026-07-07 ([blog](https://better-auth.com/blog/better-auth-joins-vercel)). Plugin de **organizaciones** con miembros, roles, invitaciones, equipos y control de acceso dinámico ([docs](https://www.better-auth.com/docs/plugins/organization)) | Alto: self-hosted, datos en nuestra Postgres |
| Auth.js / `next-auth` | 4.24.15 (`@auth/core` 0.41.3) | 2026-07-20 | ISC | Mantenido por el equipo de Better Auth desde 2025-09-22, solo con parches de seguridad y urgentes. "we strongly recommend new projects to start with Better Auth" ([blog](https://www.better-auth.com/blog/authjs-joins-better-auth)) | No para proyectos nuevos |
| Lucia | 3.2.2 | 2024-10-20 | MIT | **Deprecado.** npm: "This package has been deprecated". Su web: "Lucia was deprecated in March 2025" ([lucia-auth.com](https://lucia-auth.com/), [migrate](https://lucia-auth.com/lucia-v3/migrate)). Hoy es un recurso de aprendizaje | Descartado |
| Clerk | `@clerk/nextjs` 7.9.25 | 2026-11-05 | MIT (SDK) | SDK activo. Precios y funciones de organizaciones: no verificados | SaaS: rápido, pero coste por MAU y datos fuera |
| WorkOS | `@workos-inc/authkit-nextjs` 4.6.3; `@workos-inc/node` 12.2.0 | 2026-11-05 | MIT (SDK) | SDK activo. Precios: no verificados | Bueno para SSO/SCIM enterprise B2B (criterio); plantear como añadido futuro |

Recomendación: **Better Auth** con el plugin de organizaciones. WorkOS queda como opción para SSO enterprise más adelante.

### C.3 Colas y jobs

| Opción | Versión | Fecha | Licencia | Backend (verificado) | Notas |
|---|---|---|---|---|---|
| **pg-boss** | 12.38.1 | 2026-11-05 | MIT | Postgres con `SKIP LOCKED`. Cron/RRULE, reintentos con backoff, prioridades y dead letter con redrive ([repo](https://github.com/timgit/pg-boss), ~4.1k estrellas) | Sin infraestructura extra; los jobs pueden encolarse en la misma transacción que los datos (criterio) |
| Graphile Worker | 0.18.0 | 2026-09-08 | MIT | Postgres; admite jobs creados desde triggers y funciones SQL ([repo](https://github.com/graphile/worker), ~2.4k estrellas) | Muy buen rendimiento. Detalle de LISTEN/NOTIFY y cron: no verificado en la página |
| BullMQ | 6.7.2 | 2026-11-07 | MIT | Redis (y Valkey). Flows, rate limiting, deduplicación. Agrupación y lotes solo en **BullMQ Pro** de pago ([repo](https://github.com/taskforcesh/bullmq), ~9.4k estrellas) | Requiere Redis. El *fairness* por tenant (grupos) es de pago |

Recomendación: **pg-boss** para R0 (una sola dependencia: Postgres). Hay que revisar BullMQ si el volumen lo exige.

### C.4 ORM y acceso a datos (con atención a RLS en Postgres)

| Opción | Versión | Fecha | Licencia | RLS (verificado) |
|---|---|---|---|---|
| **Drizzle ORM** | 0.45.4 estable; hay tags `1.0.0-beta.*` | 2026-10-08 | Apache-2.0 | Nativo: `pgPolicy`, `pgRole`, `.withRLS()`, y drizzle-kit gestiona las policies ([docs](https://orm.drizzle.team/docs/rls)) |
| Prisma | `@prisma/client` **7.10.1** (2026-10-15). Ojo: el paquete `prisma` tiene `latest` = **8.0.0-rc.33** (2026-11-06), un RC etiquetado como latest | — | Apache-2.0 | Prisma ORM 8 declara RLS con `@@rls` y policies en `contract.prisma`. No crea roles, `FORCE ROW LEVEL SECURITY` va por SQL aparte, y el contexto se fija con `set_config` por transacción ([docs](https://www.prisma.io/docs/orm/contract-authoring/advanced-postgresql)). Es la versión 8, todavía en RC |
| Kysely | 0.29.8 | 2026-11-01 | MIT | Sin soporte declarativo verificado. Las policies irían en migraciones SQL y `set_config` en la transacción (criterio) |

Recomendación (criterio): **Drizzle**. Tiene RLS declarativo verificado, es SQL-first y ligero. El patrón para todas las opciones: `SET LOCAL app.tenant_id` / `set_config(..., true)` dentro de cada transacción, un rol de aplicación **no propietario** de las tablas y `FORCE ROW LEVEL SECURITY`.

### C.5 Validación de manifiestos

| Opción | Versión | Fecha | Licencia | JSON Schema (verificado) |
|---|---|---|---|---|
| **Zod** | 4.6.7 | 2026-10-12 | MIT | `z.toJSONSchema()` nativo. `z.fromJSONSchema()` es experimental ([zod.dev](https://zod.dev/json-schema)) |
| Valibot | 1.5.0 | 2026-09-09 | MIT | Paquete aparte `@valibot/to-json-schema` con `toJsonSchema` ([valibot.dev](https://valibot.dev/guides/json-schema/)) |

Recomendación: **Zod 4** para manifiestos de módulo y esquemas de props de bloques. Es el estándar del ecosistema y exporta JSON Schema de forma nativa, útil para publicar el contrato del manifiesto a terceros. Valibot solo compensaría si el tamaño del bundle en cliente fuera crítico (criterio).

---

## Resumen de decisiones propuestas

| Tema | Decisión R0 |
|---|---|
| Estudio de flujos de terceros | Manual + documentación y APIs oficiales; sin automatización contra Shopify (ToS §1.7–1.9) |
| Testing E2E propio | Playwright 1.65 |
| Editor visual | Puck (`@puckeditor/core` 0.24) con registro de bloques estático y validación de servidor |
| Auth | Better Auth 1.7 + plugin de organizaciones |
| Colas | pg-boss 12 |
| ORM | Drizzle 0.45 + RLS |
| Validación | Zod 4 |
| Framework | Next.js 16.4 |

## Pendiente / no verificado

- Fechas del último commit de los repos de GitHub (la API y `/commits` estaban bloqueados).
- Contenido de los Shopify API Terms.
- Precios de Clerk y WorkOS.
- `getProjectData` y UndoManager de GrapesJS en detalle.
- SSR de Craft.js.
- Modelo de datos de Builder.io y Plasmic.
