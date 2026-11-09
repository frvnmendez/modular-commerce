/**
 * Invitaciones pendientes mientras la persona inicia sesión o se registra.
 *
 * - Se guardan en localStorage y no en sessionStorage: el enlace de verificación de email suele abrirse en otra
 *   pestaña, y sessionStorage no se comparte entre pestañas.
 * - Es una lista corta (máx. 5, sin duplicados) y no un único valor: si se abren dos invitaciones en pestañas
 *   distintas antes de iniciar sesión, se retoman las dos, una detrás de otra, en el orden en que se abrieron.
 * - Solo se acepta la ruta interna exacta `/invitations/accept#<token>` y cada entrada caduca a las 24 h. Esa
 *   caducidad solo decide si se retoma automáticamente: la validez real (caducidad, revocación, destinatario)
 *   la decide siempre el servidor.
 * - Cuándo se borra una entrada: al aceptarla; ante un error definitivo (404: no existe, caducó, ya se usó, se
 *   revocó o es para otro email; 400: token mal formado); y todas al cerrar sesión. Ante errores transitorios
 *   (sin conexión, 429, 5xx) se conserva para reintentar. Ante 401 o email sin verificar se conserva y se va al login.
 */
const KEY = 'pendingInvite';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX = 5;
export const INVITE_PATH = /^\/invitations\/accept#[A-Za-z0-9_-]{20,200}$/;

type Entry = { path: string; at: number };

function load(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    const list = Array.isArray(v) ? v : [v];   // formato anterior: un único objeto
    return list.filter((e): e is Entry => !!e && typeof e.path === 'string' && INVITE_PATH.test(e.path)
      && typeof e.at === 'number' && Date.now() - e.at < TTL_MS);
  } catch {
    return [];
  }
}

function store(list: Entry[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list)); else localStorage.removeItem(KEY);
  } catch { /* almacenamiento no disponible */ }
}

export function savePendingInvite(path: string) {
  if (!INVITE_PATH.test(path)) return;
  const list = load().filter((e) => e.path !== path);
  list.push({ path, at: Date.now() });
  store(list.slice(-MAX));
}

/** Primera invitación pendiente válida y vigente (las inválidas o caducadas se descartan). */
export function readPendingInvite(): string | null {
  const list = load();
  store(list);
  return list[0]?.path ?? null;
}

/** Sin argumento borra todas (cierre de sesión); con una ruta borra solo esa. */
export function clearPendingInvite(path?: string) {
  if (path === undefined) {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* nada que borrar */ }
    return;
  }
  store(load().filter((e) => e.path !== path));
}
