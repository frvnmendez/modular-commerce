/**
 * Crea la base de datos y los roles. Se ejecuta UNA vez con credenciales de administrador
 * (local: superusuario postgres; en la nube: usuario admin del servicio gestionado).
 * Idempotente. No crea tablas: eso lo hacen las migraciones con el rol migrator.
 */
import pg from 'pg';
import { ROLE_USERS, passwordFor, type DbRole } from './config.ts';

const adminUrl = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const dbName = process.env.DATABASE_NAME ?? 'modular_commerce';
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`identificador inválido: ${s}`);
  return `"${s}"`;
};
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

const ROLE_FLAGS: Record<DbRole, string> = {
  // Dueño de los esquemas. BYPASSRLS para que migraciones y backfills afecten a todas las filas (ver ADR-0002, RT-1).
  migrator: 'LOGIN NOSUPERUSER NOCREATEROLE BYPASSRLS',
  // Rol de la API: nunca dueño, nunca BYPASSRLS.
  app: 'LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS',
  // Solo esquema auth (Better Auth).
  auth: 'LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS',
  // Operación de plataforma: lectura de vistas concretas del plano de control.
  ops: 'LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS',
};

export async function bootstrap() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    for (const role of Object.keys(ROLE_USERS) as DbRole[]) {
      const name = ROLE_USERS[role];
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      await admin.query(`${verb} ROLE ${ident(name)} ${ROLE_FLAGS[role]} PASSWORD ${lit(passwordFor(role))}`);
    }
    const db = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!db.rowCount) await admin.query(`CREATE DATABASE ${ident(dbName)} OWNER ${ident(ROLE_USERS.migrator)}`);
    await admin.query(`REVOKE ALL ON DATABASE ${ident(dbName)} FROM PUBLIC`);
    for (const r of ['app', 'auth', 'ops'] as DbRole[]) {
      await admin.query(`GRANT CONNECT ON DATABASE ${ident(dbName)} TO ${ident(ROLE_USERS[r])}`);
    }
  } finally {
    await admin.end();
  }
  // Dentro de la BD: quitar privilegios por defecto del esquema public y añadir extensiones.
  const inDb = new pg.Client({ connectionString: adminUrl.replace(/\/[^/]*$/, `/${dbName}`) });
  await inDb.connect();
  try {
    await inDb.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await inDb.query('CREATE EXTENSION IF NOT EXISTS citext');
  } finally {
    await inDb.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await bootstrap();
  console.log(`bootstrap OK: base ${dbName} y roles ${Object.values(ROLE_USERS).join(', ')}`);
}
