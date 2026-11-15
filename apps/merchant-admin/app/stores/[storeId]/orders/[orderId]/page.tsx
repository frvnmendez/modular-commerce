'use client';
import { use, useEffect, useState } from 'react';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { formatMoney } from '@/lib/money';
import { formatDate, ORDER_STATUS, type OrderStatus } from '@/lib/orders';
import { Badge, Button, Card, Notice, PageHeader, PageSkeleton } from '@/components/ui';

type Order = {
  id: string; number: number; status: OrderStatus; email: string; currency: string; shipCountry: string;
  shipAddress: { line1: string; line2?: string; city: string; postalCode: string; province?: string };
  taxRateBp: number; pricesIncludeTax: boolean; subtotal: number; shippingTotal: number; taxTotal: number; total: number;
  paymentProvider: 'stripe' | 'fake'; createdAt: string; paidAt: string | null; fulfilledAt: string | null; cancelledAt: string | null; refundedAt: string | null;
  checkoutExpiresAt: string;
  customer: { name: string; email: string; phone: string | null };
  lines: { productTitle: string; variantTitle: string; sku: string | null; unitPrice: number; quantity: number; lineTotal: number }[];
};
type Action = 'fulfill' | 'refund' | 'cancel';

export default function OrderDetail({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const { store } = useStore();
  const [o, setO] = useState<Order | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const manager = store.role !== 'staff';

  useEffect(() => {
    api<Order>(`/v1/stores/${store.id}/orders/${orderId}`).then(setO).catch((e) => setMsg({ kind: 'error', text: humanError(e) }));
  }, [store.id, orderId]);

  async function run(a: Action) {
    setBusy(true); setMsg(null);
    try {
      setO(await api<Order>(`/v1/stores/${store.id}/orders/${orderId}/${a}`, { method: 'POST' }));
      setMsg({ kind: 'success', text: { fulfill: 'Pedido marcado como enviado.', refund: 'Pedido reembolsado.', cancel: 'Pedido cancelado y stock devuelto.' }[a] });
    } catch (e) { setMsg({ kind: 'error', text: humanError(e) }); } finally { setBusy(false); setConfirm(null); }
  }

  if (!o) return msg ? <Notice kind="error">{msg.text}</Notice> : <PageSkeleton label="Cargando pedido…" />;
  const money = (c: number) => formatMoney(c, o.currency);
  const st = ORDER_STATUS[o.status];
  const confirmText: Record<Action, string> = {
    fulfill: '¿Marcar como enviado? Hazlo cuando el paquete salga.',
    refund: o.paymentProvider === 'stripe' ? `¿Devolver ${money(o.total)} al cliente? Se reembolsa en Stripe al momento.` : `¿Marcar como reembolsado (${money(o.total)})?`,
    cancel: '¿Cancelar este pedido sin pagar? El stock vuelve a estar disponible.',
  };

  return (
    <div className="mc-rise">
      <PageHeader title={`Pedido #${o.number}`} subtitle={formatDate(o.createdAt)} back={{ href: `/stores/${store.id}/orders`, label: 'Volver a pedidos' }}
        badge={<Badge tone={st.tone} dot>{st.label}</Badge>}
        primary={o.status === 'paid' ? <Button onClick={() => setConfirm('fulfill')} disabled={busy}>Marcar como enviado</Button> : undefined}
        secondary={<>
          {manager && ['paid', 'fulfilled'].includes(o.status) && <Button variant="secondary" onClick={() => setConfirm('refund')} disabled={busy}>Reembolsar</Button>}
          {manager && o.status === 'pending' && <Button variant="secondary" onClick={() => setConfirm('cancel')} disabled={busy}>Cancelar pedido</Button>}
        </>} />
      <div className="space-y-5">
        {msg && <Notice kind={msg.kind} onDismiss={() => setMsg(null)}>{msg.text}</Notice>}
        {confirm && (
          <Notice kind="warning">
            <p>{confirmText[confirm]}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant={confirm === 'fulfill' ? 'primary' : 'danger'} onClick={() => run(confirm)} disabled={busy}>{busy ? 'Un momento…' : 'Confirmar'}</Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>No</Button>
            </div>
          </Notice>
        )}
        {o.status === 'pending' && (
          <Notice kind="info">El cliente aún no ha pagado. El stock queda reservado hasta {formatDate(o.checkoutExpiresAt)}; si no paga, el pedido se cancela solo.</Notice>
        )}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-5">
            <Card title="Artículos" flush>
              <ul className="divide-y divide-border border-t border-border">
                {o.lines.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
                    <div className="min-w-0"><p className="font-medium">{l.productTitle}</p><p className="text-xs text-muted">{l.variantTitle}{l.sku ? ` · ${l.sku}` : ''}</p></div>
                    <p className="shrink-0 text-muted tabular-nums">{money(l.unitPrice)} × {l.quantity}</p>
                    <p className="w-24 shrink-0 text-right tabular-nums">{money(l.lineTotal)}</p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Pago">
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between"><dt className="text-muted">Productos</dt><dd className="tabular-nums">{money(o.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Envío</dt><dd className="tabular-nums">{o.shippingTotal ? money(o.shippingTotal) : 'Gratis'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">IVA {o.taxRateBp / 100} % {o.pricesIncludeTax ? '(incluido)' : ''}</dt><dd className="tabular-nums">{money(o.taxTotal)}</dd></div>
                <div className="flex justify-between border-t border-border pt-2 text-[15px] font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(o.total)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-muted">
                {o.paymentProvider === 'fake' ? 'Pago simulado (entorno de pruebas, sin dinero real).' : 'Cobrado con Stripe.'}
                {o.paidAt ? ` Pagado el ${formatDate(o.paidAt)}.` : ''}
                {o.fulfilledAt ? ` Enviado el ${formatDate(o.fulfilledAt)}.` : ''}
                {o.refundedAt ? ` Reembolsado el ${formatDate(o.refundedAt)}.` : ''}
                {o.cancelledAt ? ` Cancelado el ${formatDate(o.cancelledAt)}.` : ''}
              </p>
            </Card>
          </div>
          <div className="space-y-5">
            <Card title="Cliente">
              <p className="text-[13px] font-medium">{o.customer.name}</p>
              <a href={`mailto:${o.customer.email}`} className="block text-[13px] text-accent-text hover:underline">{o.customer.email}</a>
              {o.customer.phone && <p className="text-[13px] text-muted">{o.customer.phone}</p>}
            </Card>
            <Card title="Dirección de envío">
              <address className="text-[13px] not-italic leading-relaxed">
                {o.customer.name}<br />{o.shipAddress.line1}{o.shipAddress.line2 ? <><br />{o.shipAddress.line2}</> : null}<br />
                {o.shipAddress.postalCode} {o.shipAddress.city}{o.shipAddress.province ? ` (${o.shipAddress.province})` : ''}<br />{o.shipCountry}
              </address>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
