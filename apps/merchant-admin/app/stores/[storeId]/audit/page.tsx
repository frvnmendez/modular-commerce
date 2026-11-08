'use client';
import { useEffect, useState } from 'react';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { Card, EmptyState, Notice } from '@/components/ui';

type Ev = { action: string; actorUserId: string; targetType: string | null; targetId: string | null; metadata: Record<string, unknown>; at: string };
const LABEL: Record<string, string> = {
  'store.created': 'Tienda creada', 'store.updated': 'Datos de la tienda actualizados', 'settings.capabilities_changed': 'Capacidades cambiadas',
  'invitation.created': 'Invitación enviada', 'invitation.accepted': 'Invitación aceptada', 'invitation.revoked': 'Invitación revocada', 'member.role_changed': 'Rol cambiado', 'member.removed': 'Miembro eliminado',
};

export default function Audit() {
  const { store } = useStore();
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ events: Ev[] }>(`/v1/stores/${store.id}/audit`).then((r) => setEvents(r.events)).catch((e) => setError(humanError(e))); }, [store.id]);
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!events) return <p className="text-sm text-muted" role="status">Cargando…</p>;
  if (!events.length) return <EmptyState title="Sin actividad" body="Aquí verás quién cambió qué y cuándo." />;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Actividad</h1>
      <Card>
        <ul className="divide-y divide-border">
          {events.map((e, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
              <span>{LABEL[e.action] ?? e.action}{e.metadata && Object.keys(e.metadata).length > 0 && <span className="ml-2 text-xs text-muted">{JSON.stringify(e.metadata)}</span>}</span>
              <time className="text-xs text-muted" dateTime={e.at}>{new Date(e.at).toLocaleString('es')}</time>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
