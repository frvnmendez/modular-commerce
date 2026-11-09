# ADR-0004 — Stack base y herramientas

- Fecha: 2026-11-08 · Estado: **Aceptado** (2026-11-08, decisión del propietario: "R1 ya, motor tras 3 días de prueba") · Fuente: `docs/research/herramientas-y-editores.md` (versiones verificadas en npm el 2026-11-08)

| Tema | Decisión | Alternativas descartadas y motivo |
|---|---|---|
| Lenguaje | TypeScript estricto en todo | — |
| Monorepo | pnpm workspaces + Turborepo | Nx (más pesado); npm workspaces (peor rendimiento) |
| Gestor de paquetes | pnpm 10 (ya instalado en el entorno) | — |
| Arquitectura | Monolito modular: `commerce-api` (Fastify) + `worker` + apps Next.js | Microservicios: sobreingeniería para el tamaño actual |
| Interfaces | Next.js 16.x (16.4.5 verificado), React, Tailwind | — |
| ORM / migraciones | **Drizzle** 0.45.x (soporte nativo de políticas RLS) + migraciones SQL versionadas y revisadas | Prisma 7/8 (RLS parcial, FORCE manual), Kysely (sin migraciones declarativas) |
| Validación | **Zod 4** (`z.toJSONSchema` nativo) | Valibot (necesita paquete extra) |
| Base de datos | PostgreSQL 16+ | — |
| Colas | **pg-boss** (sobre PostgreSQL, transaccional con los datos, cron, reintentos, DLQ) | BullMQ (añade Redis; grupos por tenant solo en versión Pro de pago); Graphile Worker (válido, menor ecosistema) |
| Redis | **No en MVP**. Se añadirá solo si la caché o rate-limit lo requieren con mediciones | — |
| Autenticación | **Better Auth** (MIT, plugin de organizaciones/roles/invitaciones) | Lucia (deprecado mar-2025), Auth.js (solo parches de seguridad), Clerk/WorkOS (coste por usuario; WorkOS como opción SSO Enterprise futura) |
| Pagos comerciantes | Stripe Connect en sandbox, a validar en R4 (responsabilidades, KYC, países) | Alternativas regionales evaluadas en R4 |
| Facturación SaaS | Stripe Billing (sistema separado del de pagos de tiendas) | — |
| Almacenamiento | S3-compatible (MinIO en local) con prefijo por tenant | — |
| Editor visual | Ver ADR-0005 (Puck) | — |
| Tests | Vitest (unit/integración), Playwright (E2E), suite de aislamiento propia | — |
| Observabilidad | Logs JSON (pino) con `tenant_id`, OpenTelemetry; Sentry a decidir por coste en R8 | — |
| Dominios / TLS / CDN | Decisión diferida a R5 con comparación de coste (Caddy on-demand TLS vs. proveedor gestionado tipo Cloudflare for SaaS) | — |
| Infraestructura cloud | Diferida a antes de staging; no se crea nada externo sin aprobación | — |
| Feature flags | Tabla propia en el plano de control (por tenant y plan) en MVP | Servicio externo: innecesario aún |
| Secretos | Variables de entorno en local; en servidores, gestor del proveedor cloud. Secretos de tenants/módulos cifrados con envelope encryption (clave maestra fuera de la BD) | — |

Herramientas de "ingeniería inversa" del directive: **no se adoptan**. Los términos de Shopify (§1.7–1.9) prohíben copiar el servicio, la ingeniería inversa y el acceso automatizado. El estudio funcional se hará con documentación pública, APIs oficiales y observación manual con cuenta autorizada, documentando comportamientos, no interfaces. Playwright se usará solo contra nuestro propio producto.
