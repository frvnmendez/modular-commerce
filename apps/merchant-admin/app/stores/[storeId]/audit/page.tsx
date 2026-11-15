'use client';
import { useEffect, useState } from 'react';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { Card, EmptyState, Notice, PageHeader, PageSkeleton } from '@/components/ui';
import { IconGear, IconMail, IconPulse, IconStore, IconUsers } from '@/components/icons';

type Ev = { action: string; actorUserId: string; targetType: string | null; targetId: string | null; metadata: Record<string, unknown>; at: string };
const LABEL: Record<string, string> = {
  'store.created': 'Tienda creada', 'store.updated': 'Datos de la tienda actualizados', 'settings.capabilities_changed': 'Capacidades cambiadas',
  'invitation.created': 'Invitación enviada', 'invitation.accepted': 'Invitación aceptada', 'invitation.revoked': 'Invitación revocada', 'member.role_changed': 'Rol cambiado', 'member.removed': 'Miembro eliminado',
};
const KEY_LABEL: Record<string, string> = { email: 'Email', role: 'Rol', from: 'Antes', to: 'Después', name: 'Nombre', country: 'País', currency: 'Moneda', capabilities: 'Capacidades', fields: 'Campos' };
const VALUE_LABEL: Record<string, string> = { owner: 'Propietario', admin: 'Administrador', staff: 'Personal' };

function iconFor(action: string) {
  if (action.startsWith('invitation.')) return { icon: <IconMail size={16} />, cls: 'bg-info-soft text-info' };
  if (action.startsWith('member.')) return { icon: <IconUsers size={16} />, cls: 'bg-accent-soft text-accent' };
  if (action === 'store.created') return { icon: <IconStore size={16} />, cls: 'bg-success-soft text-success' };
  return { icon: <IconGear size={16} />, cls: 'bg-surface-3 text-muted' };
}
const fmt = (v: unknown): string => Array.isArray(v) ? v.map(fmt).join(', ') : typeof v === 'string' ? VALUE_LABEL[v] ?? v : JSON.stringify(v);
const dayLabel = (d: Date) => {
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === y.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
};

export default function Audit() {
  const { store } = useStore();
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ events: Ev[] }>(`/v1/stores/${store.id}/audit`).then((r) => setEvents(r.events)).catch((e) => setError(humanError(e))); }, [store.id]);

  const header = <PageHeader title="Actividad" subtitle="Quién cambió qué y cuándo. El registro no se puede editar." />;
  if (error) return <div>{header}<Notice kind="error">{error}</Notice></div>;
  if (!events) return <PageSkeleton />;
  if (!events.length) {
    return <div>{header}<Card><EmptyState illustration={<span className="grid size-14 place-items-center rounded-2xl bg-surface-3 text-muted"><IconPulse size={28} /></span>}
      title="Sin actividad todavía" body="Aquí verás quién cambió qué y cuándo." /></Card></div>;
  }

  const groups: { day: string; items: Ev[] }[] = [];
  for (const e of events) {
    const day = dayLabel(new Date(e.at));
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(e); else groups.push({ day, items: [e] });
  }

  return (
    <div className="mc-rise">
      {header}
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.day}>
            <h2 className="mb-2 px-1 text-xs font-semibold text-muted first-letter:uppercase">{g.day}</h2>
            <Card flush>
              <ol className="-mt-3">
                {g.items.map((e, i) => {
                  const { icon, cls } = iconFor(e.action);
                  const meta = Object.entries(e.metadata ?? {});
                  return (
                    <li key={i} className="relative flex gap-3 px-4 py-3 sm:px-5">
                      {i < g.items.length - 1 && <span aria-hidden className="absolute top-11 bottom-0 left-[31px] w-px bg-border sm:left-[35px]" />}
                      <span className={`relative grid size-8 shrink-0 place-items-center rounded-full ${cls}`}>{icon}</span>
                      <div className="min-w-0 flex-1 pt-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <p className="text-[13px] font-medium">{LABEL[e.action] ?? e.action}</p>
                          <time className="text-xs text-muted" dateTime={e.at}>{new Date(e.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</time>
                        </div>
                        {meta.length > 0 && (
                          <dl className="mt-1 flex flex-wrap gap-1.5">
                            {meta.map(([k, v]) => (
                              <div key={k} className="flex max-w-full gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs ring-1 ring-border">
                                <dt className="text-muted">{KEY_LABEL[k] ?? k}</dt><dd className="truncate">{fmt(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
