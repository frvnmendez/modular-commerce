'use client';
import { use } from 'react';
import { Button, Card, EmptyState, PageHeader, SoonBadge } from '@/components/ui';
import { IconBox, IconFactory, IconInbox, IconReturn, IconTag, IconTruck, IconUser } from '@/components/icons';

type Section = { title: string; subtitle: string; action: string; heading: string; body: string; columns: string[]; icon: React.ReactNode };

const SECTIONS: Record<string, Section> = {
  products: { title: 'Productos', subtitle: 'Tu catálogo: fotos, variantes y precios.', action: 'Añadir producto', heading: 'Tu catálogo vivirá aquí',
    body: 'Crea productos con fotos, variantes de talla y color, y precios. Los publicarás en tu tienda con un clic.', columns: ['Producto', 'Estado', 'Inventario', 'Precio'], icon: <IconTag /> },
  inventory: { title: 'Inventario', subtitle: 'Existencias por producto y variante.', action: 'Ajustar existencias', heading: 'Controla tu stock',
    body: 'Consulta las existencias de cada variante y recibe un aviso cuando algo se esté agotando.', columns: ['Producto', 'Disponible', 'Reservado', 'Ubicación'], icon: <IconBox /> },
  suppliers: { title: 'Proveedores', subtitle: 'Catálogos de proveedores y dropshipping.', action: 'Conectar proveedor', heading: 'Vende sin tener stock',
    body: 'Conecta catálogos de proveedores y envíales los pedidos automáticamente cuando alguien compra.', columns: ['Proveedor', 'Productos', 'Pedidos', 'Estado'], icon: <IconFactory /> },
  orders: { title: 'Pedidos', subtitle: 'Ventas, pagos y preparación.', action: 'Crear pedido', heading: 'Aquí llegarán tus ventas',
    body: 'Cada pedido con su pago, su envío y su cliente en un solo sitio, listo para preparar.', columns: ['Pedido', 'Fecha', 'Cliente', 'Total', 'Pago', 'Preparación'], icon: <IconInbox /> },
  shipping: { title: 'Envíos', subtitle: 'Tarifas, etiquetas y seguimiento.', action: 'Configurar tarifas', heading: 'Prepara tus envíos',
    body: 'Define tarifas por zona, imprime etiquetas y comparte el seguimiento con tus clientes.', columns: ['Envío', 'Pedido', 'Transportista', 'Estado'], icon: <IconTruck /> },
  returns: { title: 'Devoluciones', subtitle: 'Solicitudes, etiquetas de vuelta y reembolsos.', action: 'Crear devolución', heading: 'Devoluciones sin papeleo',
    body: 'Aprueba devoluciones, genera la etiqueta de vuelta y reembolsa desde el propio pedido.', columns: ['Devolución', 'Pedido', 'Motivo', 'Estado'], icon: <IconReturn /> },
  customers: { title: 'Clientes', subtitle: 'Quién te compra y cuánto.', action: 'Añadir cliente', heading: 'Conoce a tus clientes',
    body: 'Historial de compras, datos de contacto y segmentos para tus campañas, en una sola ficha.', columns: ['Cliente', 'Pedidos', 'Gasto total', 'Ubicación'], icon: <IconUser /> },
};

/** Secciones del Release 2 en adelante: estado vacío honesto que explica lo que llega, sin datos simulados. */
export default function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = use(params);
  const s = SECTIONS[section] ?? { title: 'Sección', subtitle: '', action: '', heading: 'Sección en preparación', body: 'Esta sección llega en una próxima versión.', columns: [], icon: <IconBox /> };
  return (
    <div className="mc-rise">
      <PageHeader title={s.title} subtitle={s.subtitle} badge={<SoonBadge />}
        primary={s.action ? <Button disabled title="Disponible en la próxima versión">{s.action}</Button> : undefined} />
      <Card flush>
        {s.columns.length > 0 && <PreviewTable columns={s.columns} />}
        <EmptyState illustration={<Illustration icon={s.icon} />} title={s.heading}
          body={<>{s.body}<span className="mt-2 block">Llega en la próxima versión de la plataforma. Te avisaremos cuando esté disponible.</span></>} />
      </Card>
    </div>
  );
}

/** Vista previa de la tabla que tendrá la sección: solo cabeceras y filas vacías, marcada como decorativa. */
function PreviewTable({ columns }: { columns: string[] }) {
  return (
    <div aria-hidden className="relative -mt-3 overflow-hidden border-b border-border">
      <div className="grid border-b border-border bg-surface-2 px-5 py-2 text-xs font-medium text-muted" style={{ gridTemplateColumns: `2fr repeat(${columns.length - 1}, 1fr)` }}>
        {columns.map((c) => <span key={c} className="truncate pr-3">{c}</span>)}
      </div>
      {[0.9, 0.6, 0.35].map((o) => (
        <div key={o} className="grid items-center border-b border-border px-5 py-3 last:border-b-0" style={{ opacity: o, gridTemplateColumns: `2fr repeat(${columns.length - 1}, 1fr)` }}>
          <span className="flex items-center gap-3 pr-3"><span className="size-8 shrink-0 rounded-md bg-surface-3" /><span className="h-2.5 w-2/3 rounded bg-surface-3" /></span>
          {columns.slice(1).map((c) => <span key={c} className="pr-3"><span className="block h-2.5 w-1/2 rounded bg-surface-3" /></span>)}
        </div>
      ))}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-surface" />
    </div>
  );
}

function Illustration({ icon }: { icon: React.ReactNode }) {
  return (
    <div aria-hidden className="relative size-24">
      <span className="absolute inset-2 rotate-6 rounded-3xl bg-accent-soft" />
      <span className="absolute inset-2 -rotate-3 rounded-3xl bg-surface shadow-card ring-1 ring-border" />
      <span className="absolute inset-0 grid place-items-center text-accent [&>svg]:size-10">{icon}</span>
    </div>
  );
}
