'use client';
import Link from 'next/link';
import { useStore } from '@/lib/store-context';
import { Card } from '@/components/ui';

const CAP_LABEL: Record<string, string> = {
  'physical-products': 'Productos físicos', 'digital-products': 'Productos digitales', inventory: 'Inventario propio',
  variants: 'Variantes (tallas, colores…)', shipping: 'Envíos', international: 'Venta internacional', dropshipping: 'Dropshipping', returns: 'Devoluciones',
};

export default function StoreHome() {
  const { store } = useStore();
  const can = (p: string) => store.permissions.includes(p);
  const steps = [
    { done: true, label: 'Crear la tienda' },
    { done: false, label: 'Añadir tu primer producto', note: 'Disponible en la próxima versión' },
    { done: false, label: 'Configurar pagos', note: 'Disponible en la próxima versión' },
    { done: false, label: 'Publicar la tienda', note: 'Disponible en la próxima versión' },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hola, bienvenido a {store.name}</h1>
        <p className="mt-1 text-sm text-muted">Estos son los siguientes pasos para empezar a vender.</p>
      </div>
      <Card title="Primeros pasos">
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-3 text-sm">
              <span aria-hidden className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs ${s.done ? 'bg-accent text-accent-fg' : 'border border-border'}`}>{s.done ? '✓' : ''}</span>
              <span><span className={s.done ? 'line-through text-muted' : ''}>{s.label}</span>{s.note && <span className="block text-xs text-muted">{s.note}</span>}</span>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="Tu tienda está preparada para" description="Lo hemos deducido de tus respuestas; el menú se adapta a esto."
        actions={can('settings:write') ? <Link className="text-sm text-accent underline-offset-4 hover:underline" href={`/stores/${store.id}/settings`}>Cambiar</Link> : undefined}>
        <ul className="flex flex-wrap gap-2">{store.capabilities.map((c) => <li key={c} className="rounded-full bg-surface-2 px-3 py-1 text-xs">{CAP_LABEL[c] ?? c}</li>)}</ul>
      </Card>
    </div>
  );
}
