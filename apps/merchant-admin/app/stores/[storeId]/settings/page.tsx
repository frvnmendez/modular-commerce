'use client';
import { useRef, useState } from 'react';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { region } from '@/lib/labels';
import { Button, Card, Field, Input, Notice, PageHeader, Select, SettingsSection } from '@/components/ui';

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
    </div>
  );
}
