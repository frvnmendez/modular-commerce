/**
 * Invitación pendiente mientras la persona inicia sesión o se registra.
 *
 * Se guarda en localStorage y no en sessionStorage: el enlace de verificación de email suele abrirse en otra
 * pestaña, y sessionStorage no se comparte entre pestañas. Solo se acepta una ruta interna exacta
 * (`/invitations/accept#<token>`), caduca a las 24 h y se borra al aceptar, al fallar de forma definitiva
 * o al cerrar sesión. El token sigue sin salir del navegador hasta que se envía a la API.
 */
const KEY = 'pendingInvite';
const TTL_MS = 24 * 60 * 60 * 1000;
export const INVITE_PATH = /^\/invitations\/accept#[A-Za-z0-9_-]{20,200}$/;

export function savePendingInvite(path: string) {
  if (!INVITE_PATH.test(path)) return;
  try { localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() })); } catch { /* almacenamiento no disponible */ }
}

/** Devuelve la ruta pendiente solo si es una invitación interna válida y vigente; si no, la borra. */
export function readPendingInvite(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof v.path === 'string' && INVITE_PATH.test(v.path) && typeof v.at === 'number' && Date.now() - v.at < TTL_MS) return v.path;
  } catch { /* valor corrupto */ }
  clearPendingInvite();
  return null;
}

export function clearPendingInvite() {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* nada que borrar */ }
}
