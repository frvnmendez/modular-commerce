'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, humanError } from '@/lib/api';
import { Button, Card, Field, Input, Notice, Select } from '@/components/ui';

const MODULE_NAMES: Record<string, string> = {
  'com.plataforma.payments-stripe': 'Pagos con tarjeta',
  'com.plataforma.shipping-adapter': 'Envíos y transportistas',
  'com.plataforma.dropshipping-connector': 'Conector de proveedores (dropshipping)',
};

const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/** Onboarding: 8 preguntas → perfil de capacidades → módulos recomendados. Todo se puede cambiar después. */
export default function Onboarding() {
  const router = useRouter();
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

  if (done) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12 space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tu tienda está creada</h1>
        <Card title="Te recomendamos activar" description="Según lo que nos has contado. Los módulos se podrán instalar en una próxima versión.">
          <ul className="space-y-2 text-sm">{done.recommendedModules.map((m) => <li key={m} className="rounded-[var(--radius)] bg-surface-2 px-3 py-2">{MODULE_NAMES[m] ?? m}</li>)}</ul>
        </Card>
        <Button onClick={() => router.replace(`/stores/${done.id}`)}>Ir al panel</Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Cuéntanos sobre tu negocio</h1>
      <p className="mt-1 text-sm text-muted">Con esto preparamos un panel a tu medida. Podrás cambiarlo todo después.</p>
      <form action={submit} className="mt-8 space-y-6">
        {error && <Notice kind="error">{error}</Notice>}
        <Card title="Tu tienda">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre de la tienda"><Input required minLength={2} maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setSlug(slugify(e.target.value)); }} /></Field>
            <Field label="Dirección" hint={`${slug || 'mi-tienda'}.plataforma.com`}><Input required pattern="[a-z0-9][a-z0-9-]{1,46}[a-z0-9]" value={slug} onChange={(e) => setSlug(e.target.value)} /></Field>
            <Field label="Empresa u organización" hint="Puede tener varias tiendas."><Input name="org" placeholder={name || 'Mi empresa'} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="País"><Select name="country" defaultValue="ES">{['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'PT', 'FR', 'US'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Moneda"><Select name="currency" defaultValue="EUR">{['EUR', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'USD'].map((c) => <option key={c}>{c}</option>)}</Select></Field>
            </div>
          </div>
        </Card>
        <Card title="Qué vendes y cómo">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo de negocio"><Select name="businessType" defaultValue="fashion">
              <option value="fashion">Moda</option><option value="beauty">Belleza</option><option value="home">Hogar</option><option value="electronics">Electrónica</option>
              <option value="food">Alimentación</option><option value="digital">Productos digitales</option><option value="services">Servicios</option><option value="other">Otro</option>
            </Select></Field>
            <Field label="Tipo de productos"><Select name="productKinds" defaultValue="physical"><option value="physical">Físicos</option><option value="digital">Digitales</option><option value="both">Ambos</option></Select></Field>
            <Field label="Inventario"><Select name="fulfillment" defaultValue="own-inventory"><option value="own-inventory">Inventario propio</option><option value="dropshipping">Dropshipping</option><option value="both">Ambos</option></Select></Field>
            <Field label="Envíos"><Select name="shippingNeeds" defaultValue="domestic"><option value="none">No envío</option><option value="domestic">Nacionales</option><option value="international">Internacionales</option></Select></Field>
            <Field label="Mercados" hint="Códigos de país separados por comas, p. ej. ES, PT"><Input name="markets" defaultValue="ES" required /></Field>
            <Field label="Experiencia técnica"><Select name="technicalLevel" defaultValue="beginner"><option value="beginner">Principiante</option><option value="intermediate">Intermedia</option><option value="advanced">Avanzada</option></Select></Field>
            <Field label="Objetivo principal"><Select name="goal" defaultValue="first-sales"><option value="first-sales">Primeras ventas</option><option value="grow-revenue">Crecer ingresos</option><option value="migrate-store">Migrar otra tienda</option><option value="brand-building">Construir marca</option></Select></Field>
          </div>
        </Card>
        <Button type="submit" disabled={busy}>{busy ? 'Creando…' : 'Crear tienda'}</Button>
      </form>
    </main>
  );
}
