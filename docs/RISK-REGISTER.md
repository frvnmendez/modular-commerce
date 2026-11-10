# Registro de riesgos

Escala: Probabilidad (B/M/A) × Impacto (B/M/A/Crítico). Los riesgos críticos de seguridad, legalidad o integridad bloquean releases.

| ID | Riesgo | P | I | Mitigación | Responsable | Estado |
|---|---|---|---|---|---|---|
| R-01 | Subestimar el dominio comercial propio (impuestos, promociones, estados de pedido) | A | A | Alcance de MVP cerrado; impuestos vía tablas simples + proveedor externo evaluado; tests de propiedades en dinero; revisión del Commerce Architect | CTO | Abierto |
| R-02 | Fuga de datos entre tiendas | M | Crítico | RLS forzado + FKs compuestas + suite de aislamiento con control negativo en CI (Gate C) | Security | Mitigación probada en PoC A |
| R-03 | Inyección SQL anula RLS (forjar el contexto de tenant) | B | Crítico | ORM parametrizado, SQL crudo solo en `packages/db` revisado, lint, DAST en R8 | Security | Abierto. El contexto ya no es un GUC sino `request_context` + token (0006); queda SQL crudo en `apps/commerce-api/src/app.ts` |
| R-04 | Extensión maliciosa o comprometida | M | A | Fuera de proceso, scopes mínimos, tokens revocables, cuotas, revisión antes de listar, marketplace pospuesto | Plugin Architect | Diseño (ADR-0003) |
| R-05 | Doble cobro / pedidos duplicados / sobreventa | M | Crítico | Idempotency keys en pedidos y en Stripe, `FOR UPDATE` en stock, máquina de estados de pedido, conciliación con webhooks (Gate D) | Commerce | Probado en PoC A (idempotencia y stock) |
| R-06 | Tiempo hasta mercado largo con núcleo propio | A | A | Releases verticales; piloto temprano con pocos comercios; opción de respaldo documentada (ADR-0001) | CEO/TPM | Abierto |
| R-07 | Licencias: GPLv3 de Vendure, Enterprise Edition de Medusa | M | A | No usar ni copiar código Vendure; si se reutiliza código MIT conservar avisos; escaneo de licencias en CI | Legal | Mitigado por ADR-0001 |
| R-08 | Responsabilidad regulatoria de pagos (PSD2/SCA, PCI DSS) | M | A | No tocar datos de tarjeta (Stripe Elements/Checkout → SAQ A); Stripe Connect con KYC del proveedor; revisión legal antes de R9 | Legal | Abierto |
| R-09 | RGPD: somos encargados de tratamiento de cada comerciante | A | A | DPA, registro de actividades, exportación y borrado por cliente y por tienda, retención definida | Legal | Abierto |
| R-10 | Vecino ruidoso en celda compartida | M | M | `statement_timeout`, rate-limit por tenant, cuotas por plan, celdas dedicadas | SRE | Probado parcialmente (PoC A) |
| R-11 | Términos de servicio de Shopify al "estudiar" su producto | M | M | Solo documentación pública y observación manual; sin automatización, scraping ni copia de UI | Legal | Mitigado por ADR-0004 |
| R-12 | Coste de IA descontrolado | M | M | Cuotas por plan, caché, modelos pequeños por defecto, medición por tenant (R7) | CFO | Abierto |
| R-13 | Sin product-market fit | A | Crítico (negocio) | Nicho de entrada concreto, entrevistas y piloto antes de escalar (Gate G) | CEO | **Abierto, prioritario: R2 congelado hasta validar (2026-12-15)** |
| R-14 | Entorno de desarrollo efímero sin repositorio | A | M | Crear repo GitHub del proyecto antes de R1; todo el trabajo se versiona | Propietario | Cerrado (repo creado 2026-11-08) |
| R-15 | Dependencia de Stripe (cuentas bloqueadas, países no soportados) | M | A | Abstracción de pasarela en el módulo; segunda pasarela evaluada antes del piloto | Payments | Abierto |
| R-16 | Oráculos de existencia (PK global), estadísticas del catálogo de PG, timestamp en UUIDv7 | M | B | Revocar acceso a `pg_class`/`pg_stats` sensibles a `mc_app`; errores genéricos; aceptar timestamp de UUIDv7 | Security | Aceptado |
| R-17 | Agotamiento del pool por un tenant (vecino ruidoso real) | M | A | Límite de concurrencia por tenant en la API, colas por tenant, pools separados por celda | SRE | Abierto (R1) |
| R-18 | RGPD operativo: exportar/borrar datos de un cliente y de una tienda entera; restaurar una sola tienda | A | A | Procedimientos y tests en R2 (borrado) y R8 (restore) | Legal/SRE | Abierto |
| R-19 | IVA UE (OSS) e impuestos al consumidor | A | A | No construir motor fiscal; evaluar Stripe Tax u otro proveedor en R2; revisión fiscal antes del piloto | Commerce/Legal | Abierto |
| R-20 | Rol de operación entre tenants (soporte, analítica) abusado | M | A | Rol separado, acceso temporal con motivo, auditoría y solo vistas agregadas | Security | Abierto |
| R-21 | Un xid y una escritura por petición (también en GET): consumo de xid, bloat de `request_context` y lecturas autenticadas imposibles en réplicas | M | A | Prueba de carga con k6 antes o durante R2; alternativa: contexto firmado sin escrituras | DBA | Abierto |
| R-22 | El contexto de BD solo admite sesiones de staff: no hay entrada legítima para comprador, webhooks, worker ni módulos | A | A | ADR de contexto v2 antes de la primera tabla de R2 | Security | Abierto (bloquea R2) |
| R-23 | Código de seguridad escrito por agentes de IA sin auditoría humana externa | M | Crítico | Auditoría externa antes de tratar datos personales reales o cobros | Propietario | Abierto |
| R-24 | Capacidad de una sola persona: R2–R9 compite con otros proyectos y el soporte 24/7 no escala | A | A | Validación previa con stop-loss; tope de horas semanal si R2 se descongela | Propietario | Abierto |
