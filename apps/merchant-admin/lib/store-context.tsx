'use client';
import { createContext, useContext } from 'react';
import type { Me } from './api';

export type Store = {
  id: string; name: string; slug: string; country: string; currency: string; role: 'owner' | 'admin' | 'staff';
  permissions: string[]; capabilities: string[]; businessProfile: Record<string, unknown>;
  /** Dirección pública de la tienda (subdominio o /tienda/<slug>). */
  storeUrl: string;
};
export type NavItem = { id: string; label: string; path: string };

export const ROLE_LABEL = { owner: 'Propietario', admin: 'Administrador', staff: 'Personal' } as const;

export const StoreContext = createContext<{ store: Store; me: Me; reload: () => void } | null>(null);
export function useStore() {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore fuera de StoreContext');
  return v;
}
