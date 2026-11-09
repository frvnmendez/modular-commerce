import { describe, expect, it } from 'vitest';
import { can, capabilitiesFor, navigationFor, recommendedModules, BusinessProfileSchema } from '../src/index.ts';

const base = { businessType: 'fashion', productKinds: 'physical', fulfillment: 'own-inventory', markets: ['ES'], shippingNeeds: 'domestic', technicalLevel: 'beginner', goals: [] } as const;

describe('RBAC', () => {
  it('staff no gestiona equipo ni ajustes; admin no gestiona roles; owner todo', () => {
    expect(can('staff', 'members:invite')).toBe(false);
    expect(can('staff', 'settings:write')).toBe(false);
    expect(can('admin', 'members:invite')).toBe(true);
    expect(can('admin', 'members:manage')).toBe(false);
    expect(can('owner', 'members:manage')).toBe(true);
  });
});

describe('Perfil de capacidades y navegación', () => {
  it('tienda de moda con inventario propio: variantes, inventario, envíos y devoluciones; sin proveedores', () => {
    const caps = capabilitiesFor(BusinessProfileSchema.parse(base));
    expect(caps).toEqual(['physical-products', 'inventory', 'variants', 'shipping', 'returns']);
    const nav = navigationFor('owner', caps).map((n) => n.id);
    expect(nav).toContain('inventory');
    expect(nav).not.toContain('suppliers');
  });
  it('tienda digital no ve almacenes, envíos ni devoluciones', () => {
    const caps = capabilitiesFor(BusinessProfileSchema.parse({ ...base, businessType: 'digital', productKinds: 'digital', shippingNeeds: 'none' }));
    expect(caps).toEqual(['digital-products']);
    const nav = navigationFor('owner', caps).map((n) => n.id);
    expect(nav).not.toContain('inventory');
    expect(nav).not.toContain('shipping');
    expect(recommendedModules(caps)).toEqual(['com.plataforma.payments-stripe']);
  });
  it('dropshipper gestiona proveedores y recibe el conector recomendado', () => {
    const caps = capabilitiesFor(BusinessProfileSchema.parse({ ...base, fulfillment: 'dropshipping', markets: ['ES', 'FR'] }));
    expect(caps).toContain('dropshipping');
    expect(caps).not.toContain('inventory');
    expect(caps).toContain('international');
    expect(navigationFor('owner', caps).map((n) => n.id)).toContain('suppliers');
    expect(recommendedModules(caps)).toContain('com.plataforma.dropshipping-connector');
  });
  it('staff no ve equipo, actividad ni ajustes en la navegación', () => {
    const nav = navigationFor('staff', ['inventory']).map((n) => n.id);
    expect(nav).not.toContain('team');
    expect(nav).not.toContain('settings');
    expect(nav).not.toContain('audit');
  });
  it('el perfil rechaza campos desconocidos y mercados inválidos', () => {
    expect(BusinessProfileSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(BusinessProfileSchema.safeParse({ ...base, markets: ['españa'] }).success).toBe(false);
  });
});
