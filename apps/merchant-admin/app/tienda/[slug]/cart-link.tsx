'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cartCount, readCart } from '@/lib/cart';
import { useStoreBase } from '@/lib/store-base';

export function CartLink({ slug }: { slug: string }) {
  const [n, setN] = useState(0);
  const base = useStoreBase();
  useEffect(() => {
    const update = () => setN(cartCount(readCart(slug)));
    update();
    window.addEventListener('mc-cart', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('mc-cart', update); window.removeEventListener('storage', update); };
  }, [slug]);
  return (
    <Link href={`${base}/carrito`} className="relative inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium hover:bg-surface-2"
      aria-label={`Carrito, ${n} ${n === 1 ? 'artículo' : 'artículos'}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 7h14l-1.2 10.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" /><path d="M9 7a3 3 0 0 1 6 0" />
      </svg>
      Carrito
      {n > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-xs text-accent-fg" data-testid="cart-count">{n}</span>}
    </Link>
  );
}
