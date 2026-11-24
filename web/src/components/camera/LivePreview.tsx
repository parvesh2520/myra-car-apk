import { useEffect, useRef, type RefObject } from 'react';

/**
 * Mirrored live camera view with a canvas overlay. `draw` runs every animation
 * frame with the canvas sized to the element; coordinates are display-normalised
 * (already mirrored), so overlay text is never flipped.
 */
export function LivePreview({
  stream,
  draw,
  videoRef,
  label,
}: {
  stream: MediaStream;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  videoRef?: RefObject<HTMLVideoElement | null>;
  label: string;
}) {
  const ownVideo = useRef<HTMLVideoElement | null>(null);
  const video = videoRef ?? ownVideo;
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    v.play().catch(() => {});
  }, [stream, video]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = canvas.current;
      if (!c) return;
      const { clientWidth: w, clientHeight: h } = c;
      if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-black">
      <video ref={video} muted playsInline aria-label={label} className="absolute inset-0 size-full object-fill -scale-x-100" />
      <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />
      <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
        <span className="size-2 rounded-full bg-danger animate-pulse" aria-hidden /> LIVE
      </span>
    </div>
  );
}
