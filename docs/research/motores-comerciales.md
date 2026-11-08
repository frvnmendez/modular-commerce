# Motores comerciales: evaluación para Release 0

> Rol: Commerce Engine Architect. Fecha de investigación: **2026-11-08**. Todas las fuentes se consultaron ese día.
> Convención: **[V]** = hecho verificado con la URL citada. **[J]** = juicio o inferencia del autor. **no verificado** = no se pudo confirmar.
> Contexto del caso: stack TypeScript, aislamiento estricto entre tenants, módulos de terceros fuera de proceso, equipo pequeño y SaaS comercial alojado.

## 0. Resumen ejecutivo

- **[J]** Ninguno de los cuatro motores trae una multi-tenencia con **límite de seguridad real**. Los cuatro ofrecen "canales" o "tiendas" dentro de una única base de datos, y el aislamiento depende de roles y filtros a nivel de aplicación. El aislamiento estricto tendremos que construirlo nosotros, sea cual sea el motor.
- **[J]** Saleor tiene el mejor modelo de extensión fuera de proceso (apps más webhooks síncronos y asíncronos), pero está en Python/Django. Medusa v2 y Vendure son TypeScript, pero se extienden dentro del proceso.
- **[J] Recomendación:** construir una **capa de plataforma propia en TypeScript**, que se encargue de tenants, identidad, aislamiento y apps fuera de proceso, y usar **Medusa v2 (núcleo MIT)** como motor de módulos comerciales, con un despliegue en *celdas* (base de datos por tenant o por grupo de tenants). El contrato de apps se copia del modelo de Saleor. Vendure queda como alternativa si se acepta la GPLv3. Detalle en las secciones 7 y 8.

## 1. Vendure

**Repositorio:** github.com/vendure-ecommerce/vendure. La página que se muestra es `github.com/vendurehq/vendure` (og:url), así que **[V]** el repositorio parece haberse trasladado a la organización `vendurehq`. No se verificó si hay una redirección. Fuente: https://github.com/vendure-ecommerce/vendure

### Licencia y restricciones para un SaaS multi-tenant alojado
- **[V]** Doble licencia: GPLv3 (Community) o Vendure Commercial License (VCL). *"The default Vendure license, without a valid Vendure Commercial License agreement, is the Open-Source GPLv3 license."* Fuente: https://github.com/vendure-ecommerce/vendure/blob/master/LICENSE.md
- **[V]** En npm, `@vendure/core@3.8.1` declara `GPL-3.0-or-later`. Fuente: https://registry.npmjs.org/@vendure/core
- **[V]** El cambio se anunció el 19-jun-2024. En v3 la licencia pasa de MIT a GPLv3 y v2.3 es la última versión MIT. El anuncio avisa de que el modelo *"may introduce fees for certain types of commercial use"*, en especial para *"those offering SaaS solutions based on Vendure"*. Fuente: https://vendure.io/blog/license-change-announcement
- **[V]** Excepción de plugins (sección 7 de la GPL). Un "Plugin" es un módulo que añade funcionalidad usando las APIs expuestas de Vendure y que no incluye código fuente del Framework. Si se **distribuye por separado**, puede enlazar con el Framework y tener cualquier licencia, incluso propietaria. Los cambios en el Framework siguen bajo GPL. Fuente: https://raw.githubusercontent.com/vendurehq/vendure/HEAD/license/plugin-exception.txt
- **[V]** El FAQ de licencias dice tres cosas. Los plugins propios no tienen que ser GPL (*"No."*). Las modificaciones del Framework deben publicarse bajo GPLv3. Y *"The GPL does not consider viewing a web site to count as 'distributing'."* El FAQ **no menciona SaaS de forma explícita**. Fuente: https://raw.githubusercontent.com/vendurehq/vendure/HEAD/license/license-faq.md
- **[V]** La página de precios ofrece el Framework gratis bajo GPLv3. Los planes de pago (Starter 199 €/mes, Growth 599 €/mes, Scale 2.499 €/mes, Enterprise desde 60.000 €/año) incluyen "commercial licence" y capacidades B2B. La página **no dice cuándo es obligatoria** la licencia comercial ni habla de SaaS o multi-tenant. Fuente: https://www.vendure.io/pricing
- **[J] Interpretación (no es asesoría legal):** según la GPLv3 y el FAQ, alojar Vendure como SaaS **sin distribuirlo** no obliga a publicar el código, y los plugins propietarios están permitidos. Hay tres riesgos:
  1. Si parcheamos el core y alguna vez lo distribuimos (por ejemplo, on-premise para un cliente), esos parches deben ser GPL.
  2. Si entregamos a terceros un SDK o una imagen que incluya el core, eso es distribución.
  3. El propio anuncio adelanta posibles tarifas para SaaS.
  
  Hay que pedir confirmación por escrito a Vendure GmbH (contact@vendure.io) antes de comprometerse.
- **no verificado:** la licencia de `@vendure/dashboard@3.8.1`. En npm el campo `license` está vacío. Fuente: https://registry.npmjs.org/@vendure/dashboard

### Mantenimiento
- **[V]** `latest` = **3.8.1**, publicada el **2026-10-23**. Hay builds nocturnos `3.8.2-master-*` y `3.9.0-minor-*` casi a diario hasta el 2026-11-07. Fuente: https://registry.npmjs.org/@vendure/core
- **[V]** Versiones recientes: v3.8.1 (23-oct), v3.8.0 (12-oct), v3.7.4 (05-oct), v3.7.3 (02-sep). La página no muestra el año. Fuente: https://github.com/vendurehq/vendure/releases
- **[V]** 8,5k estrellas, 1,5k forks y 9.108 commits en master. Fuente: https://github.com/vendure-ecommerce/vendure

### Arquitectura, APIs y ecosistema
- **[V]** *"Open-source headless commerce platform built with TypeScript, NestJS, React, and GraphQL"*. Canales: *"Multi-channel, multi-region, multi-currency and multi-language from one instance"*. Fuente: https://github.com/vendure-ecommerce/vendure
- **[V]** El paquete `@vendure/payments-plugin` (3.5.6, GPL-3.0-or-later) tiene un aviso de deprecación: pasa a `@vendure-community/payments-plugin`. Fuente: https://registry.npmjs.org/@vendure/payments-plugin
- **no verificado:** el detalle de la integración con Stripe y de la idempotencia de pagos en Vendure. No se leyó la documentación del plugin.
- **[J]** La API es GraphQL (Shop y Admin). Los plugins son módulos NestJS que se ejecutan **dentro del proceso**, sin modelo nativo de apps fuera de proceso. Inventario y pedidos son maduros, con máquina de estados de pedido configurable (**no verificado** en esta sesión).

### Multi-tenencia y aislamiento
- **[V]** Vendure propone multi-tenencia con **una base de datos y un backend**: un canal por tenant, un rol por administrador de tenant y el token en la cabecera `vendure-token`. Impuestos, zonas y países son globales. Un cliente con el mismo email es **una sola entidad compartida** entre canales. *"a tenant administrator will not know of any other channels"* si los permisos están bien configurados. Fuente: https://vendure.io/blog/multi-tenant-commerce-with-vendure
- **[V]** El canal por defecto *"contains all entities"*. La documentación de canales describe el alcance de datos, pero no lo presenta como límite de seguridad. Fuente: https://docs.vendure.io/current/core/core-concepts/channels.md
- **[J]** Los canales son una partición lógica, no un límite de seguridad. Un error en un plugin o en un rol expone datos de otros tenants. Tampoco hay RLS ni bases de datos separadas.

## 2. Medusa (v2)

### Licencia
- **[V]** El LICENSE del repositorio es MIT (*"Copyright (c) 2021 Medusajs"*), **salvo** los materiales Enterprise Edition señalados en `ENTERPRISE-LICENSE.md`. Fuente: https://github.com/medusajs/medusa/blob/develop/LICENSE
- **[V]** Enterprise Edition = **RBAC y SSO (OIDC)**. Requiere *"a separate, valid commercial agreement with MedusaJS, Inc."*. Activar un feature flag Enterprise *"constitutes a representation that you hold a valid commercial agreement"*. Siguen siendo MIT la autenticación genérica, la gestión de usuarios e invitaciones y la infraestructura HTTP y de workflows. Rutas cubiertas, entre otras: `packages/modules/rbac/`, `packages/core/framework/src/policies/`, `packages/modules/providers/auth-oidc/`. Fuente: https://github.com/medusajs/medusa/blob/develop/ENTERPRISE-LICENSE.md
- **[V]** En npm, `@medusajs/medusa@2.22.4` declara `"SEE LICENSE IN LICENSE"`. `@medusajs/payment-stripe`, `@medusajs/workflow-engine-redis` y `@medusajs/index` (2.22.4) declaran MIT. Fuentes: https://registry.npmjs.org/@medusajs/medusa, https://registry.npmjs.org/@medusajs/payment-stripe
- **[V] (dato aportado por el coordinador desde el tarball 2.22.4, no comprobado por mí):** `dist/commands/utils/license-check.js` envía una clave de licencia configurada a `https://api.prod.medusajs.cloud/v1/license/check` al arrancar, y solo aborta si hay una clave configurada y es rechazada.
- **[J]** Los módulos comerciales del core (producto, carrito, pedido, inventario, pagos) siguen siendo MIT y sirven para un SaaS. Pero **RBAC y SSO del admin no se pueden usar sin contrato**, y para un SaaS multi-tenant los necesitaríamos. Conclusión: construimos RBAC y SSO propios en nuestra capa de plataforma, o pagamos. Hay además un riesgo de deriva *open-core*: más funcionalidades podrían pasar a EE en el futuro.

### Mantenimiento
- **[V]** `latest` = **2.22.4**, publicada el **2026-11-06**. Antes salieron 2.22.3 (2026-11-04) y 2.22.2 (2026-10-30). Cadencia de varias versiones por semana. Fuente: https://registry.npmjs.org/@medusajs/medusa
- **[V]** 36,5k estrellas, 5,3k forks, 10.919 commits en `develop`. Insignia "open-core". Fuente: https://github.com/medusajs/medusa

### Arquitectura, APIs y extensibilidad
- **[V]** Workflows formados por *steps* con compensación por paso y un motor de ejecución duradera integrado. Fuente: https://docs.medusajs.com/learn/fundamentals/workflows. El orquestador basado en Redis se publica como `@medusajs/workflow-engine-redis`. Fuente: https://registry.npmjs.org/@medusajs/workflow-engine-redis
- **[V]** Las APIs Store son REST y varias storefronts pueden conectarse a un servidor. El Sales Channel Module controla la disponibilidad de productos por canal. Fuente: https://docs.medusajs.com/resources/recipes/omnichannel
- **[V]** La receta de marketplace usa un módulo propio `Vendor` y "module links" (tablas pivote) hacia Product y Order, con un actor de autenticación `vendor`. El control de acceso se hace **en código de aplicación** filtrando por `actor_id`. No se describen restricciones a nivel de base de datos. Fuente: https://docs.medusajs.com/resources/recipes/marketplace/examples/vendors
- **[V]** Discusión #14835 (2-mar-2026, sin respuesta del equipo). Se critica que las compensaciones hay que escribirlas a mano, que no hay transacción entre steps y que existe riesgo de concurrencia en las comprobaciones de stock. Un tercero responde que hay que usar reservas o actualizaciones atómicas. Fuente: https://github.com/medusajs/medusa/discussions/14835
- **[J]** Los módulos y plugins se ejecutan **dentro del proceso** Node. No hay un modelo de apps de terceros fuera de proceso comparable al de Saleor. Habría que construirlo con suscriptores de eventos y webhooks salientes propios.

### Pagos
- **[V]** El proveedor de Stripe viene *"installed by default"* (`@medusajs/medusa/payment-stripe`). Expone el webhook `{server_url}/hooks/payment/{provider_id}` y soporta métodos locales y `automaticPaymentMethods`. La página **no menciona idempotencia**. Fuente: https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider/stripe

### Multi-tenencia
- **[V]** La discusión #12304 (28-abr-2025) pide multi-tenencia nativa (*"MedusaJS does not natively support multi-tenant architectures"*) y no tiene respuesta del equipo. Fuente: https://github.com/medusajs/medusa/discussions/12304
- **[V]** La discusión #4589 (24-jul-2023, "Support multiple stores") tiene 0 respuestas. Fuente: https://github.com/medusajs/medusa/discussions/4589
- **[J]** **No hay postura oficial verificada** sobre multi-tenencia. La vía realista es **una instancia (o base de datos) por tenant**, o un aislamiento propio por fila. Los módulos aislados de Medusa facilitan usarlo como librería detrás de nuestra capa de plataforma.

## 3. Saleor

### Licencia y mantenimiento
- **[V]** BSD-3-Clause. 23,4k estrellas, 6,1k forks, 22.687 commits en `main`. *"Saleor Core: the high performance, composable, headless commerce API."* Versión de producción 3.x. Fuente: https://github.com/saleor/saleor
- **[V]** Versiones más recientes: **3.23.45** y 3.22.76 (28-oct), 3.23.44 (20-oct). La página no muestra el año: **año no verificado**, aunque lo probable es 2026. 3.23.45 corrige errores de OIDC. Fuentes: https://github.com/saleor/saleor/releases, https://github.com/saleor/saleor/releases/tag/3.23.45
- **[V]** El paquete `saleor` en PyPI está congelado en 2.10.1 (2020), así que no sirve para medir el mantenimiento. Fuente: https://pypi.org/pypi/saleor/json
- **no verificado:** la cadencia de commits. La página de commits de GitHub se bloqueó por robots.

### Arquitectura y extensibilidad (la más relevante para nuestro diseño)
- **[J]** El core es Python/Django con API GraphQL. El repositorio contiene `pyproject.toml` y `manage.py` y tiene el tema "python" (**[V]** https://github.com/saleor/saleor).
- **[V]** Las apps se comunican de cuatro formas:
  1. Webhooks asíncronos: la app responde en 20 s como máximo y hay hasta 5 reintentos con backoff exponencial ante 5xx o timeout, pero no ante 4xx.
  2. Eventos **síncronos** para pagos, envíos e impuestos, en los que Saleor espera la respuesta.
  3. Llamadas de la app a la API GraphQL, con permisos de la app.
  4. Extensiones en el Dashboard mediante App Bridge.
  
  Fuente: https://docs.saleor.io/developer/extending/apps/architecture/communication-between-app-and-saleor.md
- **[V]** Transaction API para pagos. Eventos `PAYMENT_GATEWAY_INITIALIZE_SESSION`, `TRANSACTION_INITIALIZE_SESSION`, `TRANSACTION_PROCESS_SESSION` y `TRANSACTION_CHARGE/REFUND/CANCELATION_REQUESTED`. Requiere el permiso `HANDLE_PAYMENTS`. Usa `pspReference` y `transactionEventReport` para resultados asíncronos. Hay un `idempotencyKey` que debe pasarse al PSP. Fuente: https://docs.saleor.io/developer/extending/webhooks/synchronous-events/transaction.md
- **[V]** El repositorio `saleor/apps` incluye apps de Stripe, AvaTax, SMTP, Search, Segment, Klaviyo y otras (163 estrellas). Fuente: https://github.com/saleor/apps. `@saleor/app-sdk@1.17.0` (BSD-3-Clause, 2026-11-05) permite escribir apps en TypeScript. Fuente: https://registry.npmjs.org/@saleor/app-sdk
- **[J]** Es el mejor referente para nuestro contrato de "módulos de terceros fuera de proceso": permisos por app, webhooks síncronos con timeout, transacciones de pago delegadas en apps.

### Multi-canal y multi-tenencia
- **[V]** Los canales permiten *"serve customers and markets differently from a single backend instance"*. Un canal tiene una sola moneda. Disponibilidad, precio, almacenes y zonas de envío se definen por canal. *"Admin access to order data can be configured on a channel level"*, pero productos, vouchers y envíos pueden pertenecer a varios canales, así que no tienen permisos por canal. Fuente: https://docs.saleor.io/developer/channels/overview
- **[V]** La discusión #15699 (25-mar-2024) plantea un "Shopify-like" con django-tenants y no tiene ninguna respuesta. Fuente: https://github.com/saleor/saleor/discussions/15699
- **[J]** Los canales no son tenants. El SaaS habría que hacerlo con una instancia o base de datos por tenant, o con una adaptación de django-tenants, que es una bifurcación costosa. Además, el equipo tendría que mantener Python/Django, Celery y otras dependencias, lo que contradice el requisito TypeScript.

## 4. Bagisto

- **[V]** MIT. *"will always remain free under the MIT License"*. 28,2k estrellas, 3,3k forks. Se presenta como *"Open Source eCommerce & Multi-Vendor Marketplace Platform"* sobre Laravel. Fuente: https://github.com/bagisto/bagisto
- **[V]** Packagist: **v2.5.1** el **2026-11-06** (MIT), v2.5.0 el 2026-10-06. La rama 2.4.x-dev se actualizó el 2026-11-03. Fuente: https://repo.packagist.org/p2/bagisto/bagisto.json
- **[V]** El módulo SaaS es **de pago y de Webkul**: "Laravel e-Commerce Multi Company SaaS Module" cuesta **1.199 USD**, con licencia "Single application", compatible con Bagisto 2.4.x y con subdominio o dominio propio vía CNAME. Fuente: https://store.webkul.com/bagisto-laravel-ecommerce-multi-company-saas.html. Los complementos SaaS también se pagan aparte, por ejemplo la PWA (449 USD, https://bagisto.com/en/extensions/laravel-ecommerce-multi-tenant-saas-pwa) o el envío por producto (349 USD, https://store.webkul.com/amp/product/view/id/4005/).
- **[V]** Un moderador escribió hace unos 7 años: *"we have implemented multi-tenancy on single database architecture"*. Ese dato puede estar desactualizado. Fuente: https://webkul.com/blog/laravel-ecommerce-multi-tenant-saas-module/
- **[J]** Tiene tres problemas para nosotros: es PHP, el SaaS depende de un módulo propietario de un tercero con licencia por aplicación, y usa una base de datos compartida. Las extensiones son paquetes Laravel dentro del proceso. **Descartado** para nuestro caso.

## 5. Alternativas

- **[V]** EverShop: `@evershop/evershop@2.3.0` (2026-10-08), licencia GPL-3.0. Fuente: https://registry.npmjs.org/@evershop/evershop
- **[V]** Unchained Engine: `@unchainedshop/platform@4.9.0` (2026-10-28), licencia **EUPL-1.2**. Fuente: https://registry.npmjs.org/@unchainedshop/platform
- **[J]** Ninguna de las dos supera a Medusa o Vendure en ecosistema ni en multi-tenencia. EverShop tiene el mismo problema GPL que Vendure. La EUPL de Unchained es copyleft con cláusula de red, aunque **no verificado** cómo nos afectaría. No las considero creíbles como base principal.
- **[J] Core propio:** es viable si se limita el alcance (catálogo, carrito, checkout, pedidos, inventario básico y Stripe) y se diseña desde el inicio con `tenant_id`, RLS de Postgres y un contrato de apps. El coste es alto: impuestos, promociones, devoluciones y multi-moneda suman muchos meses-persona para un equipo pequeño. Es preferible un **híbrido**: el core de plataforma propio y los módulos comerciales MIT de Medusa como dependencia.

## 6. Comparativa transversal

| Aspecto | Vendure | Medusa v2 | Saleor | Bagisto |
|---|---|---|---|---|
| Licencia [V] | GPLv3 + VCL + excepción de plugins | MIT + EE propietaria (RBAC, SSO) | BSD-3 | MIT (módulo SaaS de pago) |
| Última versión [V] | 3.8.1 (2026-10-23) | 2.22.4 (2026-11-06) | 3.23.45 (28-oct, año no verificado) | 2.5.1 (2026-11-06) |
| Lenguaje | TS / NestJS [V] | TS [V] | Python / Django [J] | PHP / Laravel [V] |
| API | GraphQL [V] | REST [V] | GraphQL [V] | no verificado |
| Multi-tenencia nativa | Canales y roles en una BD [V] | No [V: sin postura oficial] | Canales, no tenants [V] | Módulo de pago, una BD [V, dato antiguo] |
| Límite de seguridad real | No [J] | No [J] | No [J] | No [J] |
| Extensión fuera de proceso | No (plugins en proceso) [J] | No (módulos en proceso) [J] | **Sí: apps y webhooks síncronos y asíncronos** [V] | No [J] |
| Stripe | Plugin comunitario [V], detalle no verificado | Integrado [V] | App oficial [V] | no verificado |
| Idempotencia de pagos | no verificado | No documentada en la página de Stripe [V] | `idempotencyKey` hacia el PSP [V] | no verificado |
| Complejidad operativa [J] | Media (Node, PG, workers) | Media (Node, PG, Redis) | Alta para un equipo TS (Python, Celery) | Media (PHP) |
| Lock-in [J] | Medio, con riesgo de tarifas SaaS | Medio, con riesgo de deriva open-core | Medio-bajo | Alto (Webkul) |

**Rendimiento:** no se encontraron benchmarks independientes verificables en esta sesión (**no verificado**). La única nota es la discusión #14835 de Medusa sobre concurrencia en workflows.

## 7. Matriz de decisión ponderada [J]

Escala de 1 a 5, donde 5 es lo mejor para nuestro caso. "Híbrido" = capa de plataforma propia en TS (tenants, IAM y RBAC, RLS o celdas, gateway de apps) más módulos comerciales MIT de Medusa v2.

| Criterio | Peso | Medusa | Vendure | Saleor | Bagisto | Core propio | Híbrido |
|---|---:|---:|---:|---:|---:|---:|---:|
| Licencia apta para SaaS comercial | 12 | 4 | 3 | 5 | 3 | 5 | 4 |
| Stack TypeScript | 13 | 5 | 5 | 2 | 1 | 5 | 5 |
| Aislamiento estricto de tenants (nativo o fácil de imponer) | 18 | 2 | 2 | 2 | 2 | 5 | 4 |
| Módulos de terceros fuera de proceso | 12 | 2 | 2 | 5 | 1 | 4 | 4 |
| Funcionalidad comercial lista (time-to-market) | 15 | 4 | 4 | 5 | 4 | 1 | 3 |
| Madurez y mantenimiento | 8 | 5 | 4 | 5 | 4 | 1 | 4 |
| Complejidad operativa y coste para equipo pequeño | 12 | 3 | 3 | 2 | 3 | 2 | 3 |
| Riesgo de lock-in (5 = bajo) | 10 | 3 | 3 | 3 | 2 | 5 | 4 |
| **Total ponderado (sobre 500)** | **100** | **339** | **319** | **351** | **245** | **360** | **386** |
| Nota media (sobre 5) | | 3,39 | 3,19 | 3,51 | 2,45 | 3,60 | 3,86 |

Cómo leer la matriz: Saleor supera a Medusa como motor "tal cual" por su modelo de apps, pero lo penaliza el requisito TypeScript. El core propio puntúa alto en aislamiento y lock-in, pero su time-to-market es pobre. El híbrido combina lo mejor de ambos, a cambio del coste de construir la capa de plataforma.

## 8. Recomendación [J]

1. **Base:** capa de plataforma propia en TypeScript, con Medusa v2 (solo módulos MIT, sin activar flags EE) como motor de dominio comercial: productos, carrito, pedidos, inventario, pagos y Stripe.
2. **Aislamiento:** empezar con un modelo de **celdas**: una base de datos Postgres por tenant, o por grupo pequeño de tenants con RLS como defensa en profundidad, y un proceso o contenedor Medusa por celda. Nunca depender de sales channels como frontera de seguridad.
3. **Extensiones fuera de proceso:** diseñar nuestro contrato de apps a imagen del de Saleor:
   - permisos por app y tokens por tenant;
   - webhooks asíncronos con reintentos y firma;
   - webhooks síncronos con timeout estricto para pagos, impuestos y envíos;
   - pagos delegados con `pspReference` e `idempotencyKey`.
4. **RBAC y SSO:** construirlos en la plataforma (no usar los de EE de Medusa), o negociar licencia EE si sale más barato.
5. **Plan B:** Vendure v3, si legal confirma por escrito que el SaaS con plugins propietarios no requiere VCL y no se planea distribuir el core.

**Riesgos principales:**
- **R1. Deriva open-core de Medusa:** más funcionalidades podrían pasar a EE. Además existe la comprobación de licencia contra medusajs.cloud. Mitigación: fijar versiones, vigilar `ENTERPRISE-LICENSE.md` y mantener la opción de fork MIT.
- **R2. Coste operativo de las celdas:** migraciones por base de datos, conexiones y coste por tenant inactivo. Mitigación: agrupar tenants pequeños con RLS y orquestar las migraciones.
- **R3. Concurrencia e idempotencia:** los workflows de Medusa no garantizan transacciones entre steps (#14835). Mitigación: reservas atómicas de stock y claves de idempotencia propias en checkout y webhooks de Stripe.
- **R4. Contrato de apps propio:** es diseño nuevo, con riesgo de seguridad (SSRF, fuga de datos en payloads). Requiere una revisión de seguridad específica.
- **R5. Cadencia alta de versiones** de Medusa (varias por semana): riesgo de cambios incompatibles. Mitigación: actualizaciones programadas y tests de contrato.

## 9. Preguntas abiertas

1. ¿Nos confirma Vendure GmbH por escrito si un SaaS multi-tenant con plugins propietarios, sin distribución, necesita VCL? ¿Qué cuesta la VCL para ese caso?
2. ¿Qué hace exactamente la comprobación de licencia de Medusa si no hay clave? ¿Envía telemetría? Falta revisar el código fuente.
3. ¿Planea MedusaJS mover a EE más módulos (por ejemplo, multi-store o índices)? ¿Tiene una hoja de ruta pública de multi-tenencia?
4. ¿Cuál es el presupuesto por tenant? Decide entre celda dedicada, pool con RLS o un esquema mixto por plan.
5. ¿Necesitamos distribuir el producto on-premise alguna vez? Eso afecta a GPL frente a MIT.
6. ¿Qué requisitos de cumplimiento aplican (PCI DSS SAQ-A, RGPD, residencia de datos por región)? Condicionan el diseño de celdas.
7. ¿Qué superficie mínima de API pública exponemos a las apps: GraphQL estilo Saleor o REST estilo Medusa?
8. ¿Cómo gestiona Medusa los webhooks duplicados de Stripe? No verificado: hay que probarlo en un spike.
9. Spike de rendimiento: ¿cuántos tenants o celdas por nodo, cuál es el coste de las migraciones y la latencia de los webhooks síncronos?
10. ¿Licencia de `@vendure/dashboard`? Tiene el campo vacío en npm.
