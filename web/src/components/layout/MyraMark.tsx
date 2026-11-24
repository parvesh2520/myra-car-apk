/** MYRA wordmark: a soft "M" glyph followed by the product name. */
export function MyraMark({ className = '', showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} aria-label="MYRA">
      <svg viewBox="0 0 32 32" className="h-full aspect-square" aria-hidden>
        <defs>
          <linearGradient id="myra-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8cc2ff" />
            <stop offset="1" stopColor="#3d86f0" />
          </linearGradient>
        </defs>
        <path d="M6 24V9.5c0-1 1.2-1.5 1.9-.8L16 16.8l8.1-8.1c.7-.7 1.9-.2 1.9.8V24" fill="none" stroke="url(#myra-g)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {showText && <span className="font-semibold tracking-[0.28em] text-ink text-[0.9375rem] leading-none">MYRA</span>}
    </span>
  );
}
