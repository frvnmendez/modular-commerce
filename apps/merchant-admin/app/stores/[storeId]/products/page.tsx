'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { formatMoney } from '@/lib/money';
import { Badge, ButtonLink, Card, EmptyState, Notice, PageHeader, PageSkeleton } from '@/components/ui';
import { IconPlus, IconTag } from '@/components/icons';

type Item = { id: string; title: string; handle: string; status: 'draft' | 'active' | 'archived'; variantCount: number; stock: number; priceFrom: number | null; image: string | null };

const STATUS_LABEL = { active: 'Activo', draft: 'Borrador', archived: 'Archivado' } as const;
const STATUS_TONE = { active: 'success', draft: 'neutral', archived: 'warning' } as const;

export default function Products() {
  const { store } = useStore();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canWrite = store.permissions.includes('catalog:write');

  useEffect(() => {
    api<{ items: Item[] }>(`/v1/stores/${store.id}/products`).then((r) => setItems(r.items)).catch((e) => setError(humanError(e)));
  }, [store.id]);

  const add = canWrite ? <ButtonLink href={`/stores/${store.id}/products/new`} variant="primary"><IconPlus size={16} />Añadir producto</ButtonLink> : undefined;
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!items) return <PageSkeleton label="Cargando productos…" />;

  return (
    <div className="mc-rise">
      <PageHeader title="Productos" subtitle="Tu catálogo: fotos, opciones, precios y stock." primary={items.length > 0 ? add : undefined} />
      <Card flush>
        {items.length === 0 ? (
          <EmptyState illustration={<span className="grid size-16 place-items-center rounded-2xl bg-accent-soft text-accent [&>svg]:size-8"><IconTag /></span>}
            title="Añade tu primer producto"
            body="Sube fotos, pon el precio y el stock, y márcalo como activo para que aparezca en tu tienda."
            action={add} />
        ) : (
          <div className="-mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead className="border-b border-border bg-surface-2 text-left text-xs text-muted">
                <tr><th className="px-5 py-2 font-medium">Producto</th><th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Stock</th><th className="px-5 py-2 text-right font-medium">Precio</th></tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-surface-2">
                    <td className="px-5 py-2.5">
                      <Link href={`/stores/${store.id}/products/${p.id}`} className="flex items-center gap-3 font-medium hover:underline">
                        {p.image
                          ? <img src={`/media/${p.image}`} alt="" className="size-10 shrink-0 rounded-md object-cover ring-1 ring-border" />
                          : <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-3 text-subtle"><IconTag size={16} /></span>}
                        <span className="min-w-0"><span className="block truncate">{p.title}</span>
                          <span className="block text-xs font-normal text-muted">{p.variantCount === 1 ? '1 opción' : `${p.variantCount} opciones`}</span></span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[p.status]} dot>{STATUS_LABEL[p.status]}</Badge></td>
                    <td className={`px-3 py-2.5 ${p.stock === 0 ? 'text-danger' : ''}`}>{p.stock === 0 ? 'Agotado' : `${p.stock} en stock`}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{p.priceFrom === null ? '—' : (p.variantCount > 1 ? 'Desde ' : '') + formatMoney(p.priceFrom, store.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
