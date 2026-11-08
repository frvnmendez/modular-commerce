# Changelog

## [R1] 2026-11-08 — Probado localmente
- Monorepo pnpm + Turborepo, TypeScript 5.9 con ejecución nativa de Node 22, ESLint con reglas que prohíben fijar el contexto de tenant fuera de `@mc/db`.
- Base de datos: roles separados (`mc_migrator`, `mc_app`, `mc_auth`, `mc_ops`), esquemas `control`/`commerce`/`auth`, RLS ENABLE+FORCE en toda tabla, funciones `SECURITY DEFINER` con `search_path` fijado, migraciones con checksum.
- Identidad con Better Auth 1.7: registro con verificación de email obligatoria, cookies HttpOnly/SameSite=Lax, límite de intentos.
- API: organizaciones, tiendas con perfil de negocio → capacidades, invitaciones de un solo uso (hash sha256), roles owner/admin/staff, protección del último owner, auditoría, panel de plataforma auditado.
- Panel del comerciante (Next.js 16): acceso, onboarding de 8 preguntas, navegación por capacidades, equipo, actividad, ajustes, aceptación de invitaciones, vista de plataforma.
- Suite de aislamiento entre tiendas sobre BD desechable con 3 controles negativos (rls-off, permissive, membership) que la hacen fallar; CI de GitHub Actions.
- ADR-0002 a ADR-0005 aceptados; ADR-0001 pendiente del spike de 3 días antes de R2.

## [R0] 2026-11-08
- Investigación de motores comerciales, herramientas y editores (fuentes verificadas).
- PoC A: aislamiento PostgreSQL RLS (15 tests + control negativo).
- PoC B: canales de Vendure 3.8.1 (fuga de datos de clientes entre tiendas reproducida).
- PoC C: huella de Medusa 2.18.0.
- PoC D: manifiesto y ciclo de vida de módulos (19 tests).
- ADRs 0001–0005 propuestos, arquitectura, especificación de módulos, riesgos, seguridad, costes, plan maestro.
