import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { storefrontGet, type PublicProduct, type PublicStore } from '@/lib/storefront-server';
import { AddToCart } from './add-to-cart';

export async function generateMetadata({ params }: { params: Promise<{ slug: string; handle: string }> }): Promise<Metadata> {
  const { slug, handle } = await params;
  const p = await storefrontGet<PublicProduct>(`/public/stores/${encodeURIComponent(slug)}/products/${encodeURIComponent(handle)}`);
  return { title: p?.title ?? 'Producto', description: p?.description.slice(0, 160) || undefined };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string; handle: string }> }) {
  const { slug, handle } = await params;
  const [store, p] = await Promise.all([
    storefrontGet<PublicStore>(`/public/stores/${encodeURIComponent(slug)}`),
    storefrontGet<PublicProduct>(`/public/stores/${encodeURIComponent(slug)}/products/${encodeURIComponent(handle)}`),
  ]);
  if (!store || !p) notFound();
  return (
    <div>
      <Link href={`/tienda/${store.slug}`} className="text-sm text-muted hover:underline">← Todos los productos</Link>
      <div className="mt-4 grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          {p.images.length === 0 && <div className="grid aspect-[4/5] place-items-center rounded-card bg-surface-3 text-subtle">Sin foto</div>}
          {p.images.map((src, i) => (
            <img key={src} src={`/media/${src}`} alt={i === 0 ? p.title : ''} className="w-full rounded-card bg-surface-3 object-cover" />
          ))}
        </div>
        <div className="md:sticky md:top-24 md:self-start">
          <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
          <AddToCart slug={store.slug} currency={store.currency} product={p} />
          {p.description && <div className="mt-8 border-t border-border pt-6 text-sm leading-relaxed whitespace-pre-line text-muted">{p.description}</div>}
        </div>
      </div>
    </div>
  );
}
