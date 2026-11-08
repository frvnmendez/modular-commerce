# ADR-0003 — Sistema de módulos: extensiones fuera de proceso con manifiesto tipado

- Fecha: 2026-11-08 · Estado: **Aceptado** (2026-11-08, decisión del propietario: "R1 ya, motor tras 3 días de prueba") · Responsables: Plugin Platform Architect, Security

## Contexto

El sistema modular es el núcleo del producto. Los módulos externos no pueden ejecutar código en el proceso principal ni acceder a la base de datos compartida.

## Alternativas

| Modelo | Ejemplo | Problema |
|---|---|---|
| Plugins en proceso (npm) | Vendure, Medusa | Código de terceros con acceso total a BD y memoria. Inaceptable para terceros |
| Sandbox en proceso (V8 isolates / WASM) | Shopify Functions (WASM) | Útil para lógica pura y rápida (descuentos, validaciones); caro de construir. Se pospone |
| **Apps fuera de proceso: API + eventos + webhooks firmados** | Saleor Apps, Shopify Apps | Latencia de red; requiere gateway, firmas, reintentos. Es el patrón probado del sector |

## Decisión propuesta

1. **Dos niveles de confianza:**
   - *Módulos oficiales*: los construimos nosotros, viven en el monorepo (`modules/*`), se ejecutan en el worker de la plataforma pero **solo a través del mismo SDK y API con alcance** que un tercero. Así validamos el SDK con código real (dogfooding) y podemos extraerlos a fuera de proceso sin reescribir.
   - *Extensiones de terceros*: siempre fuera de proceso, alojadas por el desarrollador. Sin marketplace público hasta demostrar estabilidad (post R4).
2. **Manifiesto** v1 validado con Zod (exportable a JSON Schema) — ver `docs/PLUGIN-SPECIFICATION.md`. PoC D lo demuestra (19/19 tests).
3. **Contratos:** API de plataforma versionada (REST + OpenAPI), eventos versionados con sobre CloudEvents, webhooks firmados HMAC-SHA256 con marca de tiempo y protección de repetición, tokens por instalación (tenant × módulo × scopes), revocados al deshabilitar.
4. **Contribuciones a la UI:** los módulos no inyectan JavaScript. Aportan (a) entradas de navegación y formularios declarativos (JSON Schema → componentes nuestros) en el admin, y (b) bloques de storefront declarados en el manifiesto y registrados en tiempo de build solo para módulos revisados.
5. **Resiliencia:** timeouts por manifiesto (≤10 s), 3 reintentos con backoff, circuit breaker por instalación, cola de mensajes muertos, idempotencia por `event_id`.

## Consecuencias

- (+) Un módulo defectuoso o malicioso no puede leer la BD ni otra tienda: solo lo que su token permite.
- (−) Los hooks síncronos (p. ej. cálculo de envío en checkout) dependen de la red del módulo: hay que definir fallback (tarifa por defecto / ocultar método) y presupuesto de latencia.
