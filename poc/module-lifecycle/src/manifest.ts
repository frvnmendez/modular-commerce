import { z } from 'zod';
import semver from 'semver';
import { isIP } from 'node:net';

/** Permisos de alcance limitado que un módulo puede solicitar. Lista cerrada y versionada. */
export const PERMISSIONS = [
  'catalog:read', 'catalog:write',
  'inventory:read', 'inventory:write',
  'orders:read', 'orders:write',
  'customers:read', 'customers:pii',
  'payments:process', 'shipping:rates', 'fulfillment:write',
  'storefront:blocks', 'admin:navigation',
] as const;

export const EVENTS = [
  'order.created', 'order.paid', 'order.cancelled', 'order.fulfilled',
  'product.created', 'product.updated', 'inventory.changed',
  'payment.succeeded', 'payment.failed', 'refund.created',
  'shipment.created', 'shipment.updated', 'supplier.stock_synced',
] as const;

const semverStr = z.string().refine((v) => semver.valid(v) !== null, 'versión semver inválida');
const semverRange = z.string().refine((v) => semver.validRange(v) !== null, 'rango semver inválido');
const moduleId = z.string().regex(/^[a-z][a-z0-9-]{2,62}(\.[a-z][a-z0-9-]{1,62})+$/, 'id en formato dominio inverso: ej. com.acme.envios');

const configField = z.discriminatedUnion('type', [
  z.object({ type: z.literal('string'), label: z.string(), required: z.boolean().default(false), default: z.string().optional() }),
  z.object({ type: z.literal('number'), label: z.string(), required: z.boolean().default(false), min: z.number().optional(), max: z.number().optional(), default: z.number().optional() }),
  z.object({ type: z.literal('boolean'), label: z.string(), default: z.boolean().default(false) }),
  z.object({ type: z.literal('enum'), label: z.string(), options: z.array(z.string()).min(1), required: z.boolean().default(false), default: z.string().optional() }),
]);

export const ManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    id: moduleId,
    name: z.string().min(2).max(80),
    version: semverStr,
    author: z.object({ name: z.string(), email: z.email().optional(), url: z.url().optional() }),
    description: z.string().max(500),
    license: z.string().min(2),
    compatibility: z.object({ platform: semverRange, sdk: semverRange }),
    dependencies: z.record(moduleId, semverRange).default({}),
    permissions: z.array(z.enum(PERMISSIONS)).default([]),
    capabilities: z.array(z.enum(['payment-provider', 'shipping-carrier', 'product-source', 'storefront-block', 'analytics', 'marketing'])).min(1),
    config: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), configField).default({}),
    secrets: z.array(z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]*$/), description: z.string(), required: z.boolean().default(true) })).default([]),
    events: z.object({ consumes: z.array(z.enum(EVENTS)).default([]), emits: z.array(z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z_]+)+$/)).default([]) }).default({ consumes: [], emits: [] }),
    endpoints: z.object({
      // Los módulos se ejecutan fuera de proceso: la plataforma llama a sus webhooks firmados.
      baseUrl: z.url().refine(isSafePublicUrl, 'solo HTTPS hacia un host público (sin IP literal ni localhost)'),
      timeoutMs: z.number().int().min(100).max(10000).default(5000),
    }),
    migrations: z.array(z.object({ id: z.string(), description: z.string(), reversible: z.boolean() })).default([]),
    limits: z.object({ requestsPerMinute: z.number().int().positive().max(6000).default(600), storageMb: z.number().int().nonnegative().max(1024).default(0) }).default({ requestsPerMinute: 600, storageMb: 0 }),
    updatePolicy: z.enum(['auto-patch', 'auto-minor', 'manual']).default('auto-patch'),
    uninstallPolicy: z.object({
      blockIf: z.array(z.enum(['pending-orders', 'pending-payouts', 'open-shipments'])).default([]),
      dataRetentionDays: z.number().int().min(0).max(365).default(30),
    }).default({ blockIf: [], dataRetentionDays: 30 }),
    healthCheck: z.object({ path: z.string().startsWith('/'), intervalSec: z.number().int().min(30).default(60) }),
  })
  .strict()
  .superRefine((m, ctx) => {
    // Coherencia entre capacidades y permisos.
    const need: Record<string, string> = { 'payment-provider': 'payments:process', 'shipping-carrier': 'shipping:rates', 'storefront-block': 'storefront:blocks' };
    for (const cap of m.capabilities) {
      const p = need[cap];
      if (p && !m.permissions.includes(p as never)) ctx.addIssue({ code: 'custom', message: `la capacidad ${cap} requiere el permiso ${p}`, path: ['permissions'] });
    }
    if (m.dependencies[m.id]) ctx.addIssue({ code: 'custom', message: 'un módulo no puede depender de sí mismo', path: ['dependencies'] });
    // Los eventos emitidos viven en el espacio de nombres del módulo: no puede suplantar eventos de plataforma.
    const ns = m.id.split('.').at(-1)!;
    for (const e of m.events.emits) {
      if (!e.startsWith(`${ns}.`)) ctx.addIssue({ code: 'custom', message: `el evento emitido ${e} debe empezar por "${ns}."`, path: ['events', 'emits'] });
    }
  });

export type Manifest = z.infer<typeof ManifestSchema>;
/** El nivel de confianza NUNCA lo declara el módulo: lo asigna el registro de la plataforma tras revisar y firmar. */
export type Tier = 'official' | 'third-party';

/** Validación estática. En ejecución (R3) se repite al resolver DNS y al conectar (anti DNS-rebinding). */
export function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host) !== 0) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  return host.includes('.');
}

export function validateManifest(input: unknown, tier: Tier = 'third-party') {
  const r = ManifestSchema.safeParse(input);
  if (!r.success) return { ok: false as const, errors: r.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`) };
  if (tier === 'third-party' && r.data.permissions.includes('customers:pii')) {
    return { ok: false as const, errors: ['permissions: customers:pii está reservado a módulos oficiales en el MVP'] };
  }
  return { ok: true as const, manifest: r.data };
}
