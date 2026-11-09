# ADR-0002 — Modelo de aislamiento: BD compartida con RLS forzado, organizada en celdas

- Fecha: 2026-11-08
- Estado: **Aceptado** (2026-11-08, decisión del propietario: "R1 ya, motor tras 3 días de prueba")
- Responsables: Multi-Tenant Architect, Security Engineer

## Contexto

Requisito innegociable: el administrador de la tienda A no puede leer, modificar ni borrar recursos de B, ni alterando IDs, parámetros, tokens o rutas; también en trabajos asíncronos, webhooks, caché, almacenamiento y logs. Debe escalar de 10 a 10.000 tiendas sin coste lineal en procesos.

## Alternativas

| Modelo | Aislamiento | Coste a 10k tiendas | Operación | Veredicto |
|---|---|---|---|---|
| Instancia + BD por tienda | Muy alto | ~0,3 GB RAM/tienda en reposo (PoC C) | 10k despliegues y migraciones | Solo Enterprise |
| BD por tienda, proceso compartido | Alto | Pools de conexión × N | 10k migraciones; conexiones agotadas | No en MVP |
| Esquema por tienda | Medio-alto | Catálogo de PG degradado con miles de esquemas | Migraciones × N | No |
| **Tabla compartida + `tenant_id` + RLS forzado** | Alto si se aplica bien (PoC A) | Mínimo | Una migración | **Elegido** |
| Tabla compartida solo con filtros en código | Bajo (un olvido = fuga) | Mínimo | Simple | Rechazado |

## Decisión propuesta

1. **Defensa en profundidad en 4 capas:**
   1. Autenticación: la sesión fija `tenant_id` y `user_id`. Ningún endpoint acepta `tenant_id` del cliente.
   2. Autorización: RBAC por tienda (rol × permisos) comprobado en la capa de servicio.
   3. Base de datos: todas las tablas de comercio con `tenant_id NOT NULL`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, política `USING` y `WITH CHECK`, FKs compuestas `(tenant_id, id)`. La aplicación conecta con un rol que no es dueño de las tablas y no tiene `BYPASSRLS`. Contexto con `set_config(..., true)` dentro de transacción (nunca `SET` de sesión).
   4. Infraestructura derivada: claves de caché, rutas de objetos S3, colas y logs con prefijo de tenant; workers que restauran el contexto desde el payload firmado del trabajo.
2. **Celdas:** cada tenant se asigna a una celda (un clúster PostgreSQL + réplicas de aplicación). El plano de control guarda el mapa tenant→celda. Al principio hay una sola celda; se añaden al crecer o para clientes Enterprise (celda dedicada = aislamiento físico con el mismo código).
3. **IDs no secuenciales** (UUIDv7) para evitar enumeración y fugas de volumen.
4. **Suite de aislamiento obligatoria en CI** (Gate C), con control negativo que sabotea RLS y exige que la suite falle.

## Consecuencias

- Una vulnerabilidad de inyección SQL podría cambiar el contexto de tenant (RLS por GUC no la detiene). Se mitiga con ORM parametrizado, lint que prohíbe SQL crudo fuera de un paquete revisado y pruebas DAST.
- Los "vecinos ruidosos" comparten celda: `statement_timeout` por petición, límites de tasa por tenant y cuotas en el plano de control.
- Los backups son por celda; restaurar una sola tienda requiere exportación lógica filtrada por `tenant_id` (procedimiento a diseñar en R8).
