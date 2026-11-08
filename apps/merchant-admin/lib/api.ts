'use client';

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  EMAIL_NOT_VERIFIED: 'Verifica tu email antes de continuar.',
  NOT_FOUND: 'No encontramos lo que buscas o no tienes acceso.',
  FORBIDDEN: 'Tu rol no permite esta acción. Pide acceso a un propietario de la tienda.',
  CONFLICT: 'Ya existe o entra en conflicto con otro elemento. Revisa los datos.',
  VALIDATION: 'Revisa los campos marcados.',
  INTERNAL: 'Algo ha fallado por nuestra parte. Inténtalo de nuevo en unos minutos.',
};

export const humanError = (e: unknown) =>
  e instanceof ApiError ? MESSAGES[e.code] ?? `Error ${e.status}` : 'No hay conexión con el servidor.';

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? data.code ?? 'INTERNAL');
  return data as T;
}

export type Me = {
  user: { id: string; email: string; name: string };
  organizations: { id: string; name: string; role: string }[];
  stores: { id: string; orgId: string; name: string; slug: string; role: string }[];
  platformOperator: boolean;
};
