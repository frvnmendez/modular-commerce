# Estrategia de pruebas

| Nivel | Herramienta | Qué cubre | Cuándo bloquea |
|---|---|---|---|
| Unitarias | Vitest | Reglas de negocio, dinero (enteros en céntimos), validadores, permisos, estados de pedidos y módulos | Cada PR |
| Integración | Vitest + PostgreSQL real (no mocks) | Repositorios con RLS, colas pg-boss, provisionamiento, webhooks | Cada PR |
| Aislamiento | Suite propia (`tests/isolation`) | Matriz A↔B sobre todos los endpoints, jobs, caché, S3, logs + **control negativo** | Cada PR (Gate C) |
| Contrato | OpenAPI + tests de esquemas | API, eventos, manifiesto, adaptadores de proveedores | Cada PR |
| E2E | Playwright | Registro → tienda → módulo → publicación → compra test → pedido → desinstalación → cancelación | Merge a main |
| Seguridad | `pnpm audit`, SAST, tests negativos; DAST en R8 | Dependencias, inyecciones, SSRF, CSRF | Release |
| Rendimiento | k6 o Artillery (a elegir en R8) | p95 de API, consultas, storefront | Release |
| Resiliencia | Tests de caos dirigidos | Webhook duplicado, timeout, caída de proveedor, reinicio en instalación, restauración de backup | Release |

## Presupuestos iniciales (objetivos, aún no medidos)

- API admin: p95 < 300 ms en lecturas simples con 1.000 tiendas en la celda.
- Checkout: p95 < 800 ms excluyendo la llamada al proveedor de pagos.
- Storefront: LCP < 2,5 s en móvil 4G simulado, CLS < 0,1.

## Reglas

- Un test omitido, saltado o no ejecutado no cuenta como aprobado.
- No se publica cobertura sin el informe generado.
- Los estados se reportan con la escala: Implementado → Probado localmente → Validado en integración → Validado en staging → Aprobado para producción → Desplegado.
