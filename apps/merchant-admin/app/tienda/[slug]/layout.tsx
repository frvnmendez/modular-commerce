import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { storefrontGet, type PublicStore } from '@/lib/storefront-server';
import { splitSlug } from '@/lib/slug';
import { StoreBaseProvider } from '@/lib/store-base';
import { CartLink } from './cart-link';

/** Variables de color de la marca de la tienda (texto blanco o negro según el contraste). */
function brandStyle(hex: string | null): React.CSSProperties | undefined {
  if (!hex || !/^#[0-9a-f]{6}$/.test(hex)) return undefined;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return {
    '--accent': hex, '--accent-hover': `color-mix(in srgb, ${hex} 85%, black)`, '--accent-fg': lum > 0.45 ? '#111111' : '#ffffff',
    '--accent-soft': `color-mix(in srgb, ${hex} 14%, transparent)`, '--accent-text': lum > 0.45 ? `color-mix(in srgb, ${hex} 55%, black)` : hex,
  } as React.CSSProperties;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = splitSlug((await params).slug);
  const s = await storefrontGet<PublicStore>(`/public/stores/${encodeURIComponent(slug)}`);
  return { title: s?.name ?? 'Tienda', description: s ? (s.tagline ?? `Compra en ${s.name}`) : undefined };
}

/** Escaparate público de una tienda. Solo existe si la tienda está activa y publicada. */
export default async function StorefrontLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug, base } = splitSlug((await params).slug);
  const store = await storefrontGet<PublicStore>(`/public/stores/${encodeURIComponent(slug)}`);
  if (!store) notFound();
  return (
    <StoreBaseProvider value={base}>
    <div className="flex min-h-dvh flex-col bg-surface" style={brandStyle(store.accentColor)}>
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href={base || '/'} className="flex min-w-0 items-center gap-3 text-lg font-semibold tracking-tight">
            {store.logo && <img src={`/media/${store.logo}`} alt="" className="h-9 w-auto max-w-[120px] shrink-0 object-contain" />}
            <span className="truncate">{store.name}</span>
          </Link>
          <CartLink slug={store.slug} />
        </div>
      </header>
      {!store.acceptsPayments && (
        <p role="status" className="bg-warning-soft px-4 py-2 text-center text-xs">Esta tienda todavía no acepta pedidos. Puedes ver el catálogo.</p>
      )}
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
    </StoreBaseProvider>
  );
}
