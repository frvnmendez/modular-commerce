'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ROLE_LABEL, useStore } from '@/lib/store-context';
import { CAP_LABEL, region } from '@/lib/labels';
import { Badge, Button, ButtonLink, Card, CheckCircle, PageHeader, ProgressBar, SoonBadge } from '@/components/ui';
import { IconCard, IconChevronDown, IconGlobe, IconStore, IconTag, IconUsers } from '@/components/icons';

type Step = { id: string; done: boolean; title: string; body: string; icon: React.ReactNode; action?: string };

export default function StoreHome() {
  const { store, me } = useStore();
  const can = (p: string) => store.permissions.includes(p);
  const firstName = me.user.name.split(/\s+/)[0] || me.user.name;
  const url = `${store.slug}.plataforma.com`;
  const steps: Step[] = [
    { id: 'create', done: true, title: 'Crear la tienda', body: `${store.name} ya existe y tiene dirección propia: ${url}.`, icon: <IconStore /> },
    { id: 'product', done: false, title: 'Añadir tu primer producto', body: 'Sube fotos, define tallas y colores y fija el precio. Es lo primero que verán tus clientes.', icon: <IconTag />, action: 'Añadir producto' },
    { id: 'payments', done: false, title: 'Configurar pagos', body: 'Acepta tarjeta y otros métodos de pago. El dinero llega directamente a tu cuenta.', icon: <IconCard />, action: 'Configurar pagos' },
    { id: 'publish', done: false, title: 'Publicar la tienda', body: `Revisa cómo se ve y abre la tienda al público en ${url}.`, icon: <IconGlobe />, action: 'Publicar tienda' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const [expanded, setExpanded] = useState<string | null>(steps.find((s) => !s.done)?.id ?? null);

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
                        {s.action && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Button size="sm" disabled title="Disponible en la próxima versión">{s.action}</Button>
                            <SoonBadge />
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
            <div className="mt-3"><Badge tone="warning" dot>Sin publicar</Badge></div>
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
