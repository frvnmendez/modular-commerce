import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import Link from 'next/link';
import { IconArrowLeft, IconCheck, IconClose, IconSparkle } from './icons';

type Variant = 'primary' | 'secondary' | 'plain' | 'danger' | 'danger-plain';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg shadow-[inset_0_-1px_0_rgba(0,0,0,.2)] hover:bg-accent-hover',
  secondary: 'bg-surface border border-border-strong/70 text-text shadow-[0_1px_0_rgba(20,20,40,.05)] hover:bg-surface-2',
  plain: 'text-accent-text hover:bg-accent-soft',
  danger: 'bg-danger text-white hover:opacity-90',
  'danger-plain': 'text-danger hover:bg-danger-soft',
};
const btnBase = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const SIZE = { sm: 'h-8 px-2.5 text-[13px]', md: 'h-9 px-3.5 text-sm' } as const;

export function Button({ variant = 'primary', size = 'md', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE }) {
  return <button {...p} className={`${btnBase} ${SIZE[size]} ${VARIANT[variant]} ${className}`} />;
}

export function ButtonLink({ href, variant = 'secondary', size = 'md', className = '', children }: { href: string; variant?: Variant; size?: keyof typeof SIZE; className?: string; children: ReactNode }) {
  return <Link href={href} className={`${btnBase} ${SIZE[size]} ${VARIANT[variant]} ${className}`}>{children}</Link>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {error ? <span className="block text-xs text-danger" role="alert">{error}</span> : hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const inputCls = 'w-full h-9 rounded-[var(--radius)] border border-border-strong/80 bg-surface px-3 text-sm placeholder:text-subtle outline-none transition-shadow focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ''}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} pr-8 ${p.className ?? ''}`} />;

export function Card({ title, description, children, actions, footer, flush = false, className = '' }: {
  title?: ReactNode; description?: ReactNode; children?: ReactNode; actions?: ReactNode; footer?: ReactNode; flush?: boolean; className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-border/70 ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={flush ? 'mt-3' : 'p-4 sm:p-5'}>{children}</div>
      {footer && <footer className="border-t border-border bg-surface-2 px-4 py-3 text-[13px] text-muted sm:px-5">{footer}</footer>}
    </section>
  );
}

export function Notice({ kind = 'info', children, onDismiss }: { kind?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode; onDismiss?: () => void }) {
  const c = {
    info: 'bg-info-soft text-text border-info/25', error: 'bg-danger-soft text-text border-danger/30',
    success: 'bg-success-soft text-text border-success/30', warning: 'bg-warning-soft text-text border-warning/30',
  }[kind];
  const dot = { info: 'bg-info', error: 'bg-danger', success: 'bg-success', warning: 'bg-warning' }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`mc-pop flex items-start gap-3 rounded-[var(--radius)] border px-3.5 py-2.5 text-[13px] ${c}`}>
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && <button type="button" onClick={onDismiss} aria-label="Cerrar aviso" className="text-muted hover:text-text"><IconClose size={16} /></button>}
    </div>
  );
}

export function EmptyState({ title, body, action, illustration }: { title: string; body: ReactNode; action?: ReactNode; illustration?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      {illustration && <div className="mx-auto mb-5 w-fit">{illustration}</div>}
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mx-auto mt-1.5 max-w-md text-[13px] text-muted">{body}</div>
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Cabecera de página: volver, título, estado, descripción y como mucho una acción principal. */
export function PageHeader({ title, subtitle, back, badge, primary, secondary }: {
  title: ReactNode; subtitle?: ReactNode; back?: { href: string; label: string }; badge?: ReactNode; primary?: ReactNode; secondary?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        {back && (
          <Link href={back.href} aria-label={back.label} className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[var(--radius)] text-muted hover:bg-surface-3 hover:text-text">
            <IconArrowLeft size={18} />
          </Link>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {(primary || secondary) && <div className="flex flex-wrap items-center gap-2">{secondary}{primary}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
export function Badge({ tone = 'neutral', children, dot = false }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  const c = {
    neutral: 'bg-surface-3 text-muted', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info', accent: 'bg-accent-soft text-accent-text',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}{children}
    </span>
  );
}

export const SoonBadge = () => <Badge tone="accent"><IconSparkle size={12} />Próximamente</Badge>;

const AVATAR_TONES = ['bg-[#e0dcfb] text-[#3f36b8]', 'bg-[#d6efe3] text-[#0b6b42]', 'bg-[#fbe3cf] text-[#8a4300]', 'bg-[#dbe8f8] text-[#1f4f8a]', 'bg-[#f6dbe6] text-[#94244f]'];
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  const tone = AVATAR_TONES[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span aria-hidden style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${tone}`}>{initials}</span>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}

export const Skeleton = ({ className = '' }: { className?: string }) => <span aria-hidden className={`mc-skeleton block rounded ${className}`} />;

export function CheckCircle({ done, size = 20 }: { done: boolean; size?: number }) {
  return done
    ? <span aria-hidden style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-full bg-accent text-accent-fg"><IconCheck size={size * 0.65} strokeWidth={2.5} /></span>
    : <span aria-hidden style={{ width: size, height: size }} className="shrink-0 rounded-full border-[1.5px] border-dashed border-border-strong" />;
}

/** Sección de ajustes: título y descripción a la izquierda, contenido a la derecha. */
export function SettingsSection({ title, description, children }: { title: ReactNode; description: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-b border-border py-6 first:pt-0 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8">
      <div><h2 className="text-[15px] font-semibold">{title}</h2><p className="mt-1 text-[13px] text-muted">{description}</p></div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Carga inicial con la forma de la página, en lugar de un texto suelto. */
export function PageSkeleton({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-5">
      <Skeleton className="h-6 w-48" />
      <div className="space-y-3 rounded-card bg-surface p-5 shadow-card ring-1 ring-border/70">
        <Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
