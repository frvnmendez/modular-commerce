import semver from 'semver';
import { randomBytes } from 'node:crypto';
import { type Manifest, type Tier, validateManifest } from './manifest';

export type State =
  | 'installing' | 'installed' | 'configured' | 'active' | 'updating'
  | 'disabled' | 'uninstalling' | 'uninstalled' | 'failed';

/** Transiciones permitidas. Cualquier otra se rechaza: la máquina de estados es la fuente de verdad. */
const TRANSITIONS: Record<State, State[]> = {
  installing: ['installed', 'failed'],
  installed: ['configured', 'uninstalling'],
  configured: ['configured', 'active', 'uninstalling'],
  active: ['updating', 'disabled'],
  updating: ['active', 'failed'],
  disabled: ['active', 'configured', 'uninstalling'],
  uninstalling: ['uninstalled', 'failed'],
  uninstalled: ['installing'],
  failed: ['installing', 'uninstalling'], // nunca directo a active: hay que reinstalar o desinstalar
};

export interface Installation {
  tenantId: string;
  moduleId: string;
  version: string;
  tier: Tier;
  manifest: Manifest;
  state: State;
  previousVersion?: Manifest;
  config: Record<string, unknown>;
  credentialId?: string;
  failure?: string;
  attempts: number;
}

export interface Ports {
  platformVersion: string;
  runMigration(tenantId: string, moduleId: string, migrationId: string): Promise<void>;
  rollbackMigration(tenantId: string, moduleId: string, migrationId: string): Promise<void>;
  healthCheck(m: Manifest): Promise<boolean>;
  hasPending(tenantId: string, what: 'pending-orders' | 'pending-payouts' | 'open-shipments'): Promise<boolean>;
}

export class ModuleError extends Error {
  constructor(public code: string, message: string) { super(`${code}: ${message}`); }
}

const MAX_ATTEMPTS = 3;

export class ModuleManager {
  private installs = new Map<string, Installation>();
  private secrets = new Map<string, Map<string, string>>(); // almacén separado; nunca se devuelve al exterior
  private credentials = new Map<string, { tenantId: string; moduleId: string; scopes: string[]; revoked: boolean }>();
  readonly audit: Array<{ at: number; tenantId: string; moduleId: string; action: string; detail?: string }> = [];

  constructor(private ports: Ports) {}

  private key(t: string, m: string) { return `${t}::${m}`; }
  get(t: string, m: string) { return this.installs.get(this.key(t, m)); }
  private log(tenantId: string, moduleId: string, action: string, detail?: string) { this.audit.push({ at: Date.now(), tenantId, moduleId, action, detail }); }

  /** Comprueba una transición SIN efectos. Toda operación la llama antes de tocar estado, secretos o credenciales. */
  private assertCan(i: Installation, to: State) {
    if (!TRANSITIONS[i.state].includes(to)) throw new ModuleError('INVALID_TRANSITION', `${i.state} → ${to}`);
  }
  private move(i: Installation, to: State, detail?: string) {
    this.assertCan(i, to);
    this.log(i.tenantId, i.moduleId, `${i.state}→${to}`, detail);
    i.state = to;
  }

  /** VALIDATE + resolución de dependencias (detecta ciclos) para un conjunto de manifiestos del catálogo. */
  static resolveOrder(target: string, catalog: Map<string, Manifest>): string[] {
    const order: string[] = [];
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string, path: string[]) => {
      if (done.has(id)) return;
      if (visiting.has(id)) throw new ModuleError('CIRCULAR_DEPENDENCY', [...path, id].join(' → '));
      const m = catalog.get(id);
      if (!m) throw new ModuleError('MISSING_DEPENDENCY', `${id} no existe en el catálogo`);
      visiting.add(id);
      for (const [dep, range] of Object.entries(m.dependencies)) {
        const d = catalog.get(dep);
        if (d && !semver.satisfies(d.version, range)) throw new ModuleError('INCOMPATIBLE_DEPENDENCY', `${id} requiere ${dep}@${range}, catálogo tiene ${d.version}`);
        visit(dep, [...path, id]);
      }
      visiting.delete(id);
      done.add(id);
      order.push(id);
    };
    visit(target, []);
    return order;
  }

  private checkDependencies(tenantId: string, m: Manifest) {
    for (const [dep, range] of Object.entries(m.dependencies)) {
      const d = this.get(tenantId, dep);
      if (!d || d.state !== 'active') throw new ModuleError('MISSING_DEPENDENCY', `${dep} debe estar instalado y activo`);
      if (!semver.satisfies(d.version, range)) throw new ModuleError('INCOMPATIBLE_DEPENDENCY', `${dep}@${d.version} no cumple ${range}`);
    }
  }

  /** `tier` lo aporta el registro de la plataforma (paquete revisado y firmado), nunca el manifiesto. */
  async install(tenantId: string, raw: unknown, tier: Tier = 'third-party'): Promise<Installation> {
    const v = validateManifest(raw, tier);
    if (!v.ok) throw new ModuleError('INVALID_MANIFEST', v.errors.join('; '));
    const m = v.manifest;
    if (!semver.satisfies(this.ports.platformVersion, m.compatibility.platform)) {
      throw new ModuleError('INCOMPATIBLE_PLATFORM', `requiere plataforma ${m.compatibility.platform}, actual ${this.ports.platformVersion}`);
    }
    const existing = this.get(tenantId, m.id);
    if (existing && existing.state !== 'uninstalled' && existing.state !== 'failed') throw new ModuleError('ALREADY_INSTALLED', m.id);
    if (existing?.state === 'failed' && existing.attempts >= MAX_ATTEMPTS) throw new ModuleError('RETRY_LIMIT', `${existing.attempts} intentos agotados`);
    this.checkDependencies(tenantId, m);
    let i: Installation;
    if (existing) {
      i = existing;
      if (existing.state === 'uninstalled') i.attempts = 0;
      this.move(i, 'installing', 'reinstalación');
      Object.assign(i, { version: m.version, manifest: m, tier, failure: undefined, config: {} });
    } else {
      i = { tenantId, moduleId: m.id, version: m.version, tier, manifest: m, state: 'installing', config: {}, attempts: 0 };
      this.installs.set(this.key(tenantId, m.id), i);
      this.log(tenantId, m.id, 'install-start', m.version);
    }
    i.attempts++;
    await this.applyMigrations(i, m.migrations, 'failed');
    this.move(i, 'installed');
    return i;
  }

  /**
   * Aplica migraciones con compensación. Si una compensación falla o una migración aplicada es irreversible,
   * la instalación queda en `failed` con intervención manual: nunca se finge un rollback limpio.
   */
  private async applyMigrations(i: Installation, migrations: Manifest['migrations'], failState: State) {
    const applied: Manifest['migrations'] = [];
    try {
      for (const mig of migrations) {
        await this.ports.runMigration(i.tenantId, i.moduleId, mig.id);
        applied.push(mig);
      }
    } catch (e) {
      const problems: string[] = [];
      for (const mig of applied.reverse()) {
        if (!mig.reversible) { problems.push(`${mig.id} irreversible`); continue; }
        await this.ports.rollbackMigration(i.tenantId, i.moduleId, mig.id).catch((err) => problems.push(`rollback ${mig.id}: ${(err as Error).message}`));
      }
      i.failure = (e as Error).message + (problems.length ? ` | REQUIERE INTERVENCIÓN: ${problems.join('; ')}` : '');
      if (problems.length || failState === 'failed') this.move(i, 'failed', i.failure);
      throw new ModuleError(problems.length ? 'ROLLBACK_INCOMPLETE' : 'MIGRATION_FAILED', i.failure);
    }
  }

  async retry(tenantId: string, moduleId: string) {
    const i = this.mustGet(tenantId, moduleId);
    if (i.state !== 'failed') throw new ModuleError('INVALID_TRANSITION', 'solo se reintenta desde failed');
    return this.install(tenantId, i.manifest, i.tier);
  }

  configure(tenantId: string, moduleId: string, config: Record<string, unknown>, secrets: Record<string, string>) {
    const i = this.mustGet(tenantId, moduleId);
    this.assertCan(i, 'configured'); // antes de mutar nada: un módulo activo debe deshabilitarse primero
    const errors: string[] = [];
    for (const [k, f] of Object.entries(i.manifest.config)) {
      const val = config[k];
      if (val === undefined) { if ('required' in f && f.required && f.default === undefined) errors.push(`${k} es obligatorio`); continue; }
      if (f.type === 'enum' && !f.options.includes(String(val))) errors.push(`${k} debe ser uno de ${f.options.join(', ')}`);
      if (f.type === 'number' && (typeof val !== 'number' || (f.min !== undefined && val < f.min) || (f.max !== undefined && val > f.max))) errors.push(`${k} fuera de rango`);
      if (f.type === 'string' && typeof val !== 'string') errors.push(`${k} debe ser texto`);
      if (f.type === 'boolean' && typeof val !== 'boolean') errors.push(`${k} debe ser booleano`);
    }
    for (const k of Object.keys(config)) if (!(k in i.manifest.config)) errors.push(`${k} no está declarado en el manifiesto`);
    for (const s of i.manifest.secrets) if (s.required && !secrets[s.name] && !this.secrets.get(this.key(tenantId, moduleId))?.has(s.name)) errors.push(`secreto ${s.name} es obligatorio`);
    for (const k of Object.keys(secrets)) if (!i.manifest.secrets.some((s) => s.name === k)) errors.push(`secreto ${k} no declarado`);
    if (errors.length) throw new ModuleError('INCOMPLETE_CONFIG', errors.join('; '));
    i.config = { ...config };
    const store = this.secrets.get(this.key(tenantId, moduleId)) ?? new Map();
    for (const [k, v] of Object.entries(secrets)) store.set(k, v);
    this.secrets.set(this.key(tenantId, moduleId), store);
    this.move(i, 'configured', `secretos: ${Object.keys(secrets).join(',') || '-'}`); // nunca se registran valores
  }

  async activate(tenantId: string, moduleId: string) {
    const i = this.mustGet(tenantId, moduleId);
    this.assertCan(i, 'active');
    if (i.state !== 'configured' && i.state !== 'disabled') throw new ModuleError('INVALID_TRANSITION', `${i.state} → active`);
    this.checkDependencies(tenantId, i.manifest);
    if (!(await this.ports.healthCheck(i.manifest))) throw new ModuleError('UNHEALTHY', `${moduleId} no responde al health check`);
    this.revoke(i); // nunca dejar credenciales anteriores vivas
    const credentialId = randomBytes(16).toString('hex');
    this.credentials.set(credentialId, { tenantId, moduleId, scopes: [...i.manifest.permissions], revoked: false });
    i.credentialId = credentialId;
    this.move(i, 'active');
  }

  /** La API de la plataforma consulta esto en cada llamada de un módulo. */
  authorize(credentialId: string, tenantId: string, scope: string): boolean {
    const c = this.credentials.get(credentialId);
    return !!c && !c.revoked && c.tenantId === tenantId && c.scopes.includes(scope);
  }

  async update(tenantId: string, raw: unknown, opts: { approveMajor?: boolean; approvePermissions?: boolean } = {}) {
    const current = this.get(tenantId, (raw as { id?: string })?.id ?? '');
    const v = validateManifest(raw, current?.tier ?? 'third-party');
    if (!v.ok) throw new ModuleError('INVALID_MANIFEST', v.errors.join('; '));
    const next = v.manifest;
    const i = this.mustGet(tenantId, next.id);
    this.assertCan(i, 'updating');
    if (!semver.gt(next.version, i.version)) throw new ModuleError('NOT_NEWER', `${next.version} <= ${i.version}`);
    if (!semver.satisfies(this.ports.platformVersion, next.compatibility.platform)) throw new ModuleError('INCOMPATIBLE_PLATFORM', next.compatibility.platform);
    if (semver.major(next.version) > semver.major(i.version) && !opts.approveMajor) throw new ModuleError('MAJOR_REQUIRES_APPROVAL', `${i.version} → ${next.version}`);
    const newPerms = next.permissions.filter((p) => !i.manifest.permissions.includes(p));
    if (newPerms.length && !opts.approvePermissions) throw new ModuleError('NEW_PERMISSIONS_REQUIRE_APPROVAL', newPerms.join(','));
    const broken = [...this.installs.values()].filter((x) => x.tenantId === tenantId && x.state === 'active' && next.id in x.manifest.dependencies && !semver.satisfies(next.version, x.manifest.dependencies[next.id]!));
    if (broken.length) throw new ModuleError('BREAKS_DEPENDENTS', broken.map((b) => `${b.moduleId} requiere ${b.manifest.dependencies[next.id]}`).join(', '));
    this.checkDependencies(tenantId, next);
    this.move(i, 'updating', `${i.version} → ${next.version}`);
    const known = new Set(i.manifest.migrations.map((x) => x.id));
    try {
      await this.applyMigrations(i, next.migrations.filter((x) => !known.has(x.id)), 'active');
    } catch (e) {
      if (i.state === 'updating') this.move(i, 'active', `rollback a ${i.version}`); // rollback limpio: sigue la versión anterior
      throw e;
    }
    i.previousVersion = i.manifest;
    i.manifest = next;
    i.version = next.version;
    if (i.credentialId) { const c = this.credentials.get(i.credentialId)!; c.scopes = [...next.permissions]; }
    this.move(i, 'active', `actualizado a ${next.version}`);
  }

  disable(tenantId: string, moduleId: string) {
    const i = this.mustGet(tenantId, moduleId);
    this.assertCan(i, 'disabled');
    const dependents = [...this.installs.values()].filter((x) => x.tenantId === tenantId && x.state === 'active' && moduleId in x.manifest.dependencies);
    if (dependents.length) throw new ModuleError('HAS_DEPENDENTS', dependents.map((d) => d.moduleId).join(','));
    this.revoke(i);
    this.move(i, 'disabled');
  }

  async uninstall(tenantId: string, moduleId: string) {
    const i = this.mustGet(tenantId, moduleId);
    if (i.state === 'active') throw new ModuleError('MUST_DISABLE_FIRST', moduleId);
    this.assertCan(i, 'uninstalling');
    for (const b of i.manifest.uninstallPolicy.blockIf) {
      if (await this.ports.hasPending(tenantId, b)) throw new ModuleError('UNINSTALL_BLOCKED', b);
    }
    this.move(i, 'uninstalling');
    this.revoke(i);
    this.secrets.delete(this.key(tenantId, moduleId));
    this.move(i, 'uninstalled', `datos retenidos ${i.manifest.uninstallPolicy.dataRetentionDays} días y luego purgados`);
  }

  /** Recuperación tras reinicio: lo que quedó a medias pasa a failed para reintento controlado. */
  recoverAfterCrash() {
    for (const i of this.installs.values()) {
      if (i.state === 'installing' || i.state === 'uninstalling') this.move(i, 'failed', 'interrumpido por reinicio');
      if (i.state === 'updating') this.move(i, 'active', `reinicio durante update; se mantiene ${i.version}`);
    }
  }

  hasSecret(tenantId: string, moduleId: string, name: string) { return this.secrets.get(this.key(tenantId, moduleId))?.has(name) ?? false; }
  /** Solo para el test harness: simula un estado persistido a mitad de operación. */
  _forceState(tenantId: string, moduleId: string, s: State) { this.mustGet(tenantId, moduleId).state = s; }

  private revoke(i: Installation) {
    if (!i.credentialId) return;
    const c = this.credentials.get(i.credentialId);
    if (c && !c.revoked) { c.revoked = true; this.log(i.tenantId, i.moduleId, 'credential-revoked'); }
  }
  private mustGet(t: string, m: string) { const i = this.get(t, m); if (!i) throw new ModuleError('NOT_INSTALLED', m); return i; }
}
