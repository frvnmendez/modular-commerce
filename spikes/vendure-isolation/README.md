# Spike ADR-0001 — Vendure 3.8.1 con plugin de aislamiento de clientes por tienda

Fuera del workspace pnpm a propósito: las dependencias GPLv3 de Vendure no entran en el lockfile del producto.
Nada de este directorio se distribuye ni se despliega.

## Ejecutar

```bash
cd spikes/vendure-isolation
npm ci
PLUGIN=off node test/run.mjs   # Vendure tal cual
PLUGIN=on  node test/run.mjs   # con StoreIsolationPlugin
```

Necesita PostgreSQL local con `postgres/postgres` (o `DATABASE_ADMIN_URL`). Cada ejecución crea una BD nueva.
Salidas guardadas en `results/plugin-off.txt` y `results/plugin-on.txt`.

## Qué hace el plugin (`src/store-isolation-plugin.mjs`)

1. `customerChannelAssignmentStrategy` que nunca añade un cliente a otra tienda al iniciar sesión (API oficial desde 3.7).
2. Trigger en `customer_channels_channel`: un cliente no puede pertenecer a dos tiendas, venga del camino que venga
   (registro, alta desde el admin, checkout de invitado, pedidos borrador).
3. `UuidIdStrategy` para que los IDs no sean secuenciales.

## Por qué no se intentó «una identidad por tienda»

Vendure busca el cliente por email **sin filtrar por canal** en al menos cinco sitios de `@vendure/core@3.8.1`:
`CustomerService.create` (línea 175), `createOrUpdate` (634), `registerCustomerAccount` (318, vía `UserService.getUserByEmailAddress`),
`DefaultGuestCheckoutStrategy.setCustomerForOrder` (50) y el resolver de pedidos borrador (`draft-order.resolver.js:83`).
`User.identifier` es único global. Dar a cada tienda su propio cliente con el mismo email exige reemplazar esos servicios
(o reescribir el email con un prefijo de tienda, que rompe emails transaccionales, restablecimiento de contraseña y búsquedas).
Eso ya no es un plugin: es mantener un fork del núcleo de identidad de Vendure, y bajo GPLv3.
