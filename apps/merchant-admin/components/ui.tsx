import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export function Button({ variant = 'primary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const v = {
    primary: 'bg-accent text-accent-fg hover:opacity-90',
    secondary: 'bg-surface border border-border text-text hover:bg-surface-2',
    danger: 'bg-danger-soft text-danger hover:opacity-90',
  }[variant];
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius)] px-4 h-10 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${v} ${className}`} />;
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? <span className="block text-xs text-danger" role="alert">{error}</span> : hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const inputCls = 'w-full h-10 rounded-[var(--radius)] border border-border bg-surface px-3 text-sm placeholder:text-muted focus:border-accent outline-none';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ''}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} ${p.className ?? ''}`} />;

export function Card({ title, description, children, actions }: { title?: string; description?: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-[var(--radius)] border border-border bg-surface p-5 sm:p-6">
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const c = { info: 'bg-surface-2 text-text', error: 'bg-danger-soft text-danger', success: 'bg-accent-soft text-accent' }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-[var(--radius)] px-4 py-3 text-sm ${c}`}>{children}</div>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-border bg-surface px-6 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
