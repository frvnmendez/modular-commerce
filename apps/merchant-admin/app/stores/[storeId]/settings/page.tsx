'use client';
import { useState } from 'react';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { Button, Card, Field, Input, Notice, Select } from '@/components/ui';

const CAPS: [string, string][] = [
  ['physical-products', 'Productos físicos'], ['digital-products', 'Productos digitales'], ['inventory', 'Inventario propio'],
  ['variants', 'Variantes'], ['shipping', 'Envíos'], ['international', 'Venta internacional'], ['dropshipping', 'Dropshipping'], ['returns', 'Devoluciones'],
];

export default function Settings() {
  const { store, reload } = useStore();
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  async function save(f: FormData) {
    setMsg(null);
    try {
      await api(`/v1/stores/${store.id}`, { method: 'PATCH', body: {
        name: f.get('name'), country: f.get('country'), currency: f.get('currency'), capabilities: f.getAll('capabilities'),
      } });
      setMsg({ kind: 'success', text: 'Cambios guardados.' });
      reload();
    } catch (e) { setMsg({ kind: 'error', text: humanError(e) }); }
  }
  return (
    <form action={save} className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Card title="Datos básicos">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre"><Input name="name" defaultValue={store.name} required minLength={2} maxLength={80} /></Field>
          <Field label="País"><Input name="country" defaultValue={store.country} required pattern="[A-Z]{2}" /></Field>
          <Field label="Moneda"><Select name="currency" defaultValue={store.currency}>{['EUR', 'USD', 'MXN', 'ARS', 'COP', 'CLP', 'PEN'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </div>
      </Card>
      <Card title="Capacidades" description="Activa solo lo que usas: el menú mostrará únicamente estas secciones.">
        <div className="grid gap-2 sm:grid-cols-2">
          {CAPS.map(([v, l]) => (
            <label key={v} className="flex items-center gap-3 rounded-[var(--radius)] border border-border px-3 py-2 text-sm">
              <input type="checkbox" name="capabilities" value={v} defaultChecked={store.capabilities.includes(v)} className="size-4 accent-[var(--accent)]" /> {l}
            </label>
          ))}
        </div>
      </Card>
      <Button type="submit">Guardar cambios</Button>
    </form>
  );
}
