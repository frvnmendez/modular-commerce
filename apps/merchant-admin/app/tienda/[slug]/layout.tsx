import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { storefrontGet, type PublicStore } from '@/lib/storefront-server';
import { CartLink } from './cart-link';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = await storefrontGet<PublicStore>(`/public/stores/${encodeURIComponent(slug)}`);
  return { title: s?.name ?? 'Tienda', description: s ? `Compra en ${s.name}` : undefined };
}

/** Escaparate público de una tienda. Solo existe si la tienda está activa y publicada. */
export default async function StorefrontLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await storefrontGet<PublicStore>(`/public/stores/${encodeURIComponent(slug)}`);
  if (!store) notFound();
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href={`/tienda/${store.slug}`} className="truncate text-lg font-semibold tracking-tight">{store.name}</Link>
          <CartLink slug={store.slug} />
        </div>
      </header>
      {store.freeShippingThreshold !== null && (
        <p className="bg-ink px-4 py-2 text-center text-xs text-ink-text">
          Envío gratis a partir de {new Intl.NumberFormat('es-ES', { style: 'currency', currency: store.currency }).format(store.freeShippingThreshold / 100)}
        </p>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="border-t border-border bg-surface-2">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted sm:px-6">
          <span>© {new Date().getFullYear()} {store.name}{store.contactEmail ? <> · <a className="hover:underline" href={`mailto:${store.contactEmail}`}>{store.contactEmail}</a></> : null}</span>
          <span>Pago seguro con tarjeta</span>
        </div>
      </footer>
    </div>
  );
}
