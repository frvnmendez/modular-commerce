import { beforeEach, describe, expect, it } from 'vitest';
import { validateManifest, type Manifest } from '../src/manifest';
import { ModuleManager, type Ports } from '../src/lifecycle';

const T = 'tienda-a';
const base = (over: Record<string, unknown> = {}) => ({
  manifestVersion: 1,
  id: 'com.plataforma.pagos-sandbox',
  name: 'Pagos (sandbox)',
  version: '1.0.0',
  author: { name: 'Plataforma' },
  description: 'Pasarela de pagos de prueba',
  license: 'Proprietary',
  compatibility: { platform: '^1.0.0', sdk: '^1.0.0' },
  permissions: ['payments:process', 'orders:read'],
  capabilities: ['payment-provider'],
  config: { mode: { type: 'enum', label: 'Modo', options: ['test'], required: true } },
  secrets: [{ name: 'API_KEY', description: 'Clave sandbox' }],
  events: { consumes: ['order.created'], emits: [] },
  endpoints: { baseUrl: 'https://pagos.modulos.example' },
  migrations: [{ id: '001_init', description: 'tablas', reversible: true }],
  uninstallPolicy: { blockIf: ['pending-orders'] },
  healthCheck: { path: '/health' },
  ...over,
});

let ports: Ports & { applied: string[]; failOn?: string; healthy: boolean; pending: boolean };
let mm: ModuleManager;
beforeEach(() => {
  ports = {
    platformVersion: '1.2.0', applied: [], healthy: true, pending: false,
    async runMigration(_t, m, id) { if (id === ports.failOn) throw new Error(`fallo en ${id}`); ports.applied.push(`${m}:${id}`); },
    async rollbackMigration(_t, m, id) { ports.applied = ports.applied.filter((x) => x !== `${m}:${id}`); },
    async healthCheck() { return ports.healthy; },
    async hasPending() { return ports.pending; },
  };
  mm = new ModuleManager(ports);
});

async function activeModule(over = {}) {
  await mm.install(T, base(over));
  mm.configure(T, (base(over) as { id: string }).id, { mode: 'test' }, { API_KEY: 'sk_test_x' });
  await mm.activate(T, (base(over) as { id: string }).id);
}

describe('Manifiesto', () => {
  it('acepta un manifiesto válido', () => expect(validateManifest(base()).ok).toBe(true));
  it('rechaza id, versión, URL no HTTPS y campos desconocidos', () => {
    const r = validateManifest(base({ id: 'Pagos', version: '1.0', endpoints: { baseUrl: 'http://evil.example' }, extra: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/id[\s\S]*version[\s\S]*baseUrl|extra/);
  });
  it('exige coherencia capacidad↔permiso', () => {
    const r = validateManifest(base({ permissions: ['orders:read'] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/payments:process/);
  });
  it('[RT-3] el tier no se puede autodeclarar: un manifiesto con tier se rechaza y PII exige tier oficial del registro', () => {
    expect(validateManifest(base({ tier: 'official' })).ok).toBe(false);
    const pii = base({ permissions: ['payments:process', 'customers:pii'] });
    expect(validateManifest(pii).ok).toBe(false);
    expect(validateManifest(pii, 'official').ok).toBe(true);
  });
  it('[RT-6] baseUrl: rechaza localhost disfrazado, IPs literales, metadatos cloud y credenciales en URL', () => {
    for (const u of ['http://localhost.evil.com', 'https://169.254.169.254', 'https://10.0.0.5/x', 'https://[::1]/', 'https://localhost', 'https://api.internal', 'https://user:pw@pagos.example.com', 'http://pagos.example.com']) {
      expect(validateManifest(base({ endpoints: { baseUrl: u } })).ok, u).toBe(false);
    }
  });
  it('[RT-6] un módulo solo emite eventos en su espacio de nombres', () => {
    expect(validateManifest(base({ events: { consumes: [], emits: ['order.paid'] } })).ok).toBe(false);
    expect(validateManifest(base({ events: { consumes: [], emits: ['pagos-sandbox.intent_created'] } })).ok).toBe(true);
  });
});

describe('Ciclo de vida feliz', () => {
  it('DISCOVER→VALIDATE→INSTALL→CONFIGURE→ACTIVATE→UPDATE→DISABLE→UNINSTALL con auditoría y sin secretos en logs', async () => {
    await activeModule();
    const id = 'com.plataforma.pagos-sandbox';
    expect(mm.get(T, id)!.state).toBe('active');
    await mm.update(T, base({ version: '1.1.0', migrations: [{ id: '001_init', description: 't', reversible: true }, { id: '002_idx', description: 'i', reversible: true }] }));
    expect(mm.get(T, id)!.version).toBe('1.1.0');
    expect(ports.applied).toEqual([`${id}:001_init`, `${id}:002_idx`]);
    mm.disable(T, id);
    await mm.uninstall(T, id);
    expect(mm.get(T, id)!.state).toBe('uninstalled');
    expect(mm.hasSecret(T, id, 'API_KEY')).toBe(false);
    expect(JSON.stringify(mm.audit)).not.toContain('sk_test_x');
    expect(mm.audit.map((a) => a.action)).toContain('credential-revoked');
  });
});

describe('Casos de compatibilidad y fallo', () => {
  it('actualización incompatible con la plataforma se rechaza', async () => {
    await activeModule();
    await expect(mm.update(T, base({ version: '1.2.0', compatibility: { platform: '^2.0.0', sdk: '^1.0.0' } }))).rejects.toThrow('INCOMPATIBLE_PLATFORM');
  });
  it('salto de versión mayor o nuevos permisos exigen aprobación explícita', async () => {
    await activeModule();
    await expect(mm.update(T, base({ version: '2.0.0' }))).rejects.toThrow('MAJOR_REQUIRES_APPROVAL');
    await expect(mm.update(T, base({ version: '1.1.0', permissions: ['payments:process', 'orders:read', 'customers:read'] }))).rejects.toThrow('NEW_PERMISSIONS_REQUIRE_APPROVAL');
    // [RT-5f] aprobar un salto mayor no aprueba permisos nuevos
    await expect(mm.update(T, base({ version: '2.0.0', permissions: ['payments:process', 'orders:read', 'customers:read'] }), { approveMajor: true })).rejects.toThrow('NEW_PERMISSIONS_REQUIRE_APPROVAL');
  });
  it('dependencia ausente', async () => {
    await expect(mm.install(T, base({ id: 'com.plataforma.antifraude', dependencies: { 'com.plataforma.pagos-sandbox': '^1.0.0' } }))).rejects.toThrow('MISSING_DEPENDENCY');
  });
  it('dependencia circular detectada al resolver el orden de instalación', () => {
    const cat = new Map<string, Manifest>();
    for (const [id, dep] of [['com.xx.aa', 'com.xx.bb'], ['com.xx.bb', 'com.xx.cc'], ['com.xx.cc', 'com.xx.aa']]) {
      const r = validateManifest(base({ id, dependencies: { [dep]: '^1.0.0' } }));
      expect(r.ok).toBe(true);
      if (r.ok) cat.set(id, r.manifest);
    }
    expect(() => ModuleManager.resolveOrder('com.xx.aa', cat)).toThrow(/CIRCULAR_DEPENDENCY: com.xx.aa → com.xx.bb → com.xx.cc → com.xx.aa/);
  });
  it('instalación duplicada', async () => {
    await mm.install(T, base());
    await expect(mm.install(T, base())).rejects.toThrow('ALREADY_INSTALLED');
  });
  it('la misma instalación en otro tenant es independiente', async () => {
    await activeModule();
    await expect(mm.install('tienda-b', base())).resolves.toBeTruthy();
    expect(mm.get('tienda-b', 'com.plataforma.pagos-sandbox')!.state).toBe('installed');
  });
  it('configuración incompleta o con claves no declaradas', async () => {
    await mm.install(T, base());
    expect(() => mm.configure(T, 'com.plataforma.pagos-sandbox', {}, {})).toThrow(/mode es obligatorio.*API_KEY es obligatorio/);
    expect(() => mm.configure(T, 'com.plataforma.pagos-sandbox', { mode: 'live' }, { API_KEY: 'k', OTRO: 'x' })).toThrow(/mode debe ser uno de test.*OTRO no declarado/);
  });
  it('módulo defectuoso (health check falla) no se activa', async () => {
    await mm.install(T, base());
    mm.configure(T, 'com.plataforma.pagos-sandbox', { mode: 'test' }, { API_KEY: 'k' });
    ports.healthy = false;
    await expect(mm.activate(T, 'com.plataforma.pagos-sandbox')).rejects.toThrow('UNHEALTHY');
  });
  it('módulo deshabilitado pierde acceso a la API (credencial revocada) y no accede a otro tenant', async () => {
    await activeModule();
    const cred = mm.get(T, 'com.plataforma.pagos-sandbox')!.credentialId!;
    expect(mm.authorize(cred, T, 'orders:read')).toBe(true);
    expect(mm.authorize(cred, 'tienda-b', 'orders:read')).toBe(false);
    expect(mm.authorize(cred, T, 'customers:pii')).toBe(false);
    mm.disable(T, 'com.plataforma.pagos-sandbox');
    expect(mm.authorize(cred, T, 'orders:read')).toBe(false);
  });
  it('no se puede deshabilitar un módulo del que dependen otros activos', async () => {
    await activeModule();
    await activeModule({ id: 'com.plataforma.antifraude', dependencies: { 'com.plataforma.pagos-sandbox': '^1.0.0' } });
    expect(() => mm.disable(T, 'com.plataforma.pagos-sandbox')).toThrow('HAS_DEPENDENTS');
  });
  it('desinstalación bloqueada con pedidos pendientes', async () => {
    await activeModule();
    mm.disable(T, 'com.plataforma.pagos-sandbox');
    ports.pending = true;
    await expect(mm.uninstall(T, 'com.plataforma.pagos-sandbox')).rejects.toThrow('UNINSTALL_BLOCKED: pending-orders');
  });
  it('fallo durante la migración de instalación: compensa, queda failed, reintento limitado', async () => {
    ports.failOn = '002_b';
    const m = base({ migrations: [{ id: '001_a', description: 'a', reversible: true }, { id: '002_b', description: 'b', reversible: true }] });
    await expect(mm.install(T, m)).rejects.toThrow('MIGRATION_FAILED');
    expect(ports.applied).toEqual([]);
    expect(mm.get(T, 'com.plataforma.pagos-sandbox')!.state).toBe('failed');
    await expect(mm.retry(T, 'com.plataforma.pagos-sandbox')).rejects.toThrow('MIGRATION_FAILED');
    await expect(mm.retry(T, 'com.plataforma.pagos-sandbox')).rejects.toThrow('MIGRATION_FAILED');
    await expect(mm.retry(T, 'com.plataforma.pagos-sandbox')).rejects.toThrow('RETRY_LIMIT');
    ports.failOn = undefined;
  });
  it('fallo durante la migración de una actualización: rollback a la versión anterior, sigue activo', async () => {
    await activeModule();
    ports.failOn = '002_idx';
    await expect(mm.update(T, base({ version: '1.1.0', migrations: [{ id: '001_init', description: 't', reversible: true }, { id: '002_idx', description: 'i', reversible: true }] }))).rejects.toThrow('MIGRATION_FAILED');
    const i = mm.get(T, 'com.plataforma.pagos-sandbox')!;
    expect([i.state, i.version]).toEqual(['active', '1.0.0']);
  });
  it('reinicio durante la instalación: recuperación a failed y reintento con éxito', async () => {
    await mm.install(T, base());
    mm._forceState(T, 'com.plataforma.pagos-sandbox', 'installing');
    mm.recoverAfterCrash();
    expect(mm.get(T, 'com.plataforma.pagos-sandbox')!.state).toBe('failed');
    await mm.retry(T, 'com.plataforma.pagos-sandbox');
    expect(mm.get(T, 'com.plataforma.pagos-sandbox')!.state).toBe('installed');
  });
  it('transiciones ilegales se rechazan (activar sin configurar)', async () => {
    await mm.install(T, base());
    await expect(mm.activate(T, 'com.plataforma.pagos-sandbox')).rejects.toThrow('INVALID_TRANSITION');
  });

  it('[RT-2] activar dos veces no deja credenciales huérfanas vivas', async () => {
    await activeModule();
    const first = mm.get(T, 'com.plataforma.pagos-sandbox')!.credentialId!;
    await expect(mm.activate(T, 'com.plataforma.pagos-sandbox')).rejects.toThrow('INVALID_TRANSITION');
    expect(mm.get(T, 'com.plataforma.pagos-sandbox')!.credentialId).toBe(first);
    mm.disable(T, 'com.plataforma.pagos-sandbox');
    expect(mm.authorize(first, T, 'orders:read')).toBe(false);
    mm.configure(T, 'com.plataforma.pagos-sandbox', { mode: 'test' }, {});
    await mm.activate(T, 'com.plataforma.pagos-sandbox');
    const second = mm.get(T, 'com.plataforma.pagos-sandbox')!.credentialId!;
    expect(second).not.toBe(first);
    expect(mm.authorize(first, T, 'orders:read')).toBe(false);
  });
  it('[RT-4] una instalación fallida no se puede activar', async () => {
    ports.failOn = '001_init';
    await expect(mm.install(T, base())).rejects.toThrow('MIGRATION_FAILED');
    await expect(mm.activate(T, 'com.plataforma.pagos-sandbox')).rejects.toThrow('INVALID_TRANSITION');
    ports.failOn = undefined;
  });
  it('[RT-5a] el límite de reintentos también aplica llamando a install() directamente', async () => {
    ports.failOn = '001_init';
    for (let n = 0; n < 3; n++) await expect(mm.install(T, base())).rejects.toThrow('MIGRATION_FAILED');
    await expect(mm.install(T, base())).rejects.toThrow('RETRY_LIMIT');
    ports.failOn = undefined;
  });
  it('[RT-5b] configurar un módulo activo falla SIN alterar config ni secretos', async () => {
    await activeModule();
    expect(() => mm.configure(T, 'com.plataforma.pagos-sandbox', { mode: 'test' }, { API_KEY: 'sk_nueva' })).toThrow('INVALID_TRANSITION');
    expect(JSON.stringify(mm.audit)).not.toContain('sk_nueva');
    expect(mm.get(T, 'com.plataforma.pagos-sandbox')!.state).toBe('active');
  });
  it('[RT-5c] una actualización que rompe el rango de un dependiente activo se rechaza', async () => {
    await activeModule();
    await activeModule({ id: 'com.plataforma.antifraude', dependencies: { 'com.plataforma.pagos-sandbox': '^1.0.0' } });
    await expect(mm.update(T, base({ version: '2.0.0' }), { approveMajor: true })).rejects.toThrow('BREAKS_DEPENDENTS');
  });
  it('[RT-5d] no se puede reactivar un módulo con su dependencia deshabilitada', async () => {
    await activeModule();
    await activeModule({ id: 'com.plataforma.antifraude', dependencies: { 'com.plataforma.pagos-sandbox': '^1.0.0' } });
    mm.disable(T, 'com.plataforma.antifraude');
    mm.disable(T, 'com.plataforma.pagos-sandbox');
    await expect(mm.activate(T, 'com.plataforma.antifraude')).rejects.toThrow('MISSING_DEPENDENCY');
  });
  it('[RT-5e] rollback incompleto o migración irreversible → failed con intervención manual, no "active" falso', async () => {
    await activeModule();
    ports.failOn = '003_b';
    const next = base({ version: '1.1.0', migrations: [
      { id: '001_init', description: 't', reversible: true },
      { id: '002_a', description: 'irreversible', reversible: false },
      { id: '003_b', description: 'falla', reversible: true },
    ] });
    await expect(mm.update(T, next)).rejects.toThrow('ROLLBACK_INCOMPLETE');
    const i = mm.get(T, 'com.plataforma.pagos-sandbox')!;
    expect(i.state).toBe('failed');
    expect(i.failure).toMatch(/REQUIERE INTERVENCIÓN: 002_a irreversible/);
    ports.failOn = undefined;
  });
});
