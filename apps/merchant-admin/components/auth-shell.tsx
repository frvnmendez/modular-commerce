import type { ReactNode } from 'react';
import { BrandMark, IconCheck } from './icons';

const POINTS = [
  'Un panel que se adapta a lo que vendes: solo ves lo que usas.',
  'Tu equipo con roles claros y un registro de cada cambio.',
  'Cada tienda aislada: nadie más puede ver tus datos.',
];

/** Pantallas de acceso: panel de marca a la izquierda (escritorio) y formulario en tarjeta. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-ink p-10 text-ink-text lg:flex lg:flex-col">
        <div className="flex items-center gap-2"><BrandMark size={28} /><span className="text-lg font-semibold tracking-tight">modular</span></div>
        <div className="relative z-10 mt-auto max-w-md">
          <p className="text-3xl leading-tight font-semibold tracking-tight">Tu tienda online, sin piezas que no necesitas.</p>
          <ul className="mt-8 space-y-3 text-[14px] text-ink-muted">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#8b85f4]/20 text-[#b1adf8]"><IconCheck size={13} strokeWidth={2.5} /></span>{p}</li>
            ))}
          </ul>
        </div>
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 grid grid-cols-2 gap-4 opacity-[.07]">
          {[0, 1, 2, 3].map((i) => <span key={i} className={`size-48 bg-white ${i === 3 ? 'rounded-full' : 'rounded-[40px]'}`} />)}
        </div>
      </aside>
      <main className="flex flex-col items-center justify-center px-4 py-12">
        <div className="mb-8 flex items-center gap-2 lg:hidden"><BrandMark size={28} /><span className="text-lg font-semibold tracking-tight">modular</span></div>
        <div className="w-full max-w-sm rounded-card bg-surface p-6 shadow-card ring-1 ring-border/70 sm:p-8">{children}</div>
      </main>
    </div>
  );
}
