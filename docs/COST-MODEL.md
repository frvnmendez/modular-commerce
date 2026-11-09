# Modelo de costes (preliminar)

> Estimación de **recursos**, no de facturas. Los importes en euros se calcularán cuando se elija proveedor cloud (con cotización actual); no se inventan precios aquí.

## Supuestos de carga por tienda (hipótesis)

| Variable | Valor supuesto |
|---|---|
| Tienda media | 300 productos, 1.500 visitas/día, 10 pedidos/día |
| Pico | ×10 sobre la media durante 1 h/día |
| Datos | ~50 MB BD/tienda/año; ~1 GB imágenes/tienda (en S3, servidas por CDN) |
| Storefront | Páginas cacheadas en CDN (ISR); la mayor parte del tráfico no llega al origen |

## Dato medido que condiciona el diseño (PoC C, PoC B)

- Instancia de Medusa en reposo ≈ 340 MB RAM; Vendure ≈ 171–233 MB.
- **Instancia por tienda:** 10.000 tiendas × ~0,3 GB ≈ 3 TB de RAM solo en reposo, más ~6 conexiones PG por tienda. Descartado salvo Enterprise.
- **Modelo compartido (elegido):** el coste escala con el tráfico agregado, no con el número de tiendas.

## Dimensionado orientativo del modelo compartido

| Tiendas | Peticiones a origen (pico, supuesto) | App (api+worker) | PostgreSQL | Objetos |
|---|---|---|---|---|
| 10 | < 5 rps | 1 VM pequeña (2 vCPU/4 GB) | Gestionado pequeño o en la misma VM en staging | < 20 GB |
| 100 | ~20–50 rps | 2 réplicas (alta disponibilidad) | Gestionado 2 vCPU + réplica | ~100 GB |
| 1.000 | ~200–500 rps | 3–6 réplicas | 4–8 vCPU + réplica de lectura | ~1 TB |
| 10.000 | ~2.000–5.000 rps | Varias celdas de 6–10 réplicas | 3–5 celdas, cada una 8–16 vCPU | ~10 TB |

Hay que validar estos números con pruebas de carga en R8; son extrapolaciones, no mediciones.

## Costes que no son infraestructura (a modelar en R6)

- Comisiones del proveedor de pagos (las paga el comerciante o se repercuten).
- IA: coste por token × uso por plan (con cuotas).
- Email transaccional, CDN, dominios/TLS personalizados.
- Soporte (probablemente el mayor coste variable en microempresas), desarrollo y adquisición de clientes.
