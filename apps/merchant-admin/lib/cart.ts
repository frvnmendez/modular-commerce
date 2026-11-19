'use client';
/** Carrito del comprador, por tienda, en el navegador. Los precios son orientativos: el pedido los recalcula en la BD. */
export type CartItem = { variantId: string; handle: string; productTitle: string; variantTitle: string; price: number; image: string | null; quantity: number; max: number };

const key = (slug: string) => `mc-cart:${slug}`;
export const MAX_PER_ITEM = 20;

export function readCart(slug: string): CartItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(slug)) ?? '[]');
    return Array.isArray(v) ? v.filter((i) => i && typeof i.variantId === 'string' && Number.isInteger(i.quantity)) : [];
  } catch { return []; }
}

export function writeCart(slug: string, items: CartItem[]) {
  try { localStorage.setItem(key(slug), JSON.stringify(items)); } catch { /* sin almacenamiento: el carrito vive solo en esta página */ }
  window.dispatchEvent(new CustomEvent('mc-cart', { detail: slug }));
}

export function addToCart(slug: string, item: CartItem) {
  const items = readCart(slug);
  const found = items.find((i) => i.variantId === item.variantId);
  if (found) found.quantity = Math.min(found.quantity + item.quantity, item.max, MAX_PER_ITEM);
  else items.push({ ...item, quantity: Math.min(item.quantity, item.max, MAX_PER_ITEM) });
  writeCart(slug, items);
}

export const cartCount = (items: CartItem[]) => items.reduce((a, i) => a + i.quantity, 0);
