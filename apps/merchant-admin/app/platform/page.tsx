'use client';
import { useEffect, useState } from 'react';
import { api, humanError } from '@/lib/api';
import { Card, Notice } from '@/components/ui';

type Row = { id: string; name: string; slug: string; status: string; cell: string; createdAt: string; organization: string };

/** Panel mínimo de plataforma (R1). Solo operadores; cada consulta queda auditada en el servidor. */
export default function Platform() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ stores: Row[] }>('/v1/platform/stores').then((r) => setRows(r.stores)).catch((e) => setError(humanError(e))); }, []);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Plataforma · Tiendas</h1>
      <Notice>Acceso de operador. Esta consulta queda registrada.</Notice>
      {error && <Notice kind="error">{error}</Notice>}
      {rows && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted"><tr><th className="py-2 pr-4">Tienda</th><th className="pr-4">Organización</th><th className="pr-4">Estado</th><th className="pr-4">Celda</th><th>Creada</th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => <tr key={r.id}><td className="py-2 pr-4">{r.name}<span className="block text-xs text-muted">{r.slug}</span></td><td className="pr-4">{r.organization}</td><td className="pr-4">{r.status}</td><td className="pr-4">{r.cell}</td><td>{new Date(r.createdAt).toLocaleDateString('es')}</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}
