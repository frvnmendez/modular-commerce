'use client';
import { useState } from 'react';
import Link from 'next/link';
import { addToCart, MAX_PER_ITEM } from '@/lib/cart';
import { formatMoney } from '@/lib/money';
import type { PublicProduct } from '@/lib/storefront-server';

export function AddToCart({ slug, currency, product }: { slug: string; currency: string; product: PublicProduct }) {
  const firstAvailable = product.variants.find((v) => v.available > 0) ?? product.variants[0];
  const [variantId, setVariantId] = useState(firstAvailable?.id ?? '');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const v = product.variants.find((x) => x.id === variantId);
  if (!v) return null;
  const max = Math.min(v.available, MAX_PER_ITEM);

  return (
    <div className="mt-3">
      <p className="flex items-baseline gap-2 text-xl">
        <span data-testid="price">{formatMoney(v.price, currency)}</span>
        {v.compareAt && <s className="text-base text-muted">{formatMoney(v.compareAt, currency)}</s>}
      </p>
      <p className="mt-1 text-xs text-muted">IVA incluido. Gastos de envío calculados en el carrito.</p>
      {product.variants.length > 1 && (
        <fieldset className="mt-6">
          <legend className="mb-2 text-sm font-medium">Opción</legend>
          <div className="flex flex-wrap gap-2">
            {product.variants.map((x) => (
              <button key={x.id} type="button" onClick={() => { setVariantId(x.id); setQty(1); setAdded(false); }} aria-pressed={x.id === variantId}
                disabled={x.available === 0}
                className={`min-w-12 rounded-full border px-4 py-2 text-sm ${x.id === variantId ? 'border-text bg-text text-surface' : 'border-border-strong hover:border-text'} disabled:cursor-not-allowed disabled:line-through disabled:opacity-40`}>
                {x.title}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {max > 0 ? (
        <div className="mt-6 flex gap-3">
          <label className="sr-only" htmlFor="qty">Cantidad</label>
          <select id="qty" value={qty} onChange={(e) => setQty(Number(e.target.value))} className="h-12 rounded-full border border-border-strong bg-surface px-4 text-sm">
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button type="button" className="h-12 flex-1 rounded-full bg-accent px-6 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
            onClick={() => {
              addToCart(slug, { variantId: v.id, handle: product.handle, productTitle: product.title, variantTitle: v.title, price: v.price, image: product.images[0] ?? null, quantity: qty, max });
              setAdded(true);
            }}>Añadir al carrito</button>
        </div>
      ) : <p className="mt-6 rounded-full bg-surface-3 px-4 py-3 text-center text-sm font-medium">Agotado</p>}
      {added && (
        <p role="status" className="mc-pop mt-3 text-sm">Añadido. <Link href={`/tienda/${slug}/carrito`} className="font-medium text-accent-text underline">Ver carrito y pagar</Link></p>
      )}
    </div>
  );
}
