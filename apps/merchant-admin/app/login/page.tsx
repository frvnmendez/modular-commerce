'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Input, Notice } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(params.get('verify') === '1');
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true); setError(null);
    const body = Object.fromEntries(form) as Record<string, string>;
    const res = await fetch(mode === 'in' ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    setBusy(false);
    if (mode === 'up' && res.ok) return setSent(true);
    if (res.ok) return router.replace('/');
    if (res.status === 403) return setSent(true);
    if (res.status === 429) return setError('Demasiados intentos. Espera un minuto y vuelve a probar.');
    setError(mode === 'in' ? 'Email o contraseña incorrectos.' : 'No hemos podido crear la cuenta. Revisa los datos (contraseña de 10 caracteres o más).');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{mode === 'in' ? 'Inicia sesión' : 'Crea tu cuenta'}</h1>
      <p className="mt-1 text-sm text-muted">{mode === 'in' ? 'Accede al panel de tu tienda.' : 'Abre tu tienda en unos minutos.'}</p>
      <div className="mt-6 space-y-4">
        {sent && <Notice kind="success">Te hemos enviado un enlace de verificación. Ábrelo para activar tu cuenta.</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        <form action={submit} className="space-y-4">
          {mode === 'up' && <Field label="Nombre"><Input name="name" required autoComplete="name" /></Field>}
          <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
          <Field label="Contraseña" hint={mode === 'up' ? 'Mínimo 10 caracteres.' : undefined}>
            <Input name="password" type="password" required minLength={mode === 'up' ? 10 : undefined} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Un momento…' : mode === 'in' ? 'Entrar' : 'Crear cuenta'}</Button>
        </form>
        <button className="w-full text-center text-sm text-muted underline-offset-4 hover:underline" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }}>
          {mode === 'in' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
        </button>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
