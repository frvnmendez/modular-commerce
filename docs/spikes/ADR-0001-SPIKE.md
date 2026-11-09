# Spike ADR-0001: núcleo propio frente a Vendure con plugin de aislamiento

- Fecha: 2026-11-09 · Base: `main` en `60afd05` (R0 + R1 fusionados)
- Código: `spikes/own-core/` (opción A) y `spikes/vendure-isolation/` (opción B)
- Entorno: contenedor de 4 vCPU, PostgreSQL 16.15 local, Node 22.23. Sin Docker ni servicios externos.

## Resultado

**Recomendación: aceptar ADR-0001 y construir el núcleo comercial propio en R2.**

- **Núcleo propio:** el prototipo de catálogo, clientes y pedidos sobre la RLS de R1 funcionó sin tocar `@mc/db` ni las migraciones de R1. Pasan 24 de 24 pruebas, y los 3 sabotajes hacen fallar la suite por la razón prevista.
- **Vendure con plugin:** el plugin cierra la fuga de datos personales de la PoC B, pero solo impidiendo que un mismo email sea cliente de dos tiendas. Con el plugin, quien ya compró en la tienda A **no puede comprar en la tienda B** con ese email, ni con su cuenta ni como invitado. Además quedan 4 problemas de aislamiento que un plugin no puede resolver.

Para que un mismo email sea cliente de varias tiendas, habría que reemplazar el modelo de identidad del núcleo de Vendure. Eso ya no es un plugin, sino un fork bajo GPLv3.

## Opción A: núcleo propio (`spikes/own-core/`)

**Alcance.**
- 8 tablas nuevas: productos, variantes, inventario de una ubicación, tipos de impuesto por país, clientes, contador de pedidos, pedidos y líneas.
- 9 rutas sobre la app de R1, que usan la misma sesión, el mismo `withStore` y la misma RLS.
- Cálculo de importes en céntimos con `BigInt` y redondeo a la mitad al par.

Aplica las reglas 1 a 7 y la 5b de `docs/TENANT-ISOLATION.md`.

| Prueba | Resultado |
|---|---|
| Flujo: producto con variantes, pedido con número por tienda y IVA incluido, stock descontado, máquina de estados, cancelación con devolución de stock | 8/8 |
| Concurrencia: 10 pedidos simultáneos por la última unidad | Gana exactamente 1; los otros 9 reciben 409 `OUT_OF_STOCK`; el stock nunca baja de 0 |
| Aislamiento por API: A lee o modifica producto, cliente y pedido de B, y usa IDs de B en el cuerpo del pedido (variante, cliente, mezcla) | Todo 404 (403 si el staff toca el catálogo de su propia tienda); la huella de B queda idéntica |
| Mismo email en dos tiendas | Dos clientes distintos; cada tienda ve solo su dirección (el caso que falla en Vendure) |
| SQL directo con `mc_app` dentro de A | Ve 0 filas de B en las 8 tablas; los UPDATE a B afectan a 0 filas; un INSERT con el `tenant_id` de B da 42501; una FK a una variante de B da 23503 |
| Regla 5b: el staff con `mc_app` directo escribe catálogo o impuestos | 0 filas afectadas o 42501; el owner sí puede |
| Invariantes en la BD | Importes inmutables (privilegio de columna); un pedido sin líneas o con subtotal falso no confirma (trigger diferido); el staff no cancela ni con SQL directo |
| Importes: 5.000 pedidos aleatorios con tipos del 0 al 27 %, IVA incluido y excluido | Cuadran al céntimo; error de redondeo ≤ 0,5 céntimos (comprobado con racionales, sin float) |

**Controles negativos** (`node negative-controls.mjs`):

| Sabotaje | Pruebas que fallan |
|---|---|
| `rls-off` | 6 |
| `role-off` (sin políticas RESTRICTIVE) | 1 |
| `guard-off` (sin triggers de estado e importes) | 4 |

**Medición orientativa** (`SPIKE_BENCH=1`, un proceso, la API completa con sesión de Better Auth):

| Concurrencia | Pedidos por segundo (pedidos de 2 líneas) | xid por pedido | GET de producto |
|---|---|---|---|
| 1 | 116 | 1,0 | 3,8 ms |
| 10 | 214 | 1,0 | 3,5 ms |

No es la prueba de carga de R2. Sirve de línea base para el hallazgo 3 de R1: un pedido gasta un xid igual que un GET, así que en escrituras el coste del contexto es cero.

**Velocidad.**
- Unas 900 líneas (SQL, TS y pruebas), escritas en una sesión con desarrollo asistido por IA. Esquema, rutas y las 24 pruebas pasaron a la primera ejecución.
- El tiempo de reloj de una IA no es un dato de meses-persona. Lo útil es otra cosa: el patrón de R1 se extendió a 8 tablas sin cambiar el mecanismo de identidad ni de contexto.
- **La estimación de R2 (2 a 3 meses-persona) se mantiene.** El spike reduce el riesgo de aislamiento e invariantes, no el de amplitud del dominio: checkout con Stripe, descuentos, devoluciones parciales y casos fiscales reales.

## Opción B: Vendure 3.8.1 + `StoreIsolationPlugin` (`spikes/vendure-isolation/`)

**Qué hace el plugin.**
- Usa una estrategia oficial de asignación de clientes por canal (desde 3.7) que nunca asigna.
- Instala un trigger en la tabla puente cliente-canal: un cliente no puede pertenecer a dos tiendas.
- Usa IDs UUID.

Son unas 60 líneas.

| # | Escenario | Sin plugin | Con plugin |
|---|---|---|---|
| F1b | María se registra en A y en B e inicia sesión en B: el admin de B ve la dirección que guardó A | **Fuga** | OK |
| F3 | Con la sesión de A en B, la tienda y el admin de B ven las direcciones de A | **Fuga** | OK |
| F4 | Un invitado en B con el email de una invitada de A reescribe su nombre y su teléfono en A | **Fuga** (nueva, no estaba en la PoC B) | OK |
| F8 | IDs secuenciales compartidos | **Fuga** | OK |
| F2 | La contraseña de A abre sesión en B; la que María puso al registrarse en B se ignora en silencio | **Fuga** | **Fuga** |
| F5 | El alta de un cliente en B responde distinto si el email ya es cliente de otra tienda (enumeración entre tiendas) | **Fuga** | **Fuga** |
| F6 | Países, zonas e impuestos globales visibles para cada tienda | **Fuga** | **Fuga** |
| F7 | Un plugin, en el mismo proceso, lee los clientes de todas las tiendas | **Fuga** | **Fuga** |
| F4b | Una invitada de A no puede comprar como invitada en B | Compra | **Venta perdida** |
| F9 | Una clienta de A no puede completar una compra en B con su cuenta («sin datos de cliente») | Compra | **Venta perdida** |

Salidas completas en `spikes/vendure-isolation/results/`. Huella en reposo tras la prueba: ≈250 MB RSS por proceso.

**Por qué no se intentó «una identidad por tienda».** Vendure busca el cliente por email sin filtrar por canal en al menos cinco caminos de `@vendure/core@3.8.1`: `create`, `createOrUpdate`, `registerCustomerAccount`, el checkout de invitado y los pedidos borrador. Además, `User.identifier` es único global. El detalle, con números de línea, está en `spikes/vendure-isolation/README.md`.

**Licencia.** La pregunta a Vendure GmbH sigue sin respuesta, porque enviarla es una comunicación externa. El borrador está listo en `docs/spikes/vendure-licencia-consulta.md`. Con el resultado técnico, la respuesta ya no cambia la recomendación. Solo importaría si se reabriera Vendure.

## Lo que sigue sin verificar

- La carga real con muchas tiendas y la prueba de carga de R2, que decide el hallazgo 3 de R1.
- Pagos (Stripe sandbox), descuentos, envíos y devoluciones en el núcleo propio: es el grueso de R2.
- La postura escrita de Vendure GmbH sobre SaaS.
- El spike de Vendure no probó la API de búsqueda ni los plugins de email, que heredan el mismo modelo de cliente global.

## Si se acepta: qué pasa a R2 desde el spike

- El esquema de `spikes/own-core/sql/` es la base de la migración 0011, tras una revisión del Commerce Engine Architect.
- Las rutas pasan a `apps/commerce-api`, y los permisos a `@mc/core`.
- Las pruebas se suman a la suite de aislamiento, y sus sabotajes a `test:negative`.
- `spikes/` se borra cuando todo eso esté en su sitio.
