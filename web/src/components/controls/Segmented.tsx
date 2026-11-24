import type { ReactNode } from 'react';

interface SegmentedProps<T extends string | number> {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function Segmented<T extends string | number>({ value, options, onChange, label, size = 'md', className = '' }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-[14px] bg-surface-2 border border-line p-1 gap-1 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-[10px] font-medium whitespace-nowrap transition-colors duration-150 ${
              size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm'
            } ${active ? 'bg-accent text-on-accent shadow-sm' : 'text-ink-2 hover:text-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
