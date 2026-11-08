'use client';
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError, humanError, type Me } from '@/lib/api';
import { StoreContext, type NavItem, type Store } from '@/lib/store-context';
import { EmptyState } from '@/components/ui';

const ROLE_LABEL = { owner: 'Propietario', admin: 'Administrador', staff: 'Personal' } as const;

export default function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ storeId: string }> }) {
  const { storeId } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const [store, setStore] = useState<Store | null>(null);
  const [nav, setNav] = useState<NavItem[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    Promise.all([api<Store>(`/v1/stores/${storeId}`), api<{ items: NavItem[] }>(`/v1/stores/${storeId}/navigation`), api<Me>('/v1/me')])
      .then(([s, n, m]) => { setStore(s); setNav(n.items); setMe(m); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) return router.replace('/login');
        setError(humanError(e));
      });
  }, [storeId, router]);
  useEffect(load, [load]);

  if (error) return <main className="p-6"><EmptyState title="No podemos abrir esta tienda" body={error} action={<Link className="text-sm underline" href="/">Volver</Link>} /></main>;
  if (!store || !me) return <p className="p-8 text-sm text-muted" role="status">Cargando tienda…</p>;

  const base = `/stores/${storeId}`;
  const sidebar = (
    <nav aria-label="Secciones de la tienda" className="flex flex-col gap-0.5">
      {nav.map((item) => {
        const href = base + item.path;
        const active = item.path === '' ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={item.id} href={href} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}
            className={`rounded-[var(--radius)] px-3 py-2 text-sm ${active ? 'bg-accent-soft text-accent font-medium' : 'text-muted hover:bg-surface-2 hover:text-text'}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <StoreContext.Provider value={{ store, reload: load }}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
        <aside className={`${open ? 'block' : 'hidden'} border-b border-border bg-surface p-4 lg:block lg:min-h-dvh lg:border-b-0 lg:border-r`}>
          <div className="mb-4 hidden lg:block">
            <StoreSwitcher me={me} current={store} onChange={(id) => router.push(`/stores/${id}`)} />
          </div>
          {sidebar}
          {me.platformOperator && <Link href="/platform" className="mt-6 block px-3 text-xs text-muted underline-offset-4 hover:underline">Panel de plataforma</Link>}
        </aside>
        <div className="min-w-0">
          <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <button className="lg:hidden rounded-[var(--radius)] border border-border px-3 h-9 text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>Menú</button>
              <div className="min-w-0 lg:hidden"><StoreSwitcher me={me} current={store} onChange={(id) => router.push(`/stores/${id}`)} /></div>
              <span className="hidden lg:inline text-sm text-muted">{store.slug}.plataforma.com</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden sm:inline text-muted">{me.user.name} · {ROLE_LABEL[store.role]}</span>
              <button className="text-muted hover:text-text" onClick={async () => {
                await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
                router.replace('/login');
              }}>Salir</button>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        </div>
      </div>
    </StoreContext.Provider>
  );
}

function StoreSwitcher({ me, current, onChange }: { me: Me; current: Store; onChange: (id: string) => void }) {
  if (me.stores.length <= 1) return <span className="block truncate font-semibold">{current.name}</span>;
  return (
    <select aria-label="Cambiar de tienda" value={current.id} onChange={(e) => onChange(e.target.value)}
      className="w-full truncate rounded-[var(--radius)] border border-border bg-surface px-2 h-9 text-sm font-semibold">
      {me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}
