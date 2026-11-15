'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, humanError } from '@/lib/api';
import { Button, Card, Field, Input, Notice, Select, SoonBadge } from '@/components/ui';
import { BrandMark, IconApple, IconCheck, IconChip, IconDownload, IconDrop, IconDots, IconShirt, IconSofa, IconWrench } from '@/components/icons';

const MODULE_NAMES: Record<string, string> = {
  'com.plataforma.payments-stripe': 'Pagos con tarjeta',
  'com.plataforma.shipping-adapter': 'Envíos y transportistas',
  'com.plataforma.dropshipping-connector': 'Conector de proveedores (dropshipping)',
};

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

const BUSINESS: [string, string, React.ReactNode][] = [
  ['fashion', 'Moda', <IconShirt key="f" />], ['beauty', 'Belleza', <IconDrop key="b" />], ['home', 'Hogar', <IconSofa key="h" />],
  ['electronics', 'Electrónica', <IconChip key="e" />], ['food', 'Alimentación', <IconApple key="a" />], ['digital', 'Productos digitales', <IconDownload key="d" />],
  ['services', 'Servicios', <IconWrench key="s" />], ['other', 'Otro', <IconDots key="o" />],
];
const STEPS = [
  { title: 'Tu tienda', subtitle: 'Nombre, dirección y moneda.' },
  { title: 'Qué vendes', subtitle: 'Así preparamos el menú que necesitas.' },
  { title: 'Tus objetivos', subtitle: 'Dónde vendes y qué quieres conseguir.' },
];

/** Onboarding en 3 pasos: 8 preguntas → perfil de capacidades → módulos recomendados. Todo se puede cambiar después. */
export default function Onboarding() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; recommendedModules: string[] } | null>(null);

  async function submit(f: FormData) {
    setBusy(true); setError(null);
    try {
      const org = await api<{ id: string }>('/v1/organizations', { method: 'POST', body: { name: String(f.get('org') || name) } });
      const store = await api<{ id: string; recommendedModules: string[] }>(`/v1/organizations/${org.id}/stores`, {
        method: 'POST',
        body: {
          name, slug, country: f.get('country'), currency: f.get('currency'),
          profile: {
            businessType: f.get('businessType'), productKinds: f.get('productKinds'), fulfillment: f.get('fulfillment'),
            markets: String(f.get('markets')).split(',').map((m) => m.trim().toUpperCase()).filter(Boolean),
            shippingNeeds: f.get('shippingNeeds'), technicalLevel: f.get('technicalLevel'), goals: [f.get('goal')],
          },
        },
      });
      setDone(store);
    } catch (e) { setError(humanError(e)); } finally { setBusy(false); }
  }

  /** Valida solo los campos del paso visible antes de avanzar (los ocultos no se pueden enfocar). */
  function next() {
    const fields = formRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[data-step="${step}"] :is(input, select)`) ?? [];
    for (const el of fields) if (!el.checkValidity()) { el.reportValidity(); return; }
    setStep((s) => s + 1);
  }

  if (done) {
    return (
      <Shell>
        <div className="mc-rise mx-auto max-w-lg text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success"><IconCheck size={28} strokeWidth={2.5} /></span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Tu tienda está creada</h1>
          <p className="mt-1 text-[13px] text-muted">{name} ya tiene su panel, preparado según lo que nos has contado.</p>
        </div>
        <div className="mx-auto mt-8 max-w-lg text-left">
          <Card title="Te recomendamos activar" description="Según lo que nos has contado. Los módulos se podrán instalar en una próxima versión.">
            <ul className="space-y-2">{done.recommendedModules.map((m) => (
              <li key={m} className="flex items-center justify-between gap-3 rounded-[10px] border border-border px-3 py-2.5 text-[13px] font-medium">{MODULE_NAMES[m] ?? m}<SoonBadge /></li>
            ))}</ul>
          </Card>
          <Button className="mt-5 h-10 w-full" onClick={() => router.replace(`/stores/${done.id}`)}>Ir al panel</Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-2xl">
        <ol aria-label="Pasos" className="mb-8 grid grid-cols-3 gap-2">
          {STEPS.map((s, i) => (
            <li key={s.title} aria-current={i === step ? 'step' : undefined}>
              <span className={`block h-1 rounded-full transition-colors ${i <= step ? 'bg-accent' : 'bg-surface-3'}`} />
              <span className={`mt-2 block text-xs ${i === step ? 'font-semibold text-text' : 'text-muted'}`}>{i + 1}. {s.title}</span>
            </li>
          ))}
        </ol>
        <h1 className="text-2xl font-semibold tracking-tight">{step === 0 ? 'Cuéntanos sobre tu negocio' : STEPS[step]!.title}</h1>
        <p className="mt-1 text-[13px] text-muted">{step === 0 ? 'Con esto preparamos un panel a tu medida. Podrás cambiarlo todo después.' : STEPS[step]!.subtitle}</p>
        <form ref={formRef} action={submit} className="mt-6 space-y-5"
          onKeyDown={(e) => { if (e.key === 'Enter' && step < 2 && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); next(); } }}>
          {error && <Notice kind="error">{error}</Notice>}
          <div data-step="0" hidden={step !== 0}>
            <Card>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre de la tienda"><Input required minLength={2} maxLength={80} value={name} placeholder="Ana Moda" onChange={(e) => { setName(e.target.value); setSlug(slugify(e.target.value)); }} /></Field>
                <Field label="Dirección" hint={<><span className="font-medium text-text">{slug || 'mi-tienda'}</span>.plataforma.com</>}><Input required pattern="[a-z0-9][a-z0-9\-]{1,46}[a-z0-9]" value={slug} onChange={(e) => setSlug(e.target.value)} /></Field>
                <Field label="Empresa u organización" hint="Puede tener varias tiendas."><Input name="org" placeholder={name || 'Mi empresa'} /></Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="País"><Select name="country" defaultValue="ES">{['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'PT', 'FR', 'US'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
                  <Field label="Moneda"><Select name="currency" defaultValue="EUR">{['EUR', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'USD'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
                </div>
              </div>
            </Card>
          </div>
          <div data-step="1" hidden={step !== 1} className="space-y-5">
            <Card title="Tipo de negocio">
              <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <legend className="sr-only">Tipo de negocio</legend>
                {BUSINESS.map(([v, l, icon]) => (
                  <label key={v} className="flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border border-border px-2 py-3 text-center text-[13px] font-medium transition-colors hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                    <input type="radio" name="businessType" value={v} defaultChecked={v === 'fashion'} className="sr-only" />
                    <span className="[&>svg]:size-6">{icon}</span>{l}
                  </label>
                ))}
              </fieldset>
            </Card>
            <Card>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tipo de productos"><Select name="productKinds" defaultValue="physical"><option value="physical">Físicos</option><option value="digital">Digitales</option><option value="both">Ambos</option></Select></Field>
                <Field label="Inventario"><Select name="fulfillment" defaultValue="own-inventory"><option value="own-inventory">Inventario propio</option><option value="dropshipping">Dropshipping</option><option value="both">Ambos</option></Select></Field>
                <Field label="Envíos"><Select name="shippingNeeds" defaultValue="domestic"><option value="none">No envío</option><option value="domestic">Nacionales</option><option value="international">Internacionales</option></Select></Field>
              </div>
            </Card>
          </div>
          <div data-step="2" hidden={step !== 2}>
            <Card>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Mercados" hint="Códigos de país separados por comas, p. ej. ES, PT"><Input name="markets" defaultValue="ES" required /></Field>
                <Field label="Experiencia técnica"><Select name="technicalLevel" defaultValue="beginner"><option value="beginner">Principiante</option><option value="intermediate">Intermedia</option><option value="advanced">Avanzada</option></Select></Field>
                <Field label="Objetivo principal"><Select name="goal" defaultValue="first-sales"><option value="first-sales">Primeras ventas</option><option value="grow-revenue">Crecer ingresos</option><option value="migrate-store">Migrar otra tienda</option><option value="brand-building">Construir marca</option></Select></Field>
              </div>
            </Card>
          </div>
          <div className="flex items-center justify-between gap-3">
            {step > 0 ? <Button type="button" variant="secondary" onClick={() => setStep(step - 1)}>Atrás</Button> : <span />}
            {step < 2
              // Claves distintas: si React reutilizara el botón, el clic en «Continuar» acabaría enviando el formulario.
              ? <Button key="next" type="button" onClick={next}>Continuar</Button>
              : <Button key="submit" type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear tienda'}</Button>}
          </div>
        </form>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center gap-2 bg-ink px-4 text-ink-text"><BrandMark size={24} /><span className="text-[15px] font-semibold tracking-tight">modular</span></header>
      <main className="px-4 py-10">{children}</main>
    </div>
  );
}
