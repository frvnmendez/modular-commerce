'use client';
import { use } from 'react';
import { EmptyState } from '@/components/ui';

const TITLES: Record<string, string> = {
  products: 'Productos', inventory: 'Inventario', suppliers: 'Proveedores', orders: 'Pedidos', shipping: 'Envíos',
  returns: 'Devoluciones', customers: 'Clientes',
};

/** Secciones del Release 2 en adelante: estado vacío honesto en lugar de una pantalla simulada. */
export default function Section({ params }: { params: Promise<{ section: string }> }) {
  const { section } = use(params);
  return <EmptyState title={TITLES[section] ?? 'Sección'} body="Esta sección llega en la próxima versión de la plataforma. Te avisaremos cuando esté disponible." />;
}
