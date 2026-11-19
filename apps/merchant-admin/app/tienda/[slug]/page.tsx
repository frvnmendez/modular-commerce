import Link from 'next/link';
import { splitSlug } from '@/lib/slug';
import { storefrontGet, type PublicProductCard, type PublicStore } from '@/lib/storefront-server';

const money = (c: number, cur: string) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).format(c / 100);

export default async function StorefrontHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug, base } = splitSlug((await params).slug);
  const [store, list] = await Promise.all([
    storefrontGet<PublicStore>(`/public/stores/${encodeURIComponent(slug)}`),
    storefrontGet<{ items: PublicProductCard[] }>(`/public/stores/${encodeURIComponent(slug)}/products`),
  ]);
  if (!store || !list) return null;
  const hero = store.banner || store.headline || store.tagline;
  return (
    <>
      {hero && (
        <section className={`relative mb-10 overflow-hidden ${store.banner ? '-mx-4 -mt-8 min-h-[260px] sm:mx-0 sm:min-h-[340px] sm:rounded-b-card' : 'rounded-card bg-accent-soft'}`}>
          {store.banner && <img src={`/media/${store.banner}`} alt="" className="absolute inset-0 size-full object-cover" />}
          {store.banner && <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />}
          <div className={`relative flex h-full flex-col justify-end px-6 py-10 sm:px-10 ${store.banner ? 'min-h-[260px] text-white sm:min-h-[340px]' : ''}`}>
            {store.headline && <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{store.headline}</h1>}
            {store.tagline && <p className={`mt-2 max-w-xl text-base ${store.banner ? 'text-white/90' : 'text-muted'}`}>{store.tagline}</p>}
          </div>
        </section>
      )}
      {store.headline ? <h2 className="mb-6 text-2xl font-semibold tracking-tight">Productos</h2> : <h1 className="mb-6 text-2xl font-semibold tracking-tight">Productos</h1>}
      {list.items.length === 0 ? (
        <p className="rounded-card bg-surface-2 p-10 text-center text-muted">Esta tienda aún no tiene productos a la venta. Vuelve pronto.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {list.items.map((p) => (
            <li key={p.handle}>
              <Link href={`${base}/producto/${p.handle}`} className="group block">
                <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface-3">
                  {p.image
                    ? <img src={`/media/${p.image}`} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    : <span className="grid size-full place-items-center text-sm text-subtle">Sin foto</span>}
                  {!p.available && <span className="absolute top-2 left-2 rounded-full bg-surface px-2 py-0.5 text-xs font-medium">Agotado</span>}
                </div>
                <h3 className="mt-3 text-sm font-medium group-hover:underline">{p.title}</h3>
                <p className="mt-0.5 text-sm text-muted">{money(p.priceFrom, store.currency)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
