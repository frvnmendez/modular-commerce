-- 0002: tablas de identidad de Better Auth 1.7 (generadas con getMigrations y revisadas a mano).
-- Viven en el esquema auth; solo mc_auth tiene acceso. mc_app no puede leer contraseñas ni sesiones.
SET LOCAL search_path = auth;

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO mc_auth;

-- Directorio mínimo para que el plano de control muestre nombres/emails de miembros, sin exponer el resto.
CREATE FUNCTION control.member_directory(p_store uuid)
  RETURNS TABLE (user_id text, name text, email text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, control, auth AS $$
  SELECT sm.user_id, u.name, u.email, sm.role
  FROM control.store_members sm JOIN auth."user" u ON u.id = sm.user_id
  WHERE sm.store_id = p_store AND control.store_role(p_store) IS NOT NULL
  ORDER BY sm.created_at
$$;
REVOKE ALL ON FUNCTION control.member_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control.member_directory(uuid) TO mc_app;
