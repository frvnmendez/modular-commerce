'use client';
import { useEffect, useState } from 'react';
import { api, humanError } from '@/lib/api';
import Link from 'next/link';
import { Badge, Card, Notice, PageHeader } from '@/components/ui';
import { BrandMark } from '@/components/icons';

type Row = { id: string; name: string; slug: string; status: string; cell: string; createdAt: string; organization: string };

/** Panel mínimo de plataforma (R1). Solo operadores; cada consulta queda auditada en el servidor. */
export default function Platform() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ stores: Row[] }>('/v1/platform/stores').then((r) => setRows(r.stores)).catch((e) => setError(humanError(e))); }, []);
  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center gap-2 bg-ink px-4 text-ink-text">
        <Link href="/" className="flex items-center gap-2"><BrandMark size={24} /><span className="text-[15px] font-semibold tracking-tight">modular</span></Link>
        <Badge tone="warning">Plataforma</Badge>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-8">
        <PageHeader title="Tiendas" subtitle="Todas las tiendas de la plataforma." back={{ href: '/', label: 'Volver al panel' }} />
        <Notice kind="warning">Acceso de operador. Esta consulta queda registrada.</Notice>
        {error && <Notice kind="error">{error}</Notice>}
        {rows && (
          <Card flush>
            <div className="-mt-3 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-border bg-surface-2 text-xs text-muted"><tr><th className="px-5 py-2 font-medium">Tienda</th><th className="px-3 font-medium">Organización</th><th className="px-3 font-medium">Estado</th><th className="px-3 font-medium">Celda</th><th className="px-5 font-medium">Creada</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => <tr key={r.id} className="hover:bg-surface-2"><td className="px-5 py-2.5 font-medium">{r.name}<span className="block text-xs font-normal text-muted">{r.slug}</span></td><td className="px-3">{r.organization}</td><td className="px-3"><Badge tone={r.status === 'active' ? 'success' : 'neutral'} dot>{r.status}</Badge></td><td className="px-3 font-mono text-xs">{r.cell}</td><td className="px-5">{new Date(r.createdAt).toLocaleDateString('es')}</td></tr>)}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
