# Modular Commerce (nombre provisional)

Plataforma SaaS de comercio electrónico multi-tenant, modular y asistida por IA.

**Estado:** Release 1 (cuentas, tiendas, roles y panel del comerciante) **probado localmente**. No hay nada desplegado. Release 0 (investigación, PoCs y ADRs) está en `docs/` y `poc/`.

- Plan y decisiones: [`docs/MASTER-PLAN.md`](docs/MASTER-PLAN.md), [`docs/TECH-DECISIONS.md`](docs/TECH-DECISIONS.md), [`docs/decisions/`](docs/decisions/)
- Aislamiento entre tiendas: [`docs/TENANT-ISOLATION.md`](docs/TENANT-ISOLATION.md)
- Esquema y API reales: [`docs/DATABASE-SCHEMA.md`](docs/DATABASE-SCHEMA.md), [`docs/API-CONTRACTS.md`](docs/API-CONTRACTS.md)
- Evidencia: [`docs/release-0/VERIFICATION-REPORT.md`](docs/release-0/VERIFICATION-REPORT.md), [`docs/release-1/VERIFICATION-REPORT.md`](docs/release-1/VERIFICATION-REPORT.md)

## Estructura

| Ruta | Qué es |
|---|---|
| `packages/db` | Roles de PostgreSQL, migraciones SQL con RLS, `withStore`/`withUser` (único sitio donde se fija el contexto de tenant) |
| `packages/auth` | Identidad con Better Auth (email + contraseña, verificación obligatoria) |
| `packages/core` | Permisos por rol, onboarding → capacidades, navegación |
| `apps/commerce-api` | API Fastify (`/v1/*`, `/api/auth/*`) |
| `apps/merchant-admin` | Panel del comerciante (Next.js) |
| `tests/isolation` | Ataques entre tiendas sobre una BD desechable, con controles negativos |
| `tests/e2e` | Prueba de humo en navegador (fuera de CI) |
| `poc/` | PoCs de Release 0 |

## Arrancar en local

Requisitos: Node 22, pnpm 10, PostgreSQL 16 con un superusuario para el bootstrap.

```bash
cp .env.example .env            # contraseñas de desarrollo; cambia AUTH_SECRET
pnpm install
set -a; . ./.env; set +a
pnpm db:bootstrap && pnpm db:migrate   # crea roles y BD, aplica migraciones
node apps/commerce-api/src/server.ts          # API en :4000 (los emails de verificación se imprimen en el log)
pnpm --filter @mc/merchant-admin build && pnpm --filter @mc/merchant-admin start   # panel en :3000
```

Abre http://localhost:3000 (usa `localhost`, no `127.0.0.1`: el Origin debe estar en `ALLOWED_ORIGINS`).

## Pruebas

```bash
pnpm lint && pnpm typecheck
AUTH_RATE_LIMIT=off pnpm test                  # core + API
pnpm test:isolation                            # aislamiento (BD desechable)
ISOLATION_SABOTAGE=rls-off pnpm test:isolation # debe FALLAR (también permissive y membership)
```
