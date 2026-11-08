'use client';
import { createContext, useContext } from 'react';

export type Store = {
  id: string; name: string; slug: string; country: string; currency: string; role: 'owner' | 'admin' | 'staff';
  permissions: string[]; capabilities: string[]; businessProfile: Record<string, unknown>;
};
export type NavItem = { id: string; label: string; path: string };

export const StoreContext = createContext<{ store: Store; reload: () => void } | null>(null);
export function useStore() {
  const v = useContext(StoreContext);
  if (!v) throw new Error('useStore fuera de StoreContext');
  return v;
}
