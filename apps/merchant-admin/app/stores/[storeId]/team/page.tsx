'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { Button, Card, Field, Input, Notice, Select } from '@/components/ui';

type Member = { userId: string; name: string; email: string; role: 'owner' | 'admin' | 'staff' };
type Invitation = { id: string; email: string; role: string; expiresAt: string };
const ROLE = { owner: 'Propietario', admin: 'Administrador', staff: 'Personal' } as const;

export default function Team() {
  const { store } = useStore();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const canInvite = store.permissions.includes('members:invite');
  const canManage = store.permissions.includes('members:manage');

  const load = useCallback(() => {
    api<{ members: Member[]; pendingInvitations: Invitation[] }>(`/v1/stores/${store.id}/members`)
      .then((r) => { setMembers(r.members); setInvites(r.pendingInvitations); })
      .catch((e) => setMsg({ kind: 'error', text: humanError(e) }));
  }, [store.id]);
  useEffect(load, [load]);

  async function invite(f: FormData) {
    setMsg(null); setLink(null);
    try {
      const r = await api<{ token: string }>(`/v1/stores/${store.id}/invitations`, { method: 'POST', body: { email: f.get('email'), role: f.get('role') } });
      setLink(`${location.origin}/invitations/accept#${r.token}`);
      setMsg({ kind: 'success', text: 'Invitación creada. Comparte el enlace con esa persona: caduca en 7 días.' });
      load();
    } catch (e) { setMsg({ kind: 'error', text: humanError(e) }); }
  }

  async function change(userId: string, role: string) {
    setMsg(null);
    try { await api(`/v1/stores/${store.id}/members/${userId}`, { method: 'PATCH', body: { role } }); load(); }
    catch (e) { setMsg({ kind: 'error', text: humanError(e) }); load(); }
  }
  async function remove(m: Member) {
    if (!confirm(`¿Quitar a ${m.name} de la tienda? Perderá el acceso inmediatamente.`)) return;
    try { await api(`/v1/stores/${store.id}/members/${m.userId}`, { method: 'DELETE' }); load(); }
    catch (e) { setMsg({ kind: 'error', text: humanError(e) }); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Equipo</h1>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {link && <Card title="Enlace de invitación"><Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de invitación" /></Card>}
      <Card title="Miembros" description="Quién tiene acceso a esta tienda.">
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{m.name}</p><p className="truncate text-xs text-muted">{m.email}</p></div>
              <div className="flex items-center gap-2">
                {canManage ? (
                  <Select aria-label={`Rol de ${m.name}`} value={m.role} onChange={(e) => change(m.userId, e.target.value)} className="w-40">
                    {Object.entries(ROLE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                ) : <span className="text-sm text-muted">{ROLE[m.role]}</span>}
                {(canManage || (store.role === 'admin' && m.role === 'staff')) && <Button variant="danger" onClick={() => remove(m)}>Quitar</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {canInvite && (
        <Card title="Invitar a alguien" description="Los administradores gestionan la tienda; el personal trabaja con productos y pedidos.">
          <form action={invite} className="grid gap-4 sm:grid-cols-[1fr_180px_auto] sm:items-end">
            <Field label="Email"><Input name="email" type="email" required /></Field>
            <Field label="Rol"><Select name="role" defaultValue="staff">
              <option value="staff">Personal</option>{store.role === 'owner' && <option value="admin">Administrador</option>}
            </Select></Field>
            <Button type="submit">Invitar</Button>
          </form>
          {invites.length > 0 && (
            <div className="mt-6"><h3 className="text-sm font-medium">Pendientes</h3>
              <ul className="mt-2 space-y-1 text-sm text-muted">{invites.map((i) => <li key={i.id}>{i.email} · {i.role === 'admin' ? 'Administrador' : 'Personal'} · caduca {new Date(i.expiresAt).toLocaleDateString('es')}</li>)}</ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
