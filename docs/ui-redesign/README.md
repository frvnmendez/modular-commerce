# Rediseño del panel del comerciante (2026-11-15)

Solo interfaz: no añade funciones de comercio ni datos simulados (R2 sigue congelado para la validación de mercado).

## Diagnóstico de la versión anterior

1. **Sin identidad**: ni marca ni iconos; menú solo de texto; selector de tienda como `<select>` nativo.
2. **Jerarquía débil**: la barra superior destacaba la URL; las páginas no tenían cabecera con acciones; los botones rojos de "Quitar" pesaban más que el contenido.
3. **Inicio vacío**: 3 de 4 pasos decían "Disponible en la próxima versión", sin progreso ni estado de la tienda.
4. **Estados vacíos mudos**: una caja punteada con una frase; no explicaban qué habrá en la sección.
5. **Formularios largos**: onboarding con 11 campos en una página; ajustes sin aviso de cambios sin guardar; en móvil el menú empujaba la página.

## Patrones tomados del admin de Shopify (con aspecto propio)

Fuente: guías públicas de diseño de Shopify ([layout](https://shopify.dev/docs/apps/design-guidelines/layout), [navegación](https://shopify.dev/docs/apps/design-guidelines/navigation), [listado de recursos](https://shopify.dev/docs/api/app-home/patterns/templates/resource-index.md)). No se copia su marca, logotipos, colores ni recursos gráficos: paleta propia "tinta + cobalto", marca e iconos propios.

| Patrón | Dónde |
|---|---|
| Estructura de app: barra superior oscura (marca, búsqueda, tienda/cuenta) y barra lateral con iconos y grupos | `app/stores/[storeId]/layout.tsx` |
| Cabecera de página: título, estado y **una** acción principal | `PageHeader` en `components/ui.tsx` |
| Guía de configuración con progreso y pasos desplegables | `app/stores/[storeId]/page.tsx` |
| Estado vacío con ilustración, explicación y vista previa de la tabla | `app/stores/[storeId]/[section]/page.tsx` |
| Listado tipo tabla con avatar, etiqueta de rol y acciones terciarias en la última columna | `app/stores/[storeId]/team/page.tsx` |
| Ajustes en dos columnas (título/descripción a la izquierda) y barra de "cambios sin guardar" | `app/stores/[storeId]/settings/page.tsx` |
| Onboarding por pasos con tarjetas seleccionables | `app/onboarding/page.tsx` |
| Rejilla de 4 px, contenido siempre dentro de tarjetas, un único color de acción | `app/globals.css` |

Extras: búsqueda rápida entre secciones (Ctrl/⌘+K, solo navega), menú lateral deslizante en móvil, actividad agrupada por día, modo oscuro mantenido.

## Capturas

`antes/` y `despues/`, tomadas con la demo local (`/mnt/project-files/modular-commerce/demo-local/`) a 1280×800 y 390×844.
