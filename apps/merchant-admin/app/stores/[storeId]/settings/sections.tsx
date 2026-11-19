'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { Badge, Button, Card, Field, Input, Notice, SettingsSection } from '@/components/ui';

type Msg = { kind: 'error' | 'success' | 'info'; text: string } | null;
type Payments = {
  mode: 'fake' | 'platform' | 'connect'; platformFeeBp: number; ready: boolean;
  account: { chargesEnabled: boolean; detailsSubmitted: boolean; payoutsEnabled: boolean } | null;
};

/** Cobros: cada tienda conecta su propia cuenta de Stripe (Stripe Connect). */
export function PaymentsSettings() {
  const { store } = useStore();
  const manager = store.role !== 'staff';
  const [p, setP] = useState<Payments | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setP(await api<Payments>(`/v1/stores/${store.id}/payments/refresh`, { method: 'POST' })); }
    catch (e) { setMsg({ kind: 'error', text: humanError(e) }); }
  }, [store.id]);

  useEffect(() => {
    const back = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('stripe') : null;
    api<Payments>(`/v1/stores/${store.id}/payments`).then((r) => {
      setP(r);
      // Al volver del alta de Stripe (o si quedó a medias) se pregunta a Stripe por el estado real.
      if (r.mode === 'connect' && r.account && (!r.ready || back)) refresh();
      if (back === 'volver') document.getElementById('cobros')?.scrollIntoView();
    }).catch((e) => setMsg({ kind: 'error', text: humanError(e) }));
  }, [store.id, refresh]);

  async function go(path: 'connect' | 'dashboard') {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ url: string }>(`/v1/stores/${store.id}/payments/${path}`, { method: 'POST' });
      if (path === 'connect') window.location.assign(r.url); else window.open(r.url, '_blank', 'noopener');
    } catch (e) { setMsg({ kind: 'error', text: humanError(e) }); } finally { setBusy(false); }
  }

  if (!p) return msg ? <div className="mt-5"><Notice kind="error">{msg.text}</Notice></div> : null;
  const status = p.mode !== 'connect' ? null
    : p.ready ? <Badge tone="success" dot>Lista para cobrar</Badge>
    : p.account ? <Badge tone="warning" dot>Alta pendiente</Badge>
    : <Badge tone="neutral" dot>Sin conectar</Badge>;

  return (
    <section id="cobros" className="mt-8 space-y-5" aria-label="Cobros">
      <h2 className="text-lg font-semibold tracking-tight">Cobros</h2>
      {msg && <Notice kind={msg.kind === 'info' ? 'info' : msg.kind} onDismiss={() => setMsg(null)}>{msg.text}</Notice>}
      <Card>
        {p.mode === 'fake' && (
          <SettingsSection title="Modo de prueba" description="Los pagos de esta instalación son simulados: no se cobra dinero real.">
            <p className="text-[13px] text-muted">En la tienda aparece un botón «Pagar (simulado)». En producción se usa Stripe.</p>
          </SettingsSection>
        )}
        {p.mode === 'platform' && (
          <SettingsSection title="Cuenta de la plataforma" description="Los cobros de esta instalación llegan a una única cuenta de Stripe.">
            <p className="text-[13px] text-muted">No tienes que hacer nada para empezar a vender.</p>
          </SettingsSection>
        )}
        {p.mode === 'connect' && (
          <SettingsSection title={<span className="flex items-center gap-2">Tu cuenta de Stripe {status}</span>}
            description="El dinero de tus ventas llega directamente a tu cuenta de Stripe, y Stripe te lo transfiere a tu banco.">
            <div className="space-y-3 text-[13px]">
              {!p.account && <p>Para vender necesitas conectar una cuenta de Stripe. Te pedirá tus datos y tu cuenta bancaria; se tarda unos 5 minutos.</p>}
              {p.account && !p.ready && <p>Stripe todavía necesita algún dato para activar los cobros. Continúa el alta donde la dejaste.</p>}
              {p.ready && <p>Tu tienda ya puede cobrar con tarjeta.{p.account?.payoutsEnabled ? '' : ' Stripe aún está revisando tu cuenta bancaria para las transferencias.'}</p>}
              {p.platformFeeBp > 0 && <p className="text-muted">Comisión de la plataforma: {(p.platformFeeBp / 100).toLocaleString('es-ES')} % de cada venta (además de la de Stripe).</p>}
              {manager ? (
                <div className="flex flex-wrap gap-2">
                  {!p.ready && <Button type="button" onClick={() => go('connect')} disabled={busy}>{busy ? 'Abriendo Stripe…' : p.account ? 'Continuar el alta en Stripe' : 'Conectar con Stripe'}</Button>}
                  {p.account?.detailsSubmitted && <Button type="button" variant="secondary" onClick={() => go('dashboard')} disabled={busy}>Ver mis cobros en Stripe</Button>}
                  {p.account && !p.ready && <Button type="button" variant="secondary" onClick={refresh} disabled={busy}>Comprobar estado</Button>}
                </div>
              ) : <p className="text-muted">Solo un propietario o administrador puede conectar la cuenta.</p>}
            </div>
          </SettingsSection>
        )}
      </Card>
    </section>
  );
}

type Design = { accentColor: string | null; headline: string | null; tagline: string | null; logo: string | null; banner: string | null };
const DEFAULT_COLOR = '#4f46e5';

/** Diseño de la tienda: color, logo, portada y textos de bienvenida. */
export function DesignSettings() {
  const { store } = useStore();
  const canWrite = store.permissions.includes('settings:write');
  const [d, setD] = useState<Design | null>(null);
  const [form, setForm] = useState({ color: DEFAULT_COLOR, headline: '', tagline: '' });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  const apply = (r: Design) => { setD(r); setForm({ color: r.accentColor ?? DEFAULT_COLOR, headline: r.headline ?? '', tagline: r.tagline ?? '' }); };
  useEffect(() => {
    api<Design>(`/v1/stores/${store.id}/design`).then(apply).catch((e) => setMsg({ kind: 'error', text: humanError(e) }));
  }, [store.id]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy('save'); setMsg(null);
    try {
      apply(await api<Design>(`/v1/stores/${store.id}/design`, { method: 'PATCH', body: {
        accentColor: form.color.toLowerCase() === DEFAULT_COLOR && !d?.accentColor ? null : form.color, headline: form.headline.trim() || null, tagline: form.tagline.trim() || null,
      } }));
      setMsg({ kind: 'success', text: 'Diseño guardado. Ya se ve en tu tienda.' });
    } catch (err) { setMsg({ kind: 'error', text: humanError(err) }); } finally { setBusy(null); }
  }

  async function upload(slot: 'logo' | 'banner', files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setBusy(slot); setMsg(null);
    try { apply(await api<Design>(`/v1/stores/${store.id}/design/${slot}`, { method: 'POST', file: f })); }
    catch (err) { setMsg({ kind: 'error', text: humanError(err) }); }
    finally { setBusy(null); if (logoInput.current) logoInput.current.value = ''; if (bannerInput.current) bannerInput.current.value = ''; }
  }

  async function remove(slot: 'logo' | 'banner') {
    setBusy(slot); setMsg(null);
    try { apply(await api<Design>(`/v1/stores/${store.id}/design/${slot}`, { method: 'DELETE' })); }
    catch (err) { setMsg({ kind: 'error', text: humanError(err) }); } finally { setBusy(null); }
  }

  if (!d) return msg ? <div className="mt-5"><Notice kind="error">{msg.text}</Notice></div> : null;
  const image = (slot: 'logo' | 'banner', label: string, hint: string, ref: React.RefObject<HTMLInputElement | null>) => (
    <div>
      <p className="mb-1.5 text-[13px] font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <div className={`grid shrink-0 place-items-center overflow-hidden rounded-[10px] bg-surface-3 ring-1 ring-border ${slot === 'logo' ? 'size-16' : 'h-16 w-40'}`}>
          {d[slot] ? <img src={`/media/${d[slot]}`} alt="" className={`size-full ${slot === 'logo' ? 'object-contain' : 'object-cover'}`} />
            : <span className="text-xs text-subtle">Sin {slot === 'logo' ? 'logo' : 'portada'}</span>}
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center rounded-[var(--radius)] border border-border-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
              {busy === slot ? 'Subiendo…' : d[slot] ? 'Cambiar' : 'Subir imagen'}
              <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={label} disabled={busy !== null} onChange={(e) => upload(slot, e.target.files)} />
            </label>
            {d[slot] && <Button type="button" size="sm" variant="danger-plain" onClick={() => remove(slot)} disabled={busy !== null}>Quitar</Button>}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );

  return (
    <form onSubmit={save} className="mt-8 space-y-5" aria-label="Diseño de la tienda">
      <h2 className="text-lg font-semibold tracking-tight">Diseño de la tienda</h2>
      {msg && <Notice kind={msg.kind === 'info' ? 'info' : msg.kind} onDismiss={() => setMsg(null)}>{msg.text}</Notice>}
      <Card>
        <SettingsSection title="Marca" description="Tu logo y tu color aparecen en la cabecera, los botones y los enlaces de la tienda.">
          <div className="space-y-4">
            {image('logo', 'Logo', 'PNG con fondo transparente si puedes. Máximo 5 MB.', logoInput)}
            <Field label="Color principal">
              <div className="flex items-center gap-2">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} disabled={!canWrite}
                  aria-label="Elegir color" className="h-9 w-12 cursor-pointer rounded-[var(--radius)] border border-border-strong bg-surface p-1" />
                <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} disabled={!canWrite} className="max-w-[120px] font-mono" maxLength={7} />
              </div>
            </Field>
          </div>
        </SettingsSection>
        <SettingsSection title="Portada" description="Lo primero que ven tus clientes al entrar en la tienda.">
          <div className="space-y-4">
            {image('banner', 'Imagen de portada', 'Horizontal, al menos 1600 × 600 px.', bannerInput)}
            <Field label="Titular"><Input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} maxLength={120} placeholder="Ropa hecha a mano en Sevilla" disabled={!canWrite} /></Field>
            <Field label="Subtítulo"><Input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} maxLength={300} placeholder="Envíos en 48 h a toda España" disabled={!canWrite} /></Field>
          </div>
        </SettingsSection>
      </Card>
      {canWrite && <div className="flex justify-end"><Button type="submit" disabled={busy !== null}>{busy === 'save' ? 'Guardando…' : 'Guardar diseño'}</Button></div>}
    </form>
  );
}
