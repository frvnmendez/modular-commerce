'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, type Me } from '@/lib/api';
import { readPendingInvite } from '@/lib/pending-invite';

/** Punto de entrada: sin sesión → login; invitación pendiente → aceptarla; sin tiendas → onboarding; si no, a la primera tienda. */
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    api<Me>('/v1/me')
      .then((me) => {
        const invite = readPendingInvite();
        router.replace(invite ?? (me.stores[0] ? `/stores/${me.stores[0].id}` : '/onboarding'));
      })
      .catch((e) => router.replace(e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED' ? '/login?verify=1' : '/login'));
  }, [router]);
  return <p className="p-8 text-sm text-muted" role="status">Cargando…</p>;
}
