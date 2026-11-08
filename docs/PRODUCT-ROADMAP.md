# Producto y MVP comercial

> Todo lo de este documento son **hipótesis** sin validar con clientes. No hay evidencia de product-market fit (Gate G).

## Nicho de entrada propuesto

**Microempresas y marcas pequeñas hispanohablantes (España primero, luego LatAm) que venden producto físico propio**, con poca experiencia técnica, que quieren abrir tienda en un día con configuración guiada y cumplimiento europeo resuelto.

Por qué (juicio, no dato):
- Idioma y cumplimiento local (RGPD, IVA, facturación, devoluciones UE) como diferenciador frente a plataformas pensadas en inglés.
- El onboarding por perfil de capacidades + IA reduce la barrera que más pesa en este segmento.
- La arquitectura multi-tienda por organización encaja con **agencias** que gestionan varias tiendas: canal de adquisición secundario.

Por qué **no** dropshipping como nicho principal: alta rotación, márgenes bajos y dependencia de proveedores. Se ofrece como módulo, no como posicionamiento. Decisión revisable tras entrevistas.

## MVP comercial (lo mínimo vendible a un piloto)

1. Registro, organización y creación de tienda con onboarding de 8 preguntas → perfil de capacidades → módulos recomendados.
2. Catálogo con variantes, inventario de una ubicación, colecciones.
3. Storefront con 1 tema configurable (bloques Puck limitados), dominio de plataforma (`tienda.plataforma.com`). Dominio propio en R5.
4. Carrito y checkout con Stripe (test en desarrollo; pagos reales solo en piloto aprobado).
5. Gestión de pedidos (pagado → preparado → enviado → entregado / cancelado / reembolsado), clientes, emails transaccionales.
6. Módulos oficiales: pagos, envío (adaptador), dropshipping (conector).
7. Plan único de pago para el piloto.

Fuera del MVP: marketplace público, IA avanzada, multi-moneda, multi-almacén, suscripciones de producto, B2B.

## Planes (hipótesis a validar)

| Plan | Para quién | Límites indicativos | Ingresos adicionales |
|---|---|---|---|
| Starter | Empezar a vender | 1 tienda, 2 staff, módulos oficiales básicos | — |
| Growth | Tiendas con ventas recurrentes | Más staff, automatizaciones, IA con cuota | Módulos premium, IA extra |
| Business | Varias tiendas / agencias | Multi-tienda, roles avanzados, soporte prioritario | Servicios de configuración |
| Enterprise | Grandes cuentas | Celda dedicada, SSO, SLA | Contrato |

Precios: pendientes de entrevistas y del modelo de costes con proveedor real. Comisión sobre ventas de terceros solo si es legal y viable con el proveedor de pagos (a revisar en R4).

## Validación antes de escalar

- 10–15 entrevistas con comerciantes del nicho antes de cerrar R2 (guion en R1).
- Piloto (R9) con 3–5 comercios reales y pedidos reales controlados.
- Métricas: activación (tienda publicada en 7 días), primer pedido, retención a 60 días, disposición a pagar.
