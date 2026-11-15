'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { ROLE_LABEL, useStore } from '@/lib/store-context';
import { CAP_LABEL, region } from '@/lib/labels';
import { Badge, ButtonLink, Card, CheckCircle, PageHeader, ProgressBar } from '@/components/ui';
import { IconCard, IconChevronDown, IconGlobe, IconStore, IconTag, IconUsers } from '@/components/icons';

type Step = { id: string; done: boolean; title: string; body: string; icon: React.ReactNode; action?: { label: string; href: string } };

export default function StoreHome() {
  const { store, me } = useStore();
  const can = (p: string) => store.permissions.includes(p);
  const firstName = me.user.name.split(/\s+/)[0] || me.user.name;
  const url = `/tienda/${store.slug}`;
  const base = `/stores/${store.id}`;
  const [state, setState] = useState<{ products: number; active: number; published: boolean; orders: number } | null>(null);
  useEffect(() => {
    Promise.all([
      api<{ items: { status: string }[] }>(`/v1/stores/${store.id}/products`).catch(() => ({ items: [] })),
      can('settings:write') ? api<{ storefrontPublished: boolean }>(`/v1/stores/${store.id}/sales-settings`).catch(() => ({ storefrontPublished: false })) : Promise.resolve({ storefrontPublished: false }),
      api<{ counts: Record<string, number> }>(`/v1/stores/${store.id}/orders`).catch(() => ({ counts: {} })),
    ]).then(([p, s, o]) => setState({
      products: p.items.length, active: p.items.filter((x) => x.status === 'active').length, published: s.storefrontPublished,
      orders: Object.entries(o.counts).filter(([k]) => k !== 'pending' && k !== 'cancelled').reduce((a, [, n]) => a + n, 0),
    }));
  }, [store.id]);
  const steps: Step[] = [
    { id: 'create', done: true, title: 'Crear la tienda', body: `${store.name} ya existe y tendrá su dirección: ${url}.`, icon: <IconStore /> },
    { id: 'product', done: (state?.active ?? 0) > 0, title: 'Añadir tu primer producto', body: 'Sube fotos, define tallas y colores y fija el precio. Márcalo como «Activo» para que se vea en la tienda.', icon: <IconTag />,
      action: { label: 'Añadir producto', href: `${base}/products/new` } },
    { id: 'publish', done: !!state?.published, title: 'Publicar la tienda', body: 'Pon la tarifa de envío y el IVA y abre la tienda al público.', icon: <IconGlobe />,
      action: { label: 'Ir a venta online', href: `${base}/settings` } },
    { id: 'payments', done: (state?.orders ?? 0) > 0, title: 'Hacer una compra de prueba', body: 'Entra en tu tienda, añade algo al carrito y paga con una tarjeta de prueba. Sin dinero real.', icon: <IconCard />,
      action: { label: 'Abrir mi tienda', href: url } },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const [expanded, setExpanded] = useState<string | null>('product');

  return (
    <div className="mc-rise">
      <PageHeader title={`Hola, ${firstName}`} subtitle={`Esto es lo que falta para empezar a vender con ${store.name}.`} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card title="Guía de configuración" description="Sigue estos pasos para abrir tu tienda. Puedes hacerlos en cualquier orden." flush>
          <div className="flex items-center gap-3 px-4 pb-3 sm:px-5">
            <span className="shrink-0 text-xs text-muted">{doneCount} de {steps.length} tareas completadas</span>
            <ProgressBar value={doneCount} max={steps.length} label="Progreso de la configuración" />
          </div>
          <ol className="border-t border-border p-1.5">
            {steps.map((s) => {
              const isOpen = expanded === s.id;
              return (
                <li key={s.id} className={`rounded-[10px] transition-colors ${isOpen ? 'bg-surface-2' : ''}`}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : s.id)}
                    className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-surface-2">
                    <CheckCircle done={s.done} />
                    <span className={`flex-1 text-[13px] ${isOpen ? 'font-semibold' : 'font-medium'} ${s.done ? 'text-muted line-through decoration-border-strong' : ''}`}>{s.title}</span>
                    <IconChevronDown size={16} className={`text-subtle transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="mc-pop flex gap-4 px-3 pb-4 pl-11">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-muted">{s.body}</p>
                        {s.action && !s.done && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <ButtonLink href={s.action.href} variant="primary" size="sm">{s.action.label}</ButtonLink>
                          </div>
                        )}
                      </div>
                      <span aria-hidden className="hidden size-16 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent sm:grid [&>svg]:size-8">{s.icon}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-5">
          <Card>
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-ink text-[15px] font-semibold text-ink-text">{store.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{store.name}</p>
                <p className="truncate text-xs text-muted">{url}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              {state?.published ? <Badge tone="success" dot>Publicada</Badge> : <Badge tone="warning" dot>Sin publicar</Badge>}
              <a href={url} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-accent-text hover:underline">Ver tienda</a>
            </div>
            <dl className="mt-4 space-y-2 border-t border-border pt-3 text-[13px]">
              <div className="flex justify-between gap-3"><dt className="text-muted">País</dt><dd>{region(store.country)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Moneda</dt><dd>{store.currency}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Tu rol</dt><dd>{ROLE_LABEL[store.role]}</dd></div>
            </dl>
          </Card>

          <Card title="Preparada para" description="Lo dedujimos de tus respuestas. El menú solo muestra lo que usas."
            actions={can('settings:write') ? <Link className="text-[13px] font-medium text-accent-text hover:underline" href={`/stores/${store.id}/settings`}>Cambiar</Link> : undefined}>
            <ul className="flex flex-wrap gap-1.5">{store.capabilities.map((c) => <li key={c}><Badge>{CAP_LABEL[c] ?? c}</Badge></li>)}</ul>
          </Card>

          {can('members:read') && (
            <Card>
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-3 text-muted"><IconUsers /></span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">Trabaja en equipo</p>
                  <p className="mt-0.5 text-[13px] text-muted">Invita a tu equipo y decide qué puede hacer cada persona.</p>
                  <ButtonLink href={`/stores/${store.id}/team`} size="sm" className="mt-3">Gestionar equipo</ButtonLink>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
