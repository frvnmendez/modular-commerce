# ADR-0001 — Motor comercial: núcleo propio en TypeScript, sin Vendure ni Medusa como plano de datos

- Fecha: 2026-11-08
- Estado: **Aceptado** (decisión del propietario 2026-11-09, tras el spike; ver §Resultado del spike)
- Responsables: CTO, Commerce Engine Architect · Revisión: Security, Red Team

## Contexto

Necesitamos un plano de datos de comercio para miles de tiendas independientes con aislamiento fuerte entre comerciantes, extensiones de terceros fuera de proceso y un equipo pequeño en TypeScript. El directive proponía Vendure como candidato inicial, sin elegirlo automáticamente.

## Alternativas evaluadas

| Opción | A favor | En contra (evidencia) |
|---|---|---|
| **Vendure 3.8 compartido (canal por tienda)** | Maduro, GraphQL, canales y roles por canal funcionan a nivel API (PoC B: 7/7 controles OK) | Clientes globales entre tiendas → **fuga de datos personales reproducida** (PoC B). Entidades fiscales globales. Plugins en proceso con acceso total a BD. GPLv3 + aviso público de posibles tarifas para SaaS (pendiente confirmar por escrito) |
| **Medusa 2.x, instancia por tienda** | Aislamiento fuerte por construcción, núcleo MIT, gran cadencia | ≈340 MB RAM y 6 conexiones PG por tienda en reposo (PoC C) → ~3 TB RAM para 10k tiendas. 143 tablas × N migraciones. Deriva open-core (Enterprise Edition propietaria desde 2.2x: RBAC, SSO) |
| **Medusa como librería + capa propia (híbrido)** | Reutiliza modelos de dominio MIT. Mejor puntuación en la matriz del investigador (386/500) | Los módulos de Medusa no tienen `tenant_id` ni RLS; el motor gestiona sus propias conexiones y transacciones (MikroORM), así que inyectar el contexto de tenant por transacción exige parchear internals que cambian varias veces por semana. Workflows sin transacción entre pasos (discusión #14835). Riesgo alto de fork permanente |
| Saleor | Mejor modelo de apps fuera de proceso (webhooks síncronos/asíncronos, Transaction API con idempotencia). BSD-3 | Python/Django/Celery: segundo stack para un equipo TS. Canales ≠ tenants |
| Bagisto | MIT | PHP; el módulo SaaS es un producto de pago de Webkul (1.199 USD) con BD compartida |
| **Núcleo propio (modular monolith TS + PostgreSQL RLS)** | Aislamiento diseñado desde el primer día (PoC A: 15/15 + control negativo). Control total del modelo de datos, licencias limpias, un solo stack | Hay que construir el dominio comercial. Riesgo de errores en impuestos, promociones y estados de pedido |

## Decisión

Construir un **núcleo comercial propio** como módulos internos de un monolito modular en TypeScript sobre PostgreSQL con RLS obligatorio, con alcance de MVP acotado:
- Catálogo (productos, variantes, colecciones), inventario de una ubicación, carrito, checkout, pedidos, clientes, descuentos simples.
- Impuestos: tablas de tipos por país en el MVP y proveedor externo (p. ej. Stripe Tax) evaluado en R2. No implementar un motor fiscal propio.
- Pagos: siempre a través de un módulo de pasarela (Stripe en sandbox para el MVP).

Reutilización legítima: estudiar los modelos de dominio de Medusa (MIT) y el contrato de apps de Saleor (BSD-3) como referencia; cualquier fragmento de código copiado conservará su aviso de licencia. No se copiará nada de Vendure (GPLv3) para no contaminar el código propietario.

## Consecuencias

- (+) La frontera de seguridad entre tiendas está en la base de datos, no en la disciplina de cada desarrollador o plugin.
- (+) Coste marginal por tienda bajo (filas, no procesos).
- (+) Sin dependencia de cambios de licencia de terceros.
- (−) Más trabajo en R2 (estimación: el núcleo comercial mínimo es el release más largo). Se mitiga limitando alcance y con tests de propiedades en cálculos de dinero.
- (−) Sin ecosistema de plugins prestado: nuestro marketplace empieza vacío (era el plan de todos modos: marketplace pospuesto).

## Riesgos

- R-01 Subestimar la complejidad del dominio comercial. Mitigación: alcance cerrado, revisión del Commerce Engine Architect, suite de cálculo con casos fiscales reales.
- R-06 Si el propietario prefiere salir antes al mercado, la opción de respaldo es Medusa instancia-por-tienda solo para un piloto de <20 tiendas, aceptando su coste.

## Reversibilidad

Media. El núcleo propio expone contratos de API y eventos versionados; sustituir la implementación interna por un motor externo más adelante es posible pero costoso. Por eso esta decisión debe aprobarse antes de R1.

## Revisión del Red Team y respuesta (2026-11-08)

El revisor independiente objetó que el híbrido Medusa se descartó sin PoC y sin estimar el esfuerzo del núcleo propio.

- **Medusa "por celda con BD por grupo de tenants":** no es viable tal cual. La PoC C muestra que una instancia de Medusa gestiona una sola tienda (`POST /admin/stores` → 404). Agrupar tiendas en una instancia obliga a usar canales de venta como tiendas, que reproducen el problema de Vendure (canal ≠ frontera). Por tanto, Medusa aislado = una instancia por tienda, con el coste medido.
- **Vendure + plugin que aísle clientes por canal:** plausible y no probado. Sigue sin resolver los plugins en proceso, las entidades fiscales globales y la ambigüedad GPLv3/SaaS, pero es la alternativa barata más seria.
- **Estimación del núcleo propio (confianza baja):** el alcance de R2 (catálogo con variantes, inventario de una ubicación, carrito, checkout con Stripe test, pedidos con máquina de estados, clientes, descuentos simples, impuestos por tabla) se estima en **2–3 meses-persona** con desarrollo asistido por IA. Con Vendure, R2 sería ≈1 mes de integración más el endurecimiento de aislamiento, sin contar el riesgo de licencia.

**Propuesta revisada (histórica, ya ejecutada):** el Release 1 (cuentas, organizaciones, tiendas, RBAC, plano de control) es el mismo con cualquier motor. Se puede empezar R1 ya y decidir este ADR antes de R2 tras un spike de 3 días: (a) plugin de Vendure que aísle clientes por canal + respuesta escrita de Vendure GmbH sobre SaaS; (b) prototipo del núcleo propio con producto+variante+pedido sobre RLS para medir velocidad real.

## Resultado del spike (2026-11-09)

Informe completo: `docs/spikes/ADR-0001-SPIKE.md`.

- **(b) Núcleo propio:** producto, variantes, inventario, clientes, impuestos por país y pedidos sobre la RLS de R1, sin cambios en `@mc/db` ni en las migraciones de R1. Pasan 24/24 pruebas (flujo, concurrencia, aislamiento por API y con `mc_app` directo, invariantes de importes y estados), y los 3 sabotajes se detectan.
- **(a) Vendure + plugin:** el plugin cierra la fuga de datos personales de la PoC B y una nueva (un invitado de B reescribía los datos de un cliente de A), pero solo prohibiendo que un email sea cliente de dos tiendas. Eso hace perder ventas legítimas, y quedan 4 problemas que un plugin no resuelve: credenciales compartidas, enumeración, datos globales y plugins en proceso. La consulta de licencia está redactada y sin enviar (`docs/spikes/vendure-licencia-consulta.md`).
- **Decisión (2026-11-09):** el propietario acepta el núcleo propio. La estimación de R2 (2–3 meses-persona) se mantiene.

## Revisión independiente (2026-11-10)

Un análisis posterior (8 revisores independientes) mantiene la decisión como defendible, con tres matices:

- El spike comparó de forma asimétrica: en Vendure se probó la identidad del comprador (registro, login, checkout de invitado); en el núcleo propio todos los pedidos los crea el staff. La identidad y el contexto del comprador siguen **sin diseñar** y el contexto de BD de R1 solo admite sesiones de staff.
- La estimación de R2 se recalcula en **410–765 h** (≈2,6–4,8 meses-persona), 250–420 h con alcance recortado (checkout solo de invitado con Stripe Checkout hospedado, sin descuentos, devoluciones parciales ni facturas propias).
- Antes de convertir `spikes/own-core/sql/0100` en migración: crear pedidos solo con una función `place_order` (hoy `mc_app` puede insertar pedidos en cualquier estado), auditar desde funciones del dueño y quitar los casts `::int` de importes.

**R2 está congelado desde 2026-11-10** por decisión del propietario hasta validar la demanda (ver `docs/MASTER-PLAN.md`).
