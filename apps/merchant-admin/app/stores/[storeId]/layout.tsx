'use client';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError, humanError, type Me } from '@/lib/api';
import { ROLE_LABEL, StoreContext, type NavItem, type Store } from '@/lib/store-context';
import { Avatar, ButtonLink, Card, EmptyState, PageSkeleton } from '@/components/ui';
import {
  BrandMark, IconBox, IconCheck, IconChevronDown, IconClose, IconFactory, IconGear, IconHome, IconInbox, IconLogout, IconMenu,
  IconPulse, IconReturn, IconSearch, IconShield, IconStore, IconTag, IconTruck, IconUser, IconUsers,
} from '@/components/icons';
import { clearPendingInvite } from '@/lib/pending-invite';

const NAV_ICON: Record<string, (p: { size?: number }) => React.ReactElement> = {
  home: IconHome, products: IconTag, inventory: IconBox, suppliers: IconFactory, orders: IconInbox, shipping: IconTruck,
  returns: IconReturn, customers: IconUser, team: IconUsers, audit: IconPulse, settings: IconGear,
};
const ADMIN_GROUP = new Set(['team', 'audit']);

async function signOut(router: ReturnType<typeof useRouter>) {
  await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  clearPendingInvite();
  router.replace('/login');
}

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
  useEffect(() => setOpen(false), [pathname]);

  if (error) {
    return (
      <div className="min-h-dvh"><TopBarShell />
        <main className="mx-auto max-w-xl px-4 py-16">
          <Card><EmptyState illustration={<span className="grid size-14 place-items-center rounded-2xl bg-surface-3 text-muted"><IconStore size={28} /></span>}
            title="No podemos abrir esta tienda" body={error} action={<ButtonLink href="/">Volver a mis tiendas</ButtonLink>} /></Card>
        </main>
      </div>
    );
  }
  if (!store || !me) {
    return <div className="min-h-dvh"><TopBarShell /><main className="mx-auto max-w-5xl px-4 py-8 lg:pl-[264px]"><PageSkeleton label="Cargando tienda…" /></main></div>;
  }

  const base = `/stores/${storeId}`;
  const isActive = (item: NavItem) => (item.path === '' ? pathname === base : pathname.startsWith(base + item.path));
  const sidebar = (
    <nav aria-label="Secciones de la tienda" className="flex h-full flex-col gap-0.5 p-3">
      {nav.filter((i) => !ADMIN_GROUP.has(i.id) && i.id !== 'settings').map((item) => <NavLink key={item.id} item={item} href={base + item.path} active={isActive(item)} />)}
      {nav.some((i) => ADMIN_GROUP.has(i.id)) && <p className="mt-5 mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">Administración</p>}
      {nav.filter((i) => ADMIN_GROUP.has(i.id)).map((item) => <NavLink key={item.id} item={item} href={base + item.path} active={isActive(item)} />)}
      <div className="mt-auto pt-4">
        {nav.filter((i) => i.id === 'settings').map((item) => <NavLink key={item.id} item={item} href={base + item.path} active={isActive(item)} />)}
        {me.platformOperator && (
          <Link href="/platform" className="mt-0.5 flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-1.5 text-[13px] text-muted hover:bg-surface-3 hover:text-text">
            <IconShield size={18} />Panel de plataforma
          </Link>
        )}
      </div>
    </nav>
  );

  return (
    <StoreContext.Provider value={{ store, me, reload: load }}>
      <div className="min-h-dvh">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-ink px-2 text-ink-text sm:px-3">
          <button type="button" className="grid size-9 place-items-center rounded-[var(--radius)] text-ink-text hover:bg-ink-2 lg:hidden" aria-label="Menú" aria-expanded={open} onClick={() => setOpen(true)}>
            <IconMenu size={20} />
          </button>
          <Brand href={base} />
          <div className="flex flex-1 justify-center px-2"><QuickSearch nav={nav} base={base} /></div>
          <StoreMenu me={me} store={store} onSwitch={(id) => router.push(`/stores/${id}`)} onSignOut={() => signOut(router)} />
        </header>
        <aside className="fixed top-14 bottom-0 left-0 z-20 hidden w-[240px] overflow-y-auto border-r border-border bg-surface-2 lg:block">{sidebar}</aside>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú de la tienda">
            <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <div className="mc-drawer absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-surface-2 shadow-pop">
              <div className="flex h-14 items-center justify-between border-b border-border px-3">
                <span className="truncate font-semibold">{store.name}</span>
                <button type="button" aria-label="Cerrar menú" className="grid size-9 place-items-center rounded-[var(--radius)] hover:bg-surface-3" onClick={() => setOpen(false)}><IconClose size={20} /></button>
              </div>
              <div className="flex-1 overflow-y-auto">{sidebar}</div>
            </div>
          </div>
        )}
        <div className="min-w-0 lg:pl-[240px]">
          <main className="mx-auto max-w-[1040px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        </div>
      </div>
    </StoreContext.Provider>
  );
}

function Brand({ href }: { href: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2 rounded-[var(--radius)] px-1.5 py-1 text-ink-text hover:bg-ink-2">
      <BrandMark size={24} />
      <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">modular</span>
    </Link>
  );
}

function TopBarShell() {
  return <header className="sticky top-0 z-30 flex h-14 items-center bg-ink px-3 text-ink-text"><Brand href="/" /></header>;
}

function NavLink({ item, href, active }: { item: NavItem; href: string; active: boolean }) {
  const Icon = NAV_ICON[item.id] ?? IconBox;
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={`group flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-1.5 text-[13px] font-medium transition-colors ${active ? 'bg-surface text-text shadow-card ring-1 ring-border/70' : 'text-muted hover:bg-surface-3 hover:text-text'}`}>
      <span className={active ? 'text-accent' : 'text-subtle group-hover:text-text'}><Icon size={18} /></span>
      {item.label}
    </Link>
  );
}

/** Búsqueda rápida entre secciones (Ctrl/⌘+K). Solo navega: no inventa resultados. */
function QuickSearch({ nav, base }: { nav: NavItem[]; base: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const results = useMemo(() => nav.filter((i) => norm(i.label).includes(norm(q.trim()))), [nav, q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const go = (i: NavItem) => { router.push(base + i.path); setQ(''); ref.current?.blur(); };
  const show = focus && results.length > 0;
  return (
    <div className="relative hidden w-full max-w-[480px] md:block">
      <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted" />
      <input ref={ref} value={q} role="combobox" aria-expanded={show} aria-controls="mc-search-list" aria-label="Buscar sección"
        placeholder="Buscar sección" onFocus={() => { setFocus(true); setSel(0); }} onBlur={() => setTimeout(() => setFocus(false), 120)}
        onChange={(e) => { setQ(e.target.value); setSel(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === 'Enter' && results[sel]) go(results[sel]);
          if (e.key === 'Escape') ref.current?.blur();
        }}
        className="h-9 w-full rounded-[var(--radius)] border border-white/10 bg-ink-2 pr-14 pl-9 text-[13px] text-ink-text placeholder:text-ink-muted outline-none focus:border-white/30 focus:bg-[#2c2c39]" />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-white/15 px-1.5 text-[11px] text-ink-muted">Ctrl K</kbd>
      {show && (
        <ul id="mc-search-list" role="listbox" className="mc-pop absolute inset-x-0 top-11 z-50 overflow-hidden rounded-card bg-surface p-1 text-text shadow-pop">
          {results.map((i, n) => {
            const Icon = NAV_ICON[i.id] ?? IconBox;
            return (
              <li key={i.id} role="option" aria-selected={n === sel}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(i)} onMouseEnter={() => setSel(n)}
                  className={`flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] ${n === sel ? 'bg-surface-3' : ''}`}>
                  <span className="text-muted"><Icon size={16} /></span>{i.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StoreMenu({ me, store, onSwitch, onSignOut }: { me: Me; store: Store; onSwitch: (id: string) => void; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`${store.name}: tienda y cuenta`} onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-[var(--radius)] py-1 pr-1.5 pl-1 hover:bg-ink-2">
        <span className="grid size-8 place-items-center rounded-[var(--radius)] bg-[#8b85f4] text-[13px] font-semibold text-[#14122e]">{store.name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden min-w-0 text-left leading-tight sm:block">
          <span className="block max-w-[180px] truncate text-[13px] font-medium">{store.name}</span>
          <span className="block max-w-[180px] truncate text-[11px] text-ink-muted">{me.user.name} · {ROLE_LABEL[store.role]}</span>
        </span>
        <IconChevronDown size={16} className="text-ink-muted" />
      </button>
      {open && (
        <div role="menu" className="mc-pop absolute top-12 right-0 z-50 w-72 overflow-hidden rounded-card bg-surface text-text shadow-pop">
          <div className="flex items-center gap-3 border-b border-border p-3">
            <Avatar name={me.user.name} size={36} />
            <div className="min-w-0"><p className="truncate text-[13px] font-semibold">{me.user.name}</p><p className="truncate text-xs text-muted">{me.user.email}</p></div>
          </div>
          <div className="p-1">
            <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Tiendas</p>
            {me.stores.map((s) => (
              <button key={s.id} type="button" role="menuitemradio" aria-checked={s.id === store.id} onClick={() => { setOpen(false); if (s.id !== store.id) onSwitch(s.id); }}
                className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] hover:bg-surface-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-3 text-[11px] font-semibold">{s.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.name}</span><span className="block truncate text-xs text-muted">{s.slug}.plataforma.com</span></span>
                {s.id === store.id && <IconCheck size={16} className="text-accent" />}
              </button>
            ))}
          </div>
          <div className="border-t border-border p-1">
            <button type="button" role="menuitem" onClick={onSignOut} className="flex w-full items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-left text-[13px] hover:bg-surface-3">
              <IconLogout size={16} className="text-muted" />Salir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
