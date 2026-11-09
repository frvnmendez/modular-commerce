/** Configuración de conexión por rol. Cada proceso usa el rol mínimo que necesita. */
export type DbRole = 'migrator' | 'app' | 'auth' | 'ops';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
};

export const ROLE_USERS: Record<DbRole, string> = {
  migrator: 'mc_migrator',
  app: 'mc_app',
  auth: 'mc_auth',
  ops: 'mc_ops',
};

const PASSWORD_VARS: Record<DbRole, string> = {
  migrator: 'DATABASE_MIGRATOR_PASSWORD',
  app: 'DATABASE_APP_PASSWORD',
  auth: 'DATABASE_AUTH_PASSWORD',
  ops: 'DATABASE_OPS_PASSWORD',
};

export function connectionFor(role: DbRole) {
  return {
    host: process.env.DATABASE_HOST ?? '127.0.0.1',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    database: process.env.DATABASE_NAME ?? 'modular_commerce',
    user: ROLE_USERS[role],
    password: required(PASSWORD_VARS[role]),
  };
}

export function passwordFor(role: DbRole) {
  return required(PASSWORD_VARS[role]);
}
