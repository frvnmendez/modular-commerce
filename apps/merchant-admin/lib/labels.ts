export const CAP_LABEL: Record<string, string> = {
  'physical-products': 'Productos físicos', 'digital-products': 'Productos digitales', inventory: 'Inventario propio',
  variants: 'Variantes (tallas, colores…)', shipping: 'Envíos', international: 'Venta internacional', dropshipping: 'Dropshipping', returns: 'Devoluciones',
};

export const region = (code: string) => { try { return new Intl.DisplayNames(['es'], { type: 'region' }).of(code) ?? code; } catch { return code; } };
