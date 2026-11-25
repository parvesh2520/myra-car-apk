import type { AssistantStatus } from '../../context/AssistantContext';

/** Animated presence for Myra. Each state has a distinct shape, not just a colour. */
export function VoiceOrb({ status, size = 96 }: { status: AssistantStatus; size?: number }) {
  const listening = status === 'listening';
  const thinking = status === 'thinking';
  const speaking = status === 'speaking';
  return (
    <div className="relative grid place-items-center shrink-0" style={{ width: size, height: size }} aria-hidden>
      {listening &&
        [0, 0.55, 1.1].map((d) => (
          <span
            key={d}
            className="keep-motion absolute inset-0 rounded-full border border-accent/60"
            style={{ animation: `ring 1.8s ${d}s ease-out infinite` }}
          />
        ))}
      {thinking && (
        <span
          className="absolute inset-[-3px] rounded-full"
          style={{
            background: 'conic-gradient(from 0deg, transparent 0 60%, var(--color-accent) 85%, transparent)',
            animation: 'orb-spin 1s linear infinite',
            mask: 'radial-gradient(circle, transparent 62%, #000 64%)',
            WebkitMask: 'radial-gradient(circle, transparent 62%, #000 64%)',
          }}
        />
      )}
      <span
        className="absolute inset-[10%] rounded-full"
        style={{
          background:
            'radial-gradient(circle at 35% 30%, #b9dcff 0%, #4d9eff 38%, #1d4f9a 72%, #0b2246 100%)',
          boxShadow: listening || speaking ? '0 0 36px 4px rgb(77 158 255 / 0.45)' : '0 0 22px rgb(77 158 255 / 0.25)',
          animation: status === 'idle' ? 'breathe 3.2s ease-in-out infinite' : undefined,
          transition: 'box-shadow 300ms',
        }}
      />
      <span className="relative flex items-center gap-[3px] h-[34%]">
        {[0.9, 0.5, 1, 0.65, 0.8].map((h, i) => (
          <span
            key={i}
            className="keep-motion w-[3px] rounded-full bg-white/90 origin-center"
            style={{
              height: `${h * 100}%`,
              animation: listening || speaking ? `wave ${0.7 + i * 0.12}s ${i * 0.08}s ease-in-out infinite` : undefined,
              transform: listening || speaking ? undefined : 'scaleY(0.3)',
            }}
          />
        ))}
      </span>
    </div>
  );
}
