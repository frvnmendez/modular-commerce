# Plan maestro

Estado actual (2026-11-10): **R0 y R1 fusionados en `main`. ADR-0001 aceptado (núcleo propio). R2 CONGELADO** por decisión del propietario hasta validar la demanda.

## Validación antes de R2 (en curso desde 2026-11-10)

Motivo: un análisis independiente (técnica, seguridad, mercado, finanzas, equipo rojo y azul) concluyó que la ingeniería es sólida pero no hay evidencia de que alguien vaya a pagar (0 entrevistas, sin precios). El Gate G se adelanta antes de R2.

| Campo | Valor |
|---|---|
| Duración | 4–6 semanas (hasta 2026-12-15) |
| Presupuesto | ≤ 20 h y ≤ 300 € |
| Experimento | 15 entrevistas; landing con precio y lista de espera; plaza piloto reembolsable de 49 €; contacto con 3 agencias |
| Seguir con R2 si | ≥ 5 compromisos con dinero (prepago o depósito), o ≥ 3 cartas de intención B2B de ≥ 49 €/mes |
| Archivar si | < 5 compromisos con dinero el 2026-12-15 |
| Mientras tanto | Solo higiene de documentación y arreglos de seguridad baratos; nada de código de R2 |

Si R2 se descongela, su alcance recortado (R2a/R2b/R2c, 250–420 h) está en la revisión de ADR-0001.

## Histórico: decisiones previas a R1 (todas resueltas)

1. ADR-0001: núcleo comercial propio (no Vendure ni Medusa como plano de datos). **Propuesta revisada tras el Red Team:** empezar R1 (independiente del motor) y cerrar este ADR antes de R2 tras un spike de 3 días.
2. ADR-0002: BD compartida con RLS forzado, organizada en celdas.
3. ADR-0003: módulos fuera de proceso; oficiales en el monorepo usando el mismo SDK.
4. ADR-0004: stack (pnpm+Turborepo, Fastify, Next.js, Drizzle, pg-boss, Better Auth, Zod, sin Redis en MVP).
5. Nicho de entrada (PRODUCT-ROADMAP): hipótesis a validar con entrevistas.
6. Repositorio GitHub del proyecto: creado (github.com/frvnmendez/modular-commerce).

## Gates

| Gate | Condición | Release donde se evalúa |
|---|---|---|
| A Viabilidad | PoCs + decisiones aprobadas | R0 (ahora) |
| B Arquitectura | Contratos de API/eventos/manifiesto publicados antes de construir módulos | R3 |
| C Aislamiento | Suite de aislamiento completa en verde + control negativo | R1 (base), R2 (completa) |
| D Integridad comercial | Cálculos, estados, idempotencia y pagos sandbox validados | R2/R4 |
| E Seguridad | Sin vulnerabilidades críticas/altas abiertas | Cada release |
| F Resiliencia | Backup restaurado, monitorización, runbook de incidentes | R8 |
| G Comercial | Evidencia de uso, retención y pago | R9 |

## Releases

| Release | Alcance | Depende de |
|---|---|---|
| R1 Núcleo SaaS | Monorepo, CI, auth, organizaciones, tiendas, provisionamiento, RBAC, panel inicial, suite de aislamiento base | Aprobación R0 + repo |
| R2 Comercio | Catálogo, variantes, inventario, carrito, checkout sandbox, pedidos, clientes | R1 |
| R3 Plataforma modular | Registro, manifiestos, ciclo de vida persistente, permisos, eventos, webhooks, auditoría, SDK + harness | R1, contratos de R2 |
| R4 Módulos oficiales | Pagos Stripe sandbox, adaptador de envío, conector dropshipping | R2, R3 |
| R5 Storefront y editor | Puck, temas, bloques, preview, publicación, dominio propio | R2, R3 |
| R6 Facturación SaaS | Stripe Billing, planes, límites, impagos, cancelación | R1 |
| R7 IA | Asistente de onboarding y contenido con cuotas | R2, R5 |
| R8 Hardening | Seguridad, carga, resiliencia, observabilidad, backups | Todos |
| R9 Piloto | 3–5 comercios reales controlados | R8 + aprobación expresa |

## Release 1 — Criterios de aceptación (fusionado el 2026-11-09)

Estado verificado el 2026-11-10: 9 cumplidos, 4 parciales (invitar como owner no está permitido; Secure/hash sin prueba explícita; documentación con desfases; panel de plataforma como ruta `/platform`) y 1 no cumplido (no hay Docker Compose; en la nube se usan servicios locales). Las casillas de abajo se conservan como estaban.

Funcionales:
- [ ] Un usuario se registra con email y contraseña (verificación de email en local con buzón de pruebas), inicia y cierra sesión.
- [ ] Crea una organización y dentro una tienda (slug único). La tienda queda provisionada en una transacción: registro en `control.stores`, asignación a celda, datos iniciales en `commerce` con RLS.
- [ ] Invita a otro usuario con rol (owner, admin, staff); el invitado acepta y solo ve las tiendas donde tiene rol.
- [ ] Panel inicial del comerciante: selector de tienda, ajustes básicos (nombre, país, moneda) y navegación calculada por capacidades × permisos.
- [ ] Panel de plataforma mínimo: lista de organizaciones y tiendas (solo operadores, auditado).
- [ ] Log de auditoría por tienda (quién, qué, cuándo) para acciones de administración.

Seguridad y aislamiento:
- [ ] Todas las tablas de tienda con RLS forzado; la app usa rol sin `BYPASSRLS`; test que lo verifica leyendo `pg_class`/`pg_policies`.
- [ ] Suite de aislamiento HTTP: usuario de A contra todos los endpoints con IDs de B (ruta, query, body, cabeceras) → 404 sin efectos. Control negativo en CI.
- [ ] RBAC: staff no puede invitar ni cambiar roles; tests negativos.
- [ ] Rate-limit de login; contraseñas con hash fuerte (por defecto de Better Auth verificado); cookies `HttpOnly`, `Secure`, `SameSite`.

Calidad:
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y E2E de registro→tienda→invitación en verde en GitHub Actions.
- [ ] Entorno local reproducible con un comando (Docker Compose en la máquina del desarrollador; en la nube, servicios locales).
- [ ] Documentación actualizada (DATABASE-SCHEMA, API-CONTRACTS, CHANGELOG) e informe de verificación de R1 con evidencias.
- [ ] Revisión independiente (agente distinto del que implementa) con GO/NO-GO.

Fuera de R1: catálogo, pagos, módulos, storefront.
