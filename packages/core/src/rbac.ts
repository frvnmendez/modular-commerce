/** Permisos de staff de tienda. La BD vuelve a comprobar las operaciones privilegiadas (defensa en profundidad). */
export const PERMISSIONS = [
  'store:read', 'settings:write',
  'members:read', 'members:invite', 'members:manage',
  'audit:read',
  'catalog:read', 'catalog:write', 'orders:read', 'orders:write', 'customers:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type StoreRole = 'owner' | 'admin' | 'staff';

const ROLE_PERMISSIONS: Record<StoreRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== 'members:manage'),
  staff: ['store:read', 'catalog:read', 'catalog:write', 'orders:read', 'orders:write', 'customers:read'],
};

export const can = (role: StoreRole, p: Permission) => ROLE_PERMISSIONS[role].includes(p);
export const permissionsOf = (role: StoreRole) => [...ROLE_PERMISSIONS[role]];
