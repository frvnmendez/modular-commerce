import type { Capability } from './onboarding.ts';
import { can, type Permission, type StoreRole } from './rbac.ts';

export type NavItem = { id: string; label: string; path: string; permission: Permission; requires?: Capability[] };

const NAV: NavItem[] = [
  { id: 'home', label: 'Inicio', path: '', permission: 'store:read' },
  { id: 'products', label: 'Productos', path: '/products', permission: 'catalog:read' },
  { id: 'inventory', label: 'Inventario', path: '/inventory', permission: 'catalog:read', requires: ['inventory'] },
  { id: 'suppliers', label: 'Proveedores', path: '/suppliers', permission: 'catalog:read', requires: ['dropshipping'] },
  { id: 'orders', label: 'Pedidos', path: '/orders', permission: 'orders:read' },
  { id: 'shipping', label: 'Envíos', path: '/shipping', permission: 'orders:read', requires: ['shipping'] },
  { id: 'returns', label: 'Devoluciones', path: '/returns', permission: 'orders:read', requires: ['returns'] },
  { id: 'customers', label: 'Clientes', path: '/customers', permission: 'customers:read' },
  { id: 'team', label: 'Equipo', path: '/team', permission: 'members:read' },
  { id: 'audit', label: 'Actividad', path: '/audit', permission: 'audit:read' },
  { id: 'settings', label: 'Ajustes', path: '/settings', permission: 'settings:write' },
];

/** Navegación = capacidades activas de la tienda ∩ permisos del rol. Los módulos añadirán entradas en R3. */
export function navigationFor(role: StoreRole, caps: readonly string[]): NavItem[] {
  return NAV.filter((n) => can(role, n.permission) && (n.requires ?? []).every((c) => caps.includes(c)));
}
