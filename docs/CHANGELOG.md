# Changelog

## [Hito 2] 2026-11-19 — Probado localmente (sin desplegar)
- Stripe Connect: cada tienda conecta su cuenta Express desde *Ajustes → Cobros* y cobra con cargos con destino (`transfer_data` + `on_behalf_of`) y comisión opcional de la plataforma (`PLATFORM_FEE_BP`). El estado «puede cobrar» solo lo escribe la BD con datos leídos de Stripe (`payments.update_account`); el pedido guarda la cuenta y `attach_payment_session` exige que sea la de su tienda. Reembolsos con `reverse_transfer` y `refund_application_fee`. Webhook `account.updated` con secreto propio.
- Subdominios `<tienda>.PLATFORM_DOMAIN` (`proxy.ts` del panel): en el subdominio solo existe la tienda; las rutas del panel redirigen al dominio principal. La API admite el origen de la tienda solo en `/public`. `/internal/tls-check` para certificados HTTPS bajo demanda en Caddy. Nombres reservados (`www`, `admin`, `api`…).
- Emails reales por SMTP (nodemailer) con plantilla HTML escapada; los de una tienda salen con su nombre desde la dirección de la plataforma; aviso de «pedido enviado» al comprador.
- Diseño de la tienda: logo, color principal (con contraste automático), portada, titular y subtítulo.
- Pruebas: 84 de API (16 nuevas), 25 de aislamiento (matriz ampliada) y 18 E2E (4 nuevos con la tienda en su subdominio).

## [Hito 1] 2026-11-15 — Probado localmente (sin desplegar)
- Núcleo de venta (migración 0011): productos con opciones, precio en céntimos, stock, fotos; ajustes de venta (publicar tienda, envío fijo y gratis desde, IVA, email de avisos); clientes, pedidos con numeración por tienda y reserva de stock de 32 min; moneda bloqueada en cuanto hay productos.
- Contexto v2: roles `mc_storefront` y `mc_payments` sin permisos sobre tablas, solo `EXECUTE` en funciones `SECURITY DEFINER` con `search_path` fijado. `mc_app` ya no puede crear pedidos ni marcarlos como pagados; solo `payments.mark_paid` comprueba proveedor, sesión, importe y moneda. Transiciones de estado vigiladas por trigger.
- Pagos: Stripe Checkout por REST (sin SDK) con claves de idempotencia, avisos firmados (HMAC, 5 min) e idempotentes, pago tardío → reembolso automático, reembolsos desde el panel. Pago simulado para desarrollo, prohibido en producción. Claves reales exigen `ALLOW_LIVE_PAYMENTS=1`.
- API: catálogo, fotos (bytes mágicos, 5 MB, máx. 10), pedidos (enviar, cancelar, reembolsar), tienda pública (`/public/stores/:slug/...`), límite por IP en compra y lectura pública.
- Panel: productos (lista y editor con fotos y opciones), pedidos (pestañas y detalle), ajustes de venta, guía de inicio con pasos reales. Tienda pública en `/tienda/<slug>`: catálogo, producto, carrito, pago y página del pedido.
- Pruebas: 68 de API, 25 de aislamiento (incluida la venta entre tiendas) y E2E `r2-tienda.spec.ts` con el recorrido completo en navegador. Guía de despliegue en VPS: `docs/DEPLOYMENT-VPS.md`.

## [R1] 2026-11-08 — Probado localmente
- Segunda revisión del PR #1: el panel se niega a arrancar en producción con `next start` (se saltaba la normalización de IP); las invitaciones guardadas son una lista (dos pestañas se retoman las dos) y solo se borran ante errores definitivos; botón para cambiar de cuenta cuando la invitación es para otro email; pruebas de identidad en BD, de caducidad en servidor y 4 E2E nuevos.
- Revisión del PR #1: `accept_invitation` toma el email verificado de la BD (0009), la invitación se retoma tras iniciar sesión o verificar el email, cadena de confianza de IP panel → API (`server.mjs`, `TRUST_PROXY`, `PANEL_TRUST_PROXY`), E2E con Playwright en CI y controles negativos que verifican el motivo del fallo.
- Monorepo pnpm + Turborepo, TypeScript 5.9 con ejecución nativa de Node 22, ESLint con reglas que prohíben fijar el contexto de tenant fuera de `@mc/db`.
- Base de datos: roles separados (`mc_migrator`, `mc_app`, `mc_auth`, `mc_ops`), esquemas `control`/`commerce`/`auth`, RLS ENABLE+FORCE en toda tabla, funciones `SECURITY DEFINER` con `search_path` fijado, migraciones con checksum.
- Identidad con Better Auth 1.7: registro con verificación de email obligatoria, cookies HttpOnly/SameSite=Lax, límite de intentos.
- API: organizaciones, tiendas con perfil de negocio → capacidades, invitaciones de un solo uso (hash sha256), roles owner/admin/staff, protección del último owner, auditoría, panel de plataforma auditado.
- Panel del comerciante (Next.js 16): acceso, onboarding de 8 preguntas, navegación por capacidades, equipo, actividad, ajustes, aceptación de invitaciones, vista de plataforma.
- Suite de aislamiento entre tiendas sobre BD desechable con 3 controles negativos (rls-off, permissive, membership) que la hacen fallar; CI de GitHub Actions.
- Revisión del Red Team (NO-GO → GO con condiciones): contexto de tenant no forjable (`request_context` + token de sesión), límite de intentos por IP real, último owner bajo concurrencia, revocación de invitaciones, reset que cierra sesiones, políticas RLS con InitPlan.
- ADR-0002 a ADR-0005 aceptados; ADR-0001 pendiente del spike de 3 días antes de R2.

## [R0] 2026-11-08
- Investigación de motores comerciales, herramientas y editores (fuentes verificadas).
- PoC A: aislamiento PostgreSQL RLS (15 tests + control negativo).
- PoC B: canales de Vendure 3.8.1 (fuga de datos de clientes entre tiendas reproducida).
- PoC C: huella de Medusa 2.18.0.
- PoC D: manifiesto y ciclo de vida de módulos (19 tests).
- ADRs 0001–0005 propuestos, arquitectura, especificación de módulos, riesgos, seguridad, costes, plan maestro.
