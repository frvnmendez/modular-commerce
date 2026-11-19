'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { formatMoney } from '@/lib/money';
import { formatDate, ORDER_STATUS, type OrderStatus } from '@/lib/orders';
import { Badge, Card, EmptyState, Notice, PageHeader, PageSkeleton } from '@/components/ui';
import { IconInbox } from '@/components/icons';

type Item = { id: string; number: number; status: OrderStatus; email: string; customerName: string; total: number; currency: string; createdAt: string; items: number };
const TABS: { id: OrderStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Todos' }, { id: 'paid', label: 'Por enviar' }, { id: 'fulfilled', label: 'Enviados' },
  { id: 'pending', label: 'Sin pagar' }, { id: 'refunded', label: 'Reembolsados' }, { id: 'cancelled', label: 'Cancelados' },
];

export default function Orders() {
  const { store } = useStore();
  const [tab, setTab] = useState<OrderStatus | 'all'>('all');
  const [data, setData] = useState<{ items: Item[]; counts: Partial<Record<OrderStatus, number>> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<{ items: Item[]; counts: Partial<Record<OrderStatus, number>> }>(`/v1/stores/${store.id}/orders${tab === 'all' ? '' : `?status=${tab}`}`)
      .then(setData).catch((e) => setError(humanError(e)));
  }, [store.id, tab]);

  if (error) return <Notice kind="error">{error}</Notice>;
  const total = data ? Object.values(data.counts).reduce((a, b) => a + (b ?? 0), 0) : 0;

  return (
    <div className="mc-rise">
      <PageHeader title="Pedidos" subtitle="Ventas de tu tienda: pago, envío y cliente." />
      <Card flush>
        <div role="tablist" aria-label="Filtrar pedidos" className="-mt-3 flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {TABS.map((t) => {
            const n = t.id === 'all' ? total : data?.counts[t.id] ?? 0;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={`whitespace-nowrap rounded-[var(--radius)] px-2.5 py-1 text-[13px] ${tab === t.id ? 'bg-surface-3 font-semibold' : 'text-muted hover:bg-surface-2'}`}>
                {t.label}{data && n > 0 ? <span className="ml-1 text-xs text-subtle">{n}</span> : null}
              </button>
            );
          })}
        </div>
        {!data ? <div className="p-5"><PageSkeleton label="Cargando pedidos…" /></div> : data.items.length === 0 ? (
          <EmptyState illustration={<span className="grid size-16 place-items-center rounded-2xl bg-accent-soft text-accent [&>svg]:size-8"><IconInbox /></span>}
            title={tab === 'all' ? 'Aquí llegarán tus ventas' : 'No hay pedidos en este estado'}
            body={tab === 'all' ? 'Cuando alguien compre en tu tienda, verás aquí el pedido con su pago y su envío.' : 'Prueba con otro filtro.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="border-b border-border bg-surface-2 text-left text-xs text-muted">
                <tr><th className="px-5 py-2 font-medium">Pedido</th><th className="px-3 py-2 font-medium">Fecha</th><th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Estado</th><th className="px-5 py-2 text-right font-medium">Total</th></tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-b-0 hover:bg-surface-2">
                    <td className="px-5 py-2.5"><Link href={`/stores/${store.id}/orders/${o.id}`} className="font-semibold hover:underline">#{o.number}</Link>
                      <span className="block text-xs text-muted">{o.items === 1 ? '1 artículo' : `${o.items} artículos`}</span></td>
                    <td className="px-3 py-2.5 text-muted">{formatDate(o.createdAt)}</td>
                    <td className="px-3 py-2.5"><span className="block">{o.customerName}</span><span className="block text-xs text-muted">{o.email}</span></td>
                    <td className="px-3 py-2.5"><Badge tone={ORDER_STATUS[o.status].tone} dot>{ORDER_STATUS[o.status].label}</Badge></td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{formatMoney(o.total, o.currency)}</td>
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
