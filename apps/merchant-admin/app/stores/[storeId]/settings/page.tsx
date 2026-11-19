'use client';
import { useEffect, useRef, useState } from 'react';
import { centsToInput, parseMoney } from '@/lib/money';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { region } from '@/lib/labels';
import { Button, Card, Field, Input, Notice, PageHeader, Select, SettingsSection } from '@/components/ui';
import { DesignSettings, PaymentsSettings } from './sections';

const CAPS: [string, string, string][] = [
  ['physical-products', 'Productos físicos', 'Artículos que se envían o se recogen.'],
  ['digital-products', 'Productos digitales', 'Descargas, cursos o licencias.'],
  ['inventory', 'Inventario propio', 'Controlas tus existencias.'],
  ['variants', 'Variantes', 'Tallas, colores u otras opciones.'],
  ['shipping', 'Envíos', 'Tarifas, etiquetas y seguimiento.'],
  ['international', 'Venta internacional', 'Varios países y monedas.'],
  ['dropshipping', 'Dropshipping', 'Un proveedor envía por ti.'],
  ['returns', 'Devoluciones', 'Gestiona devoluciones y reembolsos.'],
];

export default function Settings() {
  const { store, reload } = useStore();
  const form = useRef<HTMLFormElement>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [country, setCountry] = useState(store.country);

  async function save(f: FormData) {
    setMsg(null); setBusy(true);
    try {
      await api(`/v1/stores/${store.id}`, { method: 'PATCH', body: {
        name: f.get('name'), country: f.get('country'), currency: f.get('currency'), capabilities: f.getAll('capabilities'),
      } });
      setMsg({ kind: 'success', text: 'Cambios guardados.' });
      setDirty(false);
      reload();
    } catch (e) { setMsg({ kind: 'error', text: humanError(e) }); } finally { setBusy(false); }
  }
  function discard() { form.current?.reset(); setCountry(store.country); setDirty(false); setMsg(null); }

  return (
    <div className="mc-rise">
      {dirty && (
        <div role="region" aria-label="Cambios sin guardar" className="mc-pop fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-3 bg-ink px-4 text-ink-text shadow-pop">
          <p className="flex items-center gap-2 text-[13px] font-medium"><span aria-hidden className="size-2 rounded-full bg-[#f0b955]" />Cambios sin guardar</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" className="!border-white/20 !bg-transparent !text-ink-text hover:!bg-ink-2" onClick={discard}>Descartar</Button>
            <Button type="submit" form="settings-form" size="sm" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </div>
      )}
      <PageHeader title="Ajustes" subtitle="Datos de la tienda y qué partes del panel usas." />
      <form id="settings-form" ref={form} action={save} onChange={() => setDirty(true)} className="space-y-5">
        {msg && <Notice kind={msg.kind} onDismiss={() => setMsg(null)}>{msg.text}</Notice>}
        <Card>
          <SettingsSection title="Datos de la tienda" description="Cómo se llama tu tienda y en qué país y moneda vende.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Nombre"><Input name="name" defaultValue={store.name} required minLength={2} maxLength={80} /></Field></div>
              <Field label="País" hint={/^[A-Z]{2}$/.test(country) ? region(country) : 'Código de 2 letras, p. ej. ES'}>
                <Input name="country" defaultValue={store.country} required pattern="[A-Z]{2}" onChange={(e) => setCountry(e.target.value)} />
              </Field>
              <Field label="Moneda"><Select name="currency" defaultValue={store.currency}>{['EUR', 'USD', 'MXN', 'ARS', 'COP', 'CLP', 'PEN'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
            </div>
          </SettingsSection>
          <SettingsSection title="Capacidades" description="Activa solo lo que usas: el menú mostrará únicamente estas secciones.">
            <div className="grid gap-2 sm:grid-cols-2">
              {CAPS.map(([v, l, d]) => (
                <label key={v} className="group flex cursor-pointer items-start gap-3 rounded-[10px] border border-border px-3 py-2.5 transition-colors hover:bg-surface-2 has-[:checked]:border-accent/50 has-[:checked]:bg-accent-soft/50">
                  <input type="checkbox" name="capabilities" value={v} defaultChecked={store.capabilities.includes(v)} className="peer sr-only" />
                  <span aria-hidden className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-border-strong transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
                  <span className="min-w-0"><span className="block text-[13px] font-medium">{l}</span><span className="block text-xs text-muted">{d}</span></span>
                </label>
              ))}
            </div>
          </SettingsSection>
        </Card>
        <div className="flex justify-end gap-2">
          {dirty && <Button type="button" variant="secondary" onClick={discard}>Descartar</Button>}
          <Button type="submit" disabled={!dirty || busy}>Guardar cambios</Button>
        </div>
      </form>
      <SalesSettings />
      <PaymentsSettings />
      <DesignSettings />
    </div>
  );
}

type Sales = { storefrontPublished: boolean; slug: string; shippingFlatAmount: number; freeShippingThreshold: number | null; contactEmail: string | null; taxRateBp: number | null; pricesIncludeTax: boolean };

/** Venta online: publicar la tienda, envío, IVA y email de avisos. Formulario propio con su botón de guardar. */
function SalesSettings() {
  const { store } = useStore();
  const [s, setS] = useState<Sales | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ published: false, shipping: '', freeOver: '', email: '', tax: '' });

  useEffect(() => {
    api<Sales>(`/v1/stores/${store.id}/sales-settings`).then((r) => {
      setS(r);
      setForm({ published: r.storefrontPublished, shipping: centsToInput(r.shippingFlatAmount), freeOver: centsToInput(r.freeShippingThreshold),
        email: r.contactEmail ?? '', tax: r.taxRateBp === null ? '21' : String(r.taxRateBp / 100).replace('.', ',') });
    }).catch((e) => setMsg({ kind: 'error', text: humanError(e) }));
  }, [store.id]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    const shipping = form.shipping.trim() ? parseMoney(form.shipping) : 0;
    const freeOver = form.freeOver.trim() ? parseMoney(form.freeOver) : null;
    const tax = Number(form.tax.replace(',', '.'));
    if (shipping === null || (form.freeOver.trim() && freeOver === null)) return setMsg({ kind: 'error', text: 'Revisa los importes de envío (p. ej. 4,95).' });
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) return setMsg({ kind: 'error', text: 'El IVA debe ser un porcentaje entre 0 y 100.' });
    setBusy(true);
    try {
      await api(`/v1/stores/${store.id}/sales-settings`, { method: 'PATCH', body: {
        storefrontPublished: form.published, shippingFlatAmount: shipping, freeShippingThreshold: freeOver,
        contactEmail: form.email.trim() || null, taxRateBp: Math.round(tax * 100), pricesIncludeTax: true,
      } });
      setS((x) => x && { ...x, storefrontPublished: form.published });
      setMsg({ kind: 'success', text: form.published ? 'Guardado. Tu tienda está abierta al público.' : 'Guardado. Tu tienda no es visible para el público.' });
    } catch (err) { setMsg({ kind: 'error', text: humanError(err) }); } finally { setBusy(false); }
  }

  if (!s) return msg ? <div className="mt-5"><Notice kind="error">{msg.text}</Notice></div> : null;
  const url = store.storeUrl;
  return (
    <form onSubmit={save} className="mt-8 space-y-5" aria-label="Venta online">
      <h2 className="text-lg font-semibold tracking-tight">Venta online</h2>
      {msg && <Notice kind={msg.kind} onDismiss={() => setMsg(null)}>{msg.text}</Notice>}
      <Card>
        <SettingsSection title="Tu tienda online" description={<>Cuando la publiques, cualquiera podrá verla y comprar en <a className="text-accent-text hover:underline" href={url} target="_blank" rel="noreferrer">{url}</a>.</>}>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} className="peer sr-only" />
            <span aria-hidden className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-border-strong transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
            <span><span className="block text-[13px] font-medium">Tienda publicada</span><span className="block text-xs text-muted">Solo se muestran los productos en estado «Activo».</span></span>
          </label>
        </SettingsSection>
        <SettingsSection title="Envío" description="Una tarifa fija por pedido. Opcionalmente, gratis a partir de un importe.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Tarifa de envío (${store.currency})`} hint="0 si el envío es gratis."><Input inputMode="decimal" value={form.shipping} onChange={(e) => setForm({ ...form, shipping: e.target.value })} placeholder="4,95" /></Field>
            <Field label="Envío gratis desde" hint="Déjalo vacío si no aplica."><Input inputMode="decimal" value={form.freeOver} onChange={(e) => setForm({ ...form, freeOver: e.target.value })} placeholder="50,00" /></Field>
          </div>
        </SettingsSection>
        <SettingsSection title="Impuestos" description="Tus precios incluyen el IVA. Se desglosa en el pedido.">
          <Field label="IVA (%)" hint="En España, el tipo general es el 21 %."><Input inputMode="decimal" value={form.tax} onChange={(e) => setForm({ ...form, tax: e.target.value })} className="sm:max-w-[120px]" /></Field>
        </SettingsSection>
        <SettingsSection title="Avisos de pedidos" description="Te enviamos un email a esta dirección con cada venta.">
          <Field label="Email de la tienda"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="hola@mitienda.com" /></Field>
        </SettingsSection>
      </Card>
      <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar venta online'}</Button></div>
    </form>
  );
}
