interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** Accessible switch. State is shown by knob position and a check mark, not colour alone. */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-14 h-8 rounded-full border transition-colors duration-200 ${
        checked ? 'bg-accent border-transparent' : 'bg-surface-3 border-line-strong'
      }`}
    >
      <span
        className="absolute left-[3px] top-[3px] size-6 rounded-full bg-white shadow-md grid place-items-center transition-transform duration-200"
        style={{ transform: checked ? 'translateX(24px)' : 'none' }}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="size-3 text-accent" aria-hidden>
            <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}
