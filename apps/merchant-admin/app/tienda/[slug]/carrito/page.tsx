'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, humanError } from '@/lib/api';
import { readCart, writeCart, MAX_PER_ITEM, type CartItem } from '@/lib/cart';
import { formatMoney } from '@/lib/money';
import { useStoreBase } from '@/lib/store-base';
import { splitSlug } from '@/lib/slug';

type Store = { name: string; currency: string; country: string; shippingFlatAmount: number; freeShippingThreshold: number | null; acceptsPayments: boolean };
const input = 'h-11 w-full rounded-[10px] border border-border-strong bg-surface px-3 text-sm outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]';

export default function Cart({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = splitSlug(use(params).slug);
  const [items, setItems] = useState<CartItem[] | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = useStoreBase();
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    setItems(readCart(slug));
    setCancelled(new URLSearchParams(window.location.search).has('cancelado'));
    api<Store>(`/public/stores/${slug}`).then(setStore).catch((e) => setError(humanError(e)));
  }, [slug]);

  const update = (next: CartItem[]) => { setItems(next); writeCart(slug, next); };
  if (!items || !store) return <p className="text-muted" role="status">{error ?? 'Cargando carrito…'}</p>;

  const subtotal = items.reduce((a, i) => a + i.price * i.quantity, 0);
  const shipping = store.freeShippingThreshold !== null && subtotal >= store.freeShippingThreshold ? 0 : store.shippingFlatAmount;
  const money = (c: number) => formatMoney(c, store.currency);

  async function checkout(f: FormData) {
    setError(null); setBusy(true);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    try {
      const r = await api<{ redirectUrl: string }>(`/public/stores/${slug}/checkout`, { method: 'POST', body: {
        lines: items!.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
        customer: {
          email: s('email'), name: s('name'), ...(s('phone') ? { phone: s('phone') } : {}),
          address: { line1: s('line1'), ...(s('line2') ? { line2: s('line2') } : {}), city: s('city'), postalCode: s('postalCode'), ...(s('province') ? { province: s('province') } : {}) },
        },
      } });
      window.location.assign(r.redirectUrl);
    } catch (e) { setError(humanError(e)); setBusy(false); }
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Tu carrito está vacío</h1>
        <Link href={base || '/'} className="mt-6 inline-flex h-11 items-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-fg">Ver productos</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Carrito</h1>
        {cancelled && <p className="mb-4 rounded-[10px] bg-warning-soft px-4 py-3 text-sm">No se completó el pago. Tu carrito sigue aquí por si quieres intentarlo de nuevo.</p>}
        <ul className="divide-y divide-border border-y border-border">
          {items.map((i) => (
            <li key={i.variantId} className="flex gap-4 py-4">
              {i.image
                ? <img src={`/media/${i.image}`} alt="" className="size-20 shrink-0 rounded-[10px] object-cover" />
                : <span className="size-20 shrink-0 rounded-[10px] bg-surface-3" />}
              <div className="min-w-0 flex-1">
                <Link href={`${base}/producto/${i.handle}`} className="font-medium hover:underline">{i.productTitle}</Link>
                <p className="text-sm text-muted">{i.variantTitle}</p>
                <div className="mt-2 flex items-center gap-3">
                  <label className="sr-only" htmlFor={`q-${i.variantId}`}>Cantidad de {i.productTitle}</label>
                  <select id={`q-${i.variantId}`} value={i.quantity} className="h-9 rounded-full border border-border-strong bg-surface px-3 text-sm"
                    onChange={(e) => update(items.map((x) => (x.variantId === i.variantId ? { ...x, quantity: Number(e.target.value) } : x)))}>
                    {Array.from({ length: Math.min(i.max, MAX_PER_ITEM) }, (_, n) => n + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button type="button" className="text-sm text-muted underline hover:text-text" onClick={() => update(items.filter((x) => x.variantId !== i.variantId))}>Quitar</button>
                </div>
              </div>
              <p className="shrink-0 text-sm tabular-nums">{money(i.price * i.quantity)}</p>
            </li>
          ))}
        </ul>
        <dl className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Productos</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Envío</dt><dd className="tabular-nums">{shipping ? money(shipping) : 'Gratis'}</dd></div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="cart-total">{money(subtotal + shipping)}</dd></div>
          <p className="text-xs text-muted">IVA incluido.</p>
        </dl>
      </section>

      <section className="rounded-card bg-surface-2 p-5 lg:self-start">
        <h2 className="text-lg font-semibold">Datos de envío</h2>
        <form action={checkout} className="mt-4 space-y-3">
          <input className={input} name="email" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" />
          <input className={input} name="name" required autoComplete="name" placeholder="Nombre y apellidos" aria-label="Nombre y apellidos" maxLength={200} />
          <input className={input} name="line1" required autoComplete="address-line1" placeholder="Dirección" aria-label="Dirección" maxLength={200} />
          <input className={input} name="line2" autoComplete="address-line2" placeholder="Piso, puerta (opcional)" aria-label="Piso, puerta" maxLength={200} />
          <div className="grid grid-cols-[1fr_1.4fr] gap-3">
            <input className={input} name="postalCode" required autoComplete="postal-code" placeholder="Código postal" aria-label="Código postal" minLength={3} maxLength={12} />
            <input className={input} name="city" required autoComplete="address-level2" placeholder="Ciudad" aria-label="Ciudad" maxLength={100} />
          </div>
          <input className={input} name="province" autoComplete="address-level1" placeholder="Provincia (opcional)" aria-label="Provincia" maxLength={100} />
          <input className={input} name="phone" type="tel" autoComplete="tel" placeholder="Teléfono (opcional)" aria-label="Teléfono" maxLength={40} />
          <p className="text-xs text-muted">Enviamos solo a {new Intl.DisplayNames(['es'], { type: 'region' }).of(store.country) ?? store.country}.</p>
          {error && <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-sm">{error}</p>}
          {!store.acceptsPayments && <p role="alert" className="rounded-[10px] bg-warning-soft px-3 py-2 text-sm">Esta tienda todavía no acepta pedidos.</p>}
          <button type="submit" disabled={busy || !store.acceptsPayments} className="h-12 w-full rounded-full bg-accent text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60">
            {busy ? 'Preparando el pago…' : `Pagar ${money(subtotal + shipping)}`}
          </button>
          <p className="text-center text-xs text-muted">Pagarás en una página segura de pago. El importe final se confirma allí.</p>
        </form>
      </section>
    </div>
  );
}
