'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, humanError } from '@/lib/api';
import { writeCart } from '@/lib/cart';
import { formatMoney } from '@/lib/money';
import { useStoreBase } from '@/lib/store-base';
import { splitSlug } from '@/lib/slug';

type Order = {
  orderId: string; number: number; status: 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded'; currency: string; email: string; storeName: string;
  contactEmail: string | null; subtotal: number; shippingTotal: number; taxTotal: number; total: number; provider: 'stripe' | 'fake';
  shipAddress: { line1: string; line2?: string; city: string; postalCode: string };
  lines: { productTitle: string; variantTitle: string; unitPrice: number; quantity: number; lineTotal: number }[];
};

export default function OrderThanks({ params }: { params: Promise<{ slug: string; orderId: string }> }) {
  const { slug: raw, orderId } = use(params);
  const { slug } = splitSlug(raw);
  const [token, setToken] = useState<string | null>(null);
  const [o, setO] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const base = useStoreBase();
  const [tries, setTries] = useState(0);

  const load = useCallback((t: string) => api<Order>(`/public/stores/${slug}/orders/${orderId}?t=${encodeURIComponent(t)}`).then(setO).catch((e) => setError(humanError(e))), [slug, orderId]);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('t');
    setToken(t);
    if (t) load(t); else setError('Enlace de pedido no válido.');
    writeCart(slug, []);   // el pedido ya existe: el carrito se vacía
  }, [slug, load]);
  // Con Stripe, el aviso de pago puede tardar unos segundos en llegar: se consulta de nuevo un rato.
  useEffect(() => {
    if (!o || !token || o.status !== 'pending' || o.provider !== 'stripe' || tries >= 15) return;
    const id = setTimeout(() => { setTries((n) => n + 1); load(token); }, 2000);
    return () => clearTimeout(id);
  }, [o, token, tries, load]);

  async function simulate() {
    if (!token) return;
    setPaying(true);
    try { const r = await api<{ order: Order }>(`/public/stores/${slug}/orders/${orderId}/simulate-payment`, { method: 'POST', body: { t: token } }); setO(r.order); }
    catch (e) { setError(humanError(e)); } finally { setPaying(false); }
  }

  if (error) return <p role="alert" className="mx-auto max-w-md py-16 text-center">{error}</p>;
  if (!o) return <p role="status" className="py-16 text-center text-muted">Cargando tu pedido…</p>;
  const money = (c: number) => formatMoney(c, o.currency);
  const paid = ['paid', 'fulfilled'].includes(o.status);

  return (
    <div className="mx-auto max-w-xl">
      {paid ? (
        <>
          <p className="text-sm font-medium text-success">Pago confirmado</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">¡Gracias! Pedido #{o.number}</h1>
          <p className="mt-2 text-muted">Te hemos enviado la confirmación a {o.email}. {o.storeName} te avisará cuando salga el envío.</p>
        </>
      ) : o.status === 'pending' ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Pedido #{o.number}</h1>
          {o.provider === 'fake' ? (
            <div className="mt-4 rounded-card bg-warning-soft p-4 text-sm">
              <p><strong>Tienda en modo de prueba.</strong> No se cobra dinero real. Pulsa el botón para simular el pago.</p>
              <button type="button" onClick={simulate} disabled={paying} className="mt-3 h-11 rounded-full bg-accent px-6 text-sm font-semibold text-accent-fg disabled:opacity-60">
                {paying ? 'Pagando…' : `Pagar ${money(o.total)} (simulado)`}
              </button>
            </div>
          ) : <p className="mt-2 text-muted" role="status">{tries >= 15 ? 'Aún no hemos recibido la confirmación del pago. Si has pagado, recibirás un email en unos minutos.' : 'Estamos confirmando tu pago…'}</p>}
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Pedido #{o.number}</h1>
          <p className="mt-2 text-muted">{o.status === 'cancelled' ? 'Este pedido se canceló porque no se completó el pago.' : 'Este pedido se ha reembolsado.'}</p>
        </>
      )}
      <ul className="mt-8 divide-y divide-border border-y border-border text-sm">
        {o.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 py-3"><span>{l.quantity} × {l.productTitle} <span className="text-muted">· {l.variantTitle}</span></span><span className="tabular-nums">{money(l.lineTotal)}</span></li>
        ))}
      </ul>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-muted">Envío</dt><dd className="tabular-nums">{o.shippingTotal ? money(o.shippingTotal) : 'Gratis'}</dd></div>
        <div className="flex justify-between font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="order-total">{money(o.total)}</dd></div>
        <p className="text-xs text-muted">IVA incluido: {money(o.taxTotal)}</p>
      </dl>
      <p className="mt-6 text-sm text-muted">Envío a: {o.shipAddress.line1}{o.shipAddress.line2 ? `, ${o.shipAddress.line2}` : ''}, {o.shipAddress.postalCode} {o.shipAddress.city}</p>
      {o.contactEmail && <p className="mt-2 text-sm text-muted">¿Dudas? Escribe a <a className="underline" href={`mailto:${o.contactEmail}`}>{o.contactEmail}</a>.</p>}
      <Link href={base || '/'} className="mt-8 inline-flex h-11 items-center rounded-full border border-border-strong px-6 text-sm font-medium hover:bg-surface-2">Seguir comprando</Link>
    </div>
  );
}
