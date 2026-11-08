'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, humanError } from '@/lib/api';
import { EmptyState } from '@/components/ui';
import { clearPendingInvite, savePendingInvite } from '@/lib/pending-invite';

/** El token viaja en el fragmento (#) para que no quede en logs de servidor ni en el Referer. */
export default function AcceptInvitation() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const token = location.hash.slice(1);
    if (!token) { clearPendingInvite(); setError('El enlace de invitación no es válido.'); return; }
    api<{ storeId: string }>('/v1/invitations/accept', { method: 'POST', body: { token } })
      .then((r) => { clearPendingInvite(); router.replace(`/stores/${r.storeId}`); })
      .catch((e) => {
        if (e instanceof ApiError && (e.status === 401 || e.code === 'EMAIL_NOT_VERIFIED')) {
          // Sin sesión (o sin verificar): se retoma tras iniciar sesión o verificar el email.
          savePendingInvite(`/invitations/accept#${token}`);
          router.replace(e.status === 401 ? '/login?invite=1' : '/login?verify=1&invite=1');
          return;
        }
        clearPendingInvite();
        setError(e instanceof ApiError && e.status === 404 ? 'Esta invitación no existe, ha caducado, ya se usó o es para otro email.' : humanError(e));
      });
  }, [router]);
  if (error) return <main className="p-6"><EmptyState title="No se pudo aceptar la invitación" body={error} /></main>;
  return <p className="p-8 text-sm text-muted" role="status">Aceptando invitación…</p>;
}
