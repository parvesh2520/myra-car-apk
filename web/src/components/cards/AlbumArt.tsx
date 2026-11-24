import { EighthNotes, MicVocal, Radio } from 'lucide-react';

interface AlbumArtProps {
  colours: [string, string];
  size?: number;
  kind?: 'music' | 'podcast' | 'radio';
  label?: string;
  spinning?: boolean;
  className?: string;
}

/** Generated artwork (no copyrighted covers): layered gradients with a soft light sweep. */
export function AlbumArt({ colours, size = 96, kind = 'music', label, spinning, className = '' }: AlbumArtProps) {
  const Icon = kind === 'podcast' ? MicVocal : kind === 'radio' ? Radio : EighthNotes;
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-[18%] ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 78% 18%, ${colours[0]}cc, transparent 55%), linear-gradient(140deg, ${colours[0]}, ${colours[1]} 75%)`,
        boxShadow: `0 ${size / 8}px ${size / 3}px -${size / 6}px ${colours[1]}`,
      }}
      role="img"
      aria-label={label ? `Artwork for ${label}` : 'Artwork'}
    >
      <div
        className="absolute -inset-1/4 rounded-full opacity-30"
        style={{
          background: 'conic-gradient(from 210deg, transparent, rgba(255,255,255,.55), transparent 40%)',
          animation: spinning ? 'orb-spin 9s linear infinite' : undefined,
        }}
      />
      <div className="absolute inset-0 grid place-items-center">
        <Icon size={size * 0.32} className="text-white/85 drop-shadow" strokeWidth={1.6} aria-hidden />
      </div>
    </div>
  );
}
