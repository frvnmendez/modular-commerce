'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, humanError } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { centsToInput, formatMoney, parseMoney } from '@/lib/money';
import { Button, Card, Field, Input, Notice, PageHeader, PageSkeleton, Select } from '@/components/ui';
import { IconClose, IconPlus } from '@/components/icons';

type Variant = { id?: string; title: string; sku: string; price: string; compareAt: string; stock: string; hasOrders?: boolean };
type Product = {
  id: string; title: string; handle: string; description: string; status: 'draft' | 'active' | 'archived';
  variants: { id: string; title: string; sku: string | null; price: number; compareAt: number | null; stock: number; hasOrders: boolean }[];
  images: { id: string; path: string }[];
};

const emptyVariant = (): Variant => ({ title: '', sku: '', price: '', compareAt: '', stock: '0' });

export default function ProductEditor({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  const isNew = productId === 'new';
  const { store } = useStore();
  const router = useRouter();
  const canWrite = store.permissions.includes('catalog:write');
  const [loaded, setLoaded] = useState(isNew);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<Product['status']>('active');
  const [handle, setHandle] = useState('');
  const [variants, setVariants] = useState<Variant[]>([{ ...emptyVariant(), title: 'Única' }]);
  const [images, setImages] = useState<Product['images']>([]);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function fill(p: Product) {
    setTitle(p.title); setDescription(p.description); setStatus(p.status); setHandle(p.handle); setImages(p.images);
    setVariants(p.variants.map((v) => ({ id: v.id, title: v.title, sku: v.sku ?? '', price: centsToInput(v.price), compareAt: centsToInput(v.compareAt), stock: String(v.stock), hasOrders: v.hasOrders })));
  }
  useEffect(() => {
    if (isNew) return;
    api<Product>(`/v1/stores/${store.id}/products/${productId}`).then((p) => { fill(p); setLoaded(true); }).catch((e) => setMsg({ kind: 'error', text: humanError(e) }));
  }, [isNew, productId, store.id]);

  const setVariant = (i: number, patch: Partial<Variant>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Ponle un nombre al producto.';
    const parsed = variants.map((v, i) => {
      const price = parseMoney(v.price);
      const compareAt = v.compareAt.trim() ? parseMoney(v.compareAt) : null;
      const stock = Number(v.stock);
      if (!v.title.trim()) errs[`v${i}.title`] = 'Nombre obligatorio (p. ej. «M» o «Rojo»).';
      if (price === null) errs[`v${i}.price`] = 'Precio no válido (p. ej. 19,99).';
      if (v.compareAt.trim() && (compareAt === null || (price !== null && compareAt <= price))) errs[`v${i}.compareAt`] = 'Debe ser mayor que el precio.';
      if (!Number.isInteger(stock) || stock < 0) errs[`v${i}.stock`] = 'Número entero, 0 o más.';
      return { ...(v.id ? { id: v.id } : {}), title: v.title.trim(), sku: v.sku.trim() || null, price: price ?? 0, compareAt, stock };
    });
    if (handle && !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(handle)) errs.handle = 'Solo minúsculas, números y guiones.';
    setErrors(errs);
    if (Object.keys(errs).length) { setMsg({ kind: 'error', text: 'Revisa los campos marcados.' }); return; }
    setBusy(true);
    try {
      const body = { title: title.trim(), description, status, variants: parsed, ...(handle ? { handle } : {}) };
      if (isNew) {
        const p = await api<Product>(`/v1/stores/${store.id}/products`, { method: 'POST', body });
        router.replace(`/stores/${store.id}/products/${p.id}?creado=1`);
      } else {
        fill(await api<Product>(`/v1/stores/${store.id}/products/${productId}`, { method: 'PUT', body }));
        setMsg({ kind: 'success', text: 'Producto guardado.' });
      }
    } catch (err) { setMsg({ kind: 'error', text: humanError(err) }); } finally { setBusy(false); }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setMsg(null);
    try {
      for (const f of Array.from(files)) {
        const img = await api<{ id: string; path: string }>(`/v1/stores/${store.id}/products/${productId}/images`, { method: 'POST', file: f });
        setImages((xs) => [...xs, img]);
      }
    } catch (err) { setMsg({ kind: 'error', text: humanError(err) }); } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function removeImage(id: string) {
    try { await api(`/v1/stores/${store.id}/products/${productId}/images/${id}`, { method: 'DELETE' }); setImages((xs) => xs.filter((x) => x.id !== id)); }
    catch (err) { setMsg({ kind: 'error', text: humanError(err) }); }
  }

  async function remove() {
    try { await api(`/v1/stores/${store.id}/products/${productId}`, { method: 'DELETE' }); router.replace(`/stores/${store.id}/products`); }
    catch (err) { setConfirmDelete(false); setMsg({ kind: 'error', text: humanError(err) }); }
  }

  if (!loaded) return msg ? <Notice kind="error">{msg.text}</Notice> : <PageSkeleton label="Cargando producto…" />;
  const created = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('creado');
  const storeUrl = `${store.storeUrl}/producto/${handle}`;

  return (
    <form onSubmit={save} className="mc-rise" noValidate>
      <PageHeader title={isNew ? 'Añadir producto' : title || 'Producto'} back={{ href: `/stores/${store.id}/products`, label: 'Volver a productos' }}
        secondary={!isNew && status === 'active' ? <a href={storeUrl} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-accent-text hover:underline">Ver en la tienda</a> : undefined}
        primary={canWrite ? <Button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</Button> : undefined} />
      <div className="space-y-5">
        {created && !msg && <Notice kind="success">Producto creado. Ahora puedes añadirle fotos.</Notice>}
        {msg && <Notice kind={msg.kind} onDismiss={() => setMsg(null)}>{msg.text}</Notice>}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-5">
            <Card>
              <div className="space-y-4">
                <Field label="Nombre" error={errors.title}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Camiseta de algodón" required /></Field>
                <Field label="Descripción" hint="Cuenta qué es, de qué está hecho y cómo cuidarlo.">
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={5}
                    className="w-full rounded-[var(--radius)] border border-border-strong/80 bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]" />
                </Field>
              </div>
            </Card>

            <Card title="Fotos" description={isNew ? 'Guarda el producto primero y después añade las fotos.' : 'JPG, PNG o WebP, hasta 5 MB cada una. La primera es la portada.'}>
              {!isNew && (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {images.map((img) => (
                    <div key={img.id} className="group relative aspect-square overflow-hidden rounded-[10px] ring-1 ring-border">
                      <img src={`/media/${img.path}`} alt="" className="size-full object-cover" />
                      {canWrite && <button type="button" onClick={() => removeImage(img.id)} aria-label="Quitar foto"
                        className="absolute top-1 right-1 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-90 hover:opacity-100"><IconClose size={14} /></button>}
                    </div>
                  ))}
                  {canWrite && images.length < 10 && (
                    <label className="grid aspect-square cursor-pointer place-items-center rounded-[10px] border-[1.5px] border-dashed border-border-strong text-center text-xs text-muted hover:bg-surface-2">
                      <span><IconPlus size={20} className="mx-auto mb-1" />{uploading ? 'Subiendo…' : 'Añadir foto'}</span>
                      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={uploading} onChange={(e) => upload(e.target.files)} />
                    </label>
                  )}
                </div>
              )}
            </Card>

            <Card title="Opciones, precio y stock" description="Una fila por cada talla, color o modelo. Si solo hay uno, déjalo como «Única».">
              <div className="space-y-3">
                {variants.map((v, i) => (
                  <fieldset key={v.id ?? `n${i}`} className="grid gap-3 rounded-[10px] border border-border p-3 sm:grid-cols-[1.4fr_1fr_1fr_0.8fr_auto]">
                    <legend className="sr-only">Opción {i + 1}</legend>
                    <Field label="Opción" error={errors[`v${i}.title`]}><Input value={v.title} onChange={(e) => setVariant(i, { title: e.target.value })} maxLength={120} placeholder="M / Rojo" /></Field>
                    <Field label="Precio" error={errors[`v${i}.price`]}><Input inputMode="decimal" value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} placeholder="19,99" /></Field>
                    <Field label="Precio antes" error={errors[`v${i}.compareAt`]}><Input inputMode="decimal" value={v.compareAt} onChange={(e) => setVariant(i, { compareAt: e.target.value })} placeholder="Opcional" /></Field>
                    <Field label="Stock" error={errors[`v${i}.stock`]}><Input inputMode="numeric" value={v.stock} onChange={(e) => setVariant(i, { stock: e.target.value.replace(/\D/g, '') })} /></Field>
                    <div className="flex items-end">
                      <Button type="button" variant="danger-plain" size="sm" disabled={variants.length === 1 || v.hasOrders}
                        title={v.hasOrders ? 'Tiene pedidos: déjala sin stock' : 'Quitar opción'} onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>Quitar</Button>
                    </div>
                    <div className="sm:col-span-5"><Field label="SKU (código interno, opcional)"><Input value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} maxLength={64} className="sm:max-w-xs" /></Field></div>
                  </fieldset>
                ))}
                {variants.length < 100 && <Button type="button" variant="secondary" size="sm" onClick={() => setVariants((vs) => [...vs, emptyVariant()])}><IconPlus size={14} />Añadir opción</Button>}
              </div>
            </Card>
          </div>

          <div className="space-y-5">
            <Card title="Estado">
              <Select value={status} onChange={(e) => setStatus(e.target.value as Product['status'])} aria-label="Estado del producto">
                <option value="active">Activo: se ve en la tienda</option>
                <option value="draft">Borrador: oculto</option>
                <option value="archived">Archivado: oculto</option>
              </Select>
            </Card>
            <Card title="Dirección web" description="Se crea sola a partir del nombre.">
              <Field label="Identificador" error={errors.handle} hint={handle ? `${store.storeUrl.replace(/^https?:\/\//, "")}/producto/${handle}` : undefined}>
                <Input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} placeholder="se genera al guardar" maxLength={100} />
              </Field>
            </Card>
            {!isNew && variants.length > 0 && (
              <Card title="Resumen">
                <p className="text-[13px] text-muted">
                  {variants.reduce((a, v) => a + (Number(v.stock) || 0), 0)} unidades en stock · desde {formatMoney(Math.min(...variants.map((v) => parseMoney(v.price) ?? 0)), store.currency)}
                </p>
              </Card>
            )}
            {!isNew && canWrite && (
              <Card>
                {confirmDelete ? (
                  <div className="space-y-2 text-[13px]">
                    <p>¿Borrar «{title}»? No se puede deshacer.</p>
                    <div className="flex gap-2"><Button type="button" variant="danger" size="sm" onClick={remove}>Sí, borrar</Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>Cancelar</Button></div>
                  </div>
                ) : <Button type="button" variant="danger-plain" size="sm" onClick={() => setConfirmDelete(true)}>Borrar producto</Button>}
              </Card>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
