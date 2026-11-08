# Modelo de seguridad (threat model inicial)

Actores: comprador anónimo, cliente registrado, staff de tienda (roles), propietario de tienda, desarrollador de extensión, extensión instalada, operador de plataforma, atacante externo.

Activos: datos personales de clientes, pedidos y pagos, secretos de tiendas y módulos, configuración y temas, credenciales de staff, facturación SaaS.

| Amenaza | Vector | Control previsto | Verificación |
|---|---|---|---|
| IDOR/BOLA | Cambiar IDs en ruta/body | RLS + tenant de sesión + 404 | Suite de aislamiento (PoC A) |
| Escalada de privilegios | Staff se asigna rol superior | RBAC en servicio; solo owner gestiona roles; auditoría | Tests de autorización R1 |
| Fuga entre tenants | Caché, S3, jobs, logs | Prefijos, contexto en jobs, logs sin PII | Suite R2 |
| Inyección SQL | Entrada sin parametrizar | ORM, lint, revisión | SAST + DAST |
| XSS | Contenido de tienda, bloques | Sin HTML libre; escape por defecto de React; CSP estricta en storefront | Tests + CSP report |
| CSRF | Formularios del admin | Cookies SameSite=Lax + token CSRF en mutaciones | Tests |
| SSRF | URLs de módulos, importación de imágenes | Allowlist de esquemas, bloqueo de IPs privadas y metadatos, egress proxy | Tests negativos |
| Webhooks falsos / repetición | Firmas ausentes | HMAC con timestamp, ventana 5 min, `event_id` único | Tests de contrato |
| Secretos filtrados | Logs, respuestas API | Cifrado envelope, nunca devueltos, redacción en logs | PoC D (auditoría sin secretos) |
| Cadena de suministro | Dependencia comprometida | Lockfile, `pnpm audit`, Renovate con revisión, mínimas dependencias | CI |
| Módulo malicioso | Exfiltración, abuso | Fuera de proceso, scopes, cuotas, revocación, PII solo oficiales | PoC D |
| Abuso de consumo | Bots, scraping | Rate-limit por IP y tenant; cuotas | R8 |
| Race conditions / doble pedido | Reintentos concurrentes | Idempotency keys, `FOR UPDATE`, unicidad por tenant | PoC A |
| Manipulación de precios | Cliente envía precio | Precio y total siempre recalculados en servidor | PoC A |
| Fraude de cupones | Reutilización, apilamiento | Límites de uso transaccionales, reglas de combinación | R2 |
| Toma de cuenta | Credenciales robadas | Hash fuerte, rate-limit de login, 2FA para staff (R1 opcional, R8 obligatorio para owners) | R1 |

Ninguna vulnerabilidad crítica o alta abierta puede superar el Gate E.
