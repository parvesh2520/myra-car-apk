import type { ReactNode } from 'react';

export function Group({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="card p-5 mb-4" aria-label={title}>
      <h2 className="label mb-2">{title}</h2>
      <div className="flex flex-col divide-y divide-line">{children}</div>
      {note && <p className="text-xs text-ink-3 mt-3">{note}</p>}
    </section>
  );
}

export function Setting({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5 min-h-[64px]">
      <div className="min-w-0">
        <p className="text-[0.9375rem] text-ink">{label}</p>
        {hint && <p className="text-xs text-ink-2 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-3">{children}</div>
    </div>
  );
}
