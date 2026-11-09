import { z } from 'zod';

/** Respuestas del onboarding. Generan un perfil de capacidades; el comerciante puede cambiarlo después. */
export const BusinessProfileSchema = z.object({
  businessType: z.enum(['fashion', 'food', 'electronics', 'beauty', 'home', 'digital', 'services', 'other']),
  productKinds: z.enum(['physical', 'digital', 'both']),
  fulfillment: z.enum(['own-inventory', 'dropshipping', 'both']),
  markets: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(30),
  shippingNeeds: z.enum(['none', 'domestic', 'international']),
  technicalLevel: z.enum(['beginner', 'intermediate', 'advanced']),
  goals: z.array(z.enum(['first-sales', 'grow-revenue', 'migrate-store', 'brand-building'])).max(4).default([]),
}).strict();
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const CAPABILITIES = ['physical-products', 'digital-products', 'inventory', 'variants', 'shipping', 'international',
  'dropshipping', 'returns'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export function capabilitiesFor(p: BusinessProfile): Capability[] {
  const caps = new Set<Capability>();
  if (p.productKinds !== 'digital') caps.add('physical-products');
  if (p.productKinds !== 'physical') caps.add('digital-products');
  if (caps.has('physical-products')) {
    if (p.fulfillment !== 'dropshipping') caps.add('inventory');
    if (p.fulfillment !== 'own-inventory') caps.add('dropshipping');
    if (p.shippingNeeds !== 'none') caps.add('shipping');
    caps.add('returns');
  }
  if (p.shippingNeeds === 'international' || p.markets.length > 1) caps.add('international');
  if (['fashion', 'electronics', 'beauty', 'home'].includes(p.businessType)) caps.add('variants');
  return CAPABILITIES.filter((c) => caps.has(c));
}

/** Módulos oficiales recomendados (catálogo real llega en R3/R4). */
export function recommendedModules(caps: Capability[]): string[] {
  const m = ['com.plataforma.payments-stripe'];
  if (caps.includes('shipping')) m.push('com.plataforma.shipping-adapter');
  if (caps.includes('dropshipping')) m.push('com.plataforma.dropshipping-connector');
  return m;
}
