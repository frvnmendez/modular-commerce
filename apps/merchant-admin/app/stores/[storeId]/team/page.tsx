'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, humanError } from '@/lib/api';
import { ROLE_LABEL, useStore } from '@/lib/store-context';
import { Avatar, Badge, Button, Card, Field, Input, Notice, PageHeader, Select, Skeleton } from '@/components/ui';
import { IconCopy, IconMail } from '@/components/icons';

type Member = { userId: string; name: string; email: string; role: 'owner' | 'admin' | 'staff' };
type Invitation = { id: string; email: string; role: string; expiresAt: string };
const ROLE_TONE = { owner: 'accent', admin: 'info', staff: 'neutral' } as const;
const ROLE_HELP = [
  ['Propietario', 'Control total de la tienda, incluido el equipo y los propietarios.'],
  ['Administrador', 'Gestiona la tienda, sus ajustes y al personal.'],
  ['Personal', 'Trabaja con productos y pedidos. No ve ajustes ni equipo.'],
] as const;

export default function Team() {
  const { store, me } = useStore();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canInvite = store.permissions.includes('members:invite');
  const canManage = store.permissions.includes('members:manage');
  const owners = (members ?? []).filter((x) => x.role === 'owner').length;
  const isLastOwner = (m: Member) => m.role === 'owner' && owners <= 1;

  const load = useCallback(() => {
    api<{ members: Member[]; pendingInvitations: Invitation[] }>(`/v1/stores/${store.id}/members`)
      .then((r) => { setMembers(r.members); setInvites(r.pendingInvitations); })
      .catch((e) => setMsg({ kind: 'error', text: humanError(e) }));
  }, [store.id]);
  useEffect(load, [load]);

  async function invite(f: FormData) {
    setMsg(null); setLink(null); setCopied(false);
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
  async function revoke(i: Invitation) {
    if (!confirm(`¿Revocar la invitación de ${i.email}? El enlace dejará de funcionar.`)) return;
    try { await api(`/v1/stores/${store.id}/invitations/${i.id}`, { method: 'DELETE' }); setLink(null); load(); }
    catch (e) { setMsg({ kind: 'error', text: humanError(e) }); }
  }
  const canRevoke = (i: Invitation) => store.role === 'owner' || (store.role === 'admin' && i.role === 'staff');

  return (
    <div className="mc-rise">
      <PageHeader title="Equipo" subtitle={`Quién tiene acceso a ${store.name} y qué puede hacer.`} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-5">
          {msg && <Notice kind={msg.kind} onDismiss={() => setMsg(null)}>{msg.text}</Notice>}
          {link && (
            <Card title="Enlace de invitación" description="Envíalo por email o mensaje. Solo funciona con la cuenta del email invitado.">
              <div className="flex gap-2">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de invitación" className="font-mono text-xs" />
                <Button type="button" variant="secondary" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}>
                  <IconCopy size={16} />{copied ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
            </Card>
          )}

          <Card title={`Miembros${members ? ` · ${members.length}` : ''}`} flush>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-y border-border bg-surface-2 text-xs text-muted">
                  <tr><th className="px-4 py-2 font-medium sm:px-5">Miembro</th><th className="px-3 py-2 font-medium">Rol</th><th className="px-4 py-2 sm:px-5"><span className="sr-only">Acciones</span></th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {!members && [0, 1].map((n) => (
                    <tr key={n}><td className="px-5 py-3" colSpan={3}><div className="flex items-center gap-3"><Skeleton className="size-8 rounded-full" /><Skeleton className="h-3 w-40" /></div></td></tr>
                  ))}
                  {members?.map((m) => (
                    <tr key={m.userId} className="hover:bg-surface-2">
                      <td className="px-4 py-2.5 sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={m.name} />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 truncate font-medium">{m.name}{m.userId === me.user.id && <Badge>Tú</Badge>}</p>
                            <p className="truncate text-xs text-muted">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {canManage && !isLastOwner(m) ? (
                          <Select aria-label={`Rol de ${m.name}`} value={m.role} onChange={(e) => change(m.userId, e.target.value)} className="h-8 w-40 text-[13px]">
                            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </Select>
                        ) : <Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role]}</Badge>}
                      </td>
                      <td className="px-4 py-2.5 text-right sm:px-5">
                        {!isLastOwner(m) && (canManage || (store.role === 'admin' && m.role === 'staff')) && <Button size="sm" variant="danger-plain" onClick={() => remove(m)}>Quitar</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {canInvite && (
            <Card title="Invitar a alguien" description="Le llegará un enlace para unirse con su propia cuenta.">
              <form action={invite} className="grid gap-3 sm:grid-cols-[1fr_170px_auto] sm:items-end">
                <Field label="Email"><Input name="email" type="email" required placeholder="nombre@empresa.com" /></Field>
                <Field label="Rol"><Select name="role" defaultValue="staff">
                  <option value="staff">Personal</option>{store.role === 'owner' && <option value="admin">Administrador</option>}
                </Select></Field>
                <Button type="submit">Invitar</Button>
              </form>
              {invites.length > 0 && (
                <div className="mt-5 border-t border-border pt-4"><h3 className="text-[13px] font-semibold">Pendientes</h3>
                  <ul className="mt-2 divide-y divide-border">{invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-border-strong text-muted"><IconMail size={16} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{i.email}</p>
                        <p className="text-xs text-muted">{i.role === 'admin' ? 'Administrador' : 'Personal'} · caduca el {new Date(i.expiresAt).toLocaleDateString('es')}</p>
                      </div>
                      <Badge tone="warning" dot>Pendiente</Badge>
                      {canRevoke(i) && <Button size="sm" variant="secondary" onClick={() => revoke(i)}>Revocar</Button>}
                    </li>
                  ))}</ul>
                </div>
              )}
            </Card>
          )}
        </div>

        <Card title="Roles">
          <dl className="space-y-3 text-[13px]">
            {ROLE_HELP.map(([r, d]) => <div key={r}><dt className="font-medium">{r}</dt><dd className="text-muted">{d}</dd></div>)}
          </dl>
        </Card>
      </div>
    </div>
  );
}
