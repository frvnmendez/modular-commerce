'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, humanError } from '@/lib/api';
import { Button, EmptyState } from '@/components/ui';
import { clearPendingInvite, readPendingInvite, savePendingInvite } from '@/lib/pending-invite';

type Failure = { title: string; body: string; kind: 'definitive' | 'transient' };

/**
 * El token viaja en el fragmento (#) para que no quede en logs de servidor ni en el Referer.
 * Cuándo se borra la invitación guardada: ver lib/pending-invite.ts.
 */
export default function AcceptInvitation() {
  const router = useRouter();
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const path = `/invitations/accept#${token ?? ''}`;

  useEffect(() => { setToken(location.hash.slice(1)); }, []);

  useEffect(() => {
    if (token === null) return;
    if (!token) { setFailure({ title: 'No se pudo aceptar la invitación', body: 'El enlace de invitación no es válido.', kind: 'definitive' }); return; }
    setFailure(null);
    api<{ storeId: string }>('/v1/invitations/accept', { method: 'POST', body: { token } })
      .then((r) => {
        clearPendingInvite(path);
        // Si había otra invitación abierta en otra pestaña antes de iniciar sesión, se retoma a continuación
        // pasando por la portada (un cambio solo del # no volvería a montar esta página).
        router.replace(readPendingInvite() ? '/' : `/stores/${r.storeId}`);
      })
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.code === 'EMAIL_NOT_VERIFIED')) {
          // Sin sesión (o sin verificar): se retoma tras iniciar sesión o verificar el email.
          savePendingInvite(path);
          router.replace(e.status === 401 ? '/login?invite=1' : '/login?verify=1&invite=1');
          return;
        }
        if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
          // Definitivo: reintentar con esta cuenta no cambiará el resultado.
          clearPendingInvite(path);
          setFailure({
            title: 'No se pudo aceptar la invitación',
            body: 'Esta invitación no existe, ha caducado, ya se usó, se revocó o es para otro email. Si es para otra cuenta, cierra sesión y entra con ella.',
            kind: 'definitive',
          });
          return;
        }
        // Transitorio (sin conexión, 429, 5xx…): se conserva para reintentar.
        savePendingInvite(path);
        setFailure({ title: 'No se pudo aceptar la invitación todavía', body: humanError(e), kind: 'transient' });
      });
  }, [router, token, path, attempt]);

  const switchAccount = useCallback(async () => {
    await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    clearPendingInvite();
    savePendingInvite(path);   // se retoma con la cuenta con la que entre
    router.replace('/login?invite=1');
  }, [router, path]);

  if (failure) {
    const action = failure.kind === 'transient'
      ? <Button onClick={() => setAttempt((n) => n + 1)}>Reintentar</Button>
      : token ? <Button variant="secondary" onClick={switchAccount}>Cerrar sesión y usar otra cuenta</Button> : undefined;
    return <main className="p-6"><EmptyState title={failure.title} body={failure.body} action={action} /></main>;
  }
  return <p className="p-8 text-sm text-muted" role="status">Aceptando invitación…</p>;
}
