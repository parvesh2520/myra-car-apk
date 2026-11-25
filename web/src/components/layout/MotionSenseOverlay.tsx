import { useEffect, useRef } from 'react';
import { useMotionSense } from '../../hooks/useMotionSense';
import { MotionProcessor, cueVisual, motionRuntime, motionSimulator, motionTelemetry, type MotionProvider } from '../../services/motionSense';
import { DeviceMotionProvider } from '../../services/motionSensors';
import { MotionSenseDemo } from './MotionSenseDemo';
import type { MotionAdaptation, MotionInput, MotionIntensity } from '../../types';

/**
 * iPhone Vehicle Motion Cues-style layout: a band of dots down each side of the screen.
 * Each dot has a home in two staggered columns — `edge` is its distance from the screen
 * edge (px), `y` its height (fraction of the screen) — where it rests while the ride is
 * steady. `px`/`py` give its direction from the screen centre, used to light the right
 * dots when reduced motion is on.
 */
const ROWS = 12;
const ROW_GAP = 0.82 / (ROWS - 1); // fraction of screen height between rows
const HOMES = (['left', 'right'] as const).flatMap((side) =>
  Array.from({ length: ROWS }, (_, i) => {
    const y = 0.09 + ROW_GAP * i;
    return { side, edge: i % 2 ? 58 : 24, y, px: side === 'left' ? -1 : 1, py: (y - 0.5) / 0.41 };
  }),
);
type Home = (typeof HOMES)[number];

/**
 * How the dots stream. Every dot moves in lockstep on a conveyor, so the stream stays
 * evenly spaced with no random respawns.
 * - Sideways: a dot crosses the band, born large on the upstream side and shrinking and
 *   fading toward the far side, then wraps around to enter again.
 * - Up and down: dots keep their full size and brightness and glide the whole height of
 *   the screen. They fade only at the top or bottom edge, where they wrap around to the
 *   other end — nothing pulses or vanishes mid-screen.
 */
const FLOW = {
  outer: 8, // px — band edge nearest the screen edge
  inner: 108, // px — band edge toward the content
  top: 0.05, // fraction of screen height the band starts at
  bottom: 0.95,
  edgeFade: 14, // px — dots fade in and out over this distance from a side edge of the band
  endFade: 28, // px — dots fade in and out over this distance from the top and bottom of the band
  maxLife: 0.8, // how far through its life a dot is when it reaches the far side of its cell
  minScale: 0.3, // size of a dot at the end of its life
  activeAt: 40, // px/s of flow at which dots shrink along the stream at full strength
  activeTau: 0.3, // s — how quickly the shrinking along the stream comes and goes
  dirTau: 0.25, // s — smoothing of the stream direction, so reversals ease rather than flip
  homeAfter: 1.2, // s of steady ride before stray dots fade back to their home positions
};

interface Cell {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
interface Dot {
  x: number;
  y: number;
  /** Fade used when a resting dot returns home, 0…1. */
  shown: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ema = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
/** Wrap v into [lo, hi). */
const wrap = (v: number, lo: number, hi: number) => lo + ((((v - lo) % (hi - lo)) + (hi - lo)) % (hi - lo));

/**
 * Peripheral motion cues. Only the dots move — the interface underneath never does.
 * Renders nothing while MotionSense is inactive and never receives pointer events,
 * except for the demo's own controls.
 */
export function MotionSenseOverlay() {
  const { active, ms, input, intensity, demo, reducedMotion } = useMotionSense();
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[80] overflow-hidden" data-motionsense data-demo={demo}>
      {demo && <MotionSenseDemo />}
      <CueLayer input={input} intensity={intensity} adaptation={ms.adaptation} reduced={reducedMotion} />
    </div>
  );
}

/**
 * The dots stream with the felt motion: new dots appear on the upstream side and shrink
 * and fade as they travel downstream, then are replaced by new ones. When the ride is
 * steady they stop, grow back to full size and return to their home positions.
 */
function CueLayer({ input, intensity, adaptation, reduced }: { input: MotionInput; intensity: MotionIntensity; adaptation: MotionAdaptation; reduced: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let provider: MotionProvider = motionSimulator;
    let device: DeviceMotionProvider | null = null;
    if (input === 'device') {
      device = new DeviceMotionProvider((status) => motionRuntime.set({ device: status }));
      device.start();
      provider = device;
    }

    const layer = layerRef.current!;
    const els = dotRefs.current;
    const processor = new MotionProcessor();
    let last = performance.now();
    let prev = '';
    let raf = 0;
    let restS = 0; // seconds the dots have been still
    let dirX = 0; // smoothed stream direction, −1…1 per axis
    let dirY = 0;
    let act = 0; // 0 at rest … 1 while streaming: how strongly dots shrink along the stream

    // Geometry, rebuilt whenever the screen changes size.
    let cells: Cell[] = [];
    let bandY0 = 0;
    let bandY1 = 0;
    let dots: Dot[] = [];
    const homeOf = (h: Home) => ({ x: h.side === 'left' ? h.edge : layer.clientWidth - h.edge, y: h.y * layer.clientHeight });
    const layout = () => {
      const W = layer.clientWidth;
      const H = layer.clientHeight;
      bandY0 = H * FLOW.top;
      bandY1 = H * FLOW.bottom;
      // Sideways a dot wraps across the band; up and down it wraps over the full band height.
      cells = HOMES.map((h) =>
        h.side === 'left'
          ? { x0: FLOW.outer, x1: FLOW.inner, y0: bandY0, y1: bandY1 }
          : { x0: W - FLOW.inner, x1: W - FLOW.outer, y0: bandY0, y1: bandY1 },
      );
      dots = HOMES.map((h) => ({ ...homeOf(h), shown: 1 }));
      prev = '';
    };

    const frame = (now: number) => {
      const dt = clamp((now - last) / 1000, 0, 0.1);
      const sample = provider.sample(now);
      const cue = processor.step(sample, (now - last) / 1000);
      motionTelemetry.sample = sample;
      motionTelemetry.cue = cue;
      last = now;
      const { vx, vy, opacity, scale } = cueVisual(cue, intensity, adaptation);

      if (reduced) {
        // Reduced motion: dots stay home; the dots on the side the cue leans toward brighten instead.
        const key = `${cue.x.toFixed(2)}|${cue.y.toFixed(2)}|${opacity.toFixed(2)}|${scale.toFixed(2)}`;
        if (key !== prev) {
          prev = key;
          HOMES.forEach((h, i) => {
            const el = els[i];
            if (!el) return;
            const { x, y } = homeOf(h);
            const lean = Math.max(0, cue.x * h.px * 0.8 + cue.y * h.py);
            el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
            el.style.opacity = Math.min(1, opacity * (0.45 + 1.8 * lean)).toFixed(2);
          });
        }
        raf = requestAnimationFrame(frame);
        return;
      }

      // Paused demo: the dots hold exactly where they are.
      const held = provider === motionSimulator && motionSimulator.paused;
      const speed = Math.hypot(vx, vy);
      const moving = !held && speed > 2;
      let changed = false;

      if (!held) {
        const a = act;
        act += ema(dt, FLOW.activeTau) * ((moving ? Math.min(1, speed / FLOW.activeAt) : 0) - act);
        if (moving) {
          const k = ema(dt, FLOW.dirTau);
          dirX += k * (vx / speed - dirX);
          dirY += k * (vy / speed - dirY);
          dots.forEach((d, i) => {
            const c = cells[i];
            d.x = wrap(d.x + vx * dt, c.x0, c.x1);
            d.y = wrap(d.y + vy * dt, c.y0, c.y1);
          });
          changed = true;
        }
        if (Math.abs(act - a) > 1e-4) changed = true;
      }

      // Once the ride has stayed steady, dots pushed sideways out of their columns fade out
      // and reappear at home, so the resting layout stays tidy without any motion the body
      // doesn't feel. Dots moved only up or down stay put: their columns are still even.
      restS = moving ? 0 : held ? restS : restS + dt;
      if (!moving && !held) {
        dots.forEach((d, i) => {
          const home = homeOf(HOMES[i]);
          if (restS > FLOW.homeAfter && Math.abs(d.x - home.x) > 2) {
            d.shown = Math.max(0, d.shown - dt / 0.35);
            if (d.shown === 0) Object.assign(d, home);
            changed = true;
          } else if (d.shown < 1) {
            d.shown = Math.min(1, d.shown + dt / 0.4);
            changed = true;
          }
        });
      }

      // Write to the DOM only when something visible changed — no React renders per frame.
      const key = `${opacity.toFixed(2)}|${scale.toFixed(2)}`;
      if (changed || key !== prev) {
        prev = key;
        const wx = Math.abs(dirX);
        const wy = Math.abs(dirY);
        dots.forEach((d, i) => {
          const el = els[i];
          if (!el) return;
          const c = cells[i];
          // Progress across the band in the sideways stream: 0 where dots enter, 1 where they
          // leave. Only the sideways share of the motion shrinks dots; up and down never does.
          const lx = 0.5 + ((d.x - c.x0) / (c.x1 - c.x0) - 0.5) * dirX;
          const life = wx + wy > 0.01 ? ((wx * lx) / (wx + wy)) * FLOW.maxLife : 0;
          const shrink = act * life;
          // Invisible at the band's edges, so wrapping around never shows.
          const edge =
            clamp(Math.min(d.x - c.x0, c.x1 - d.x) / FLOW.edgeFade, 0, 1) *
            clamp(Math.min(d.y - c.y0, c.y1 - d.y) / FLOW.endFade, 0, 1);
          const s = scale * (1 - (1 - FLOW.minScale) * shrink);
          const o = opacity * d.shown * edge * (1 - Math.pow(shrink, 1.5));
          el.style.transform = `translate3d(${d.x.toFixed(1)}px, ${d.y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
          el.style.opacity = o.toFixed(3);
        });
      }
      raf = requestAnimationFrame(frame);
    };

    layout();
    els.forEach((el) => el && (el.style.opacity = '0'));
    const resize = new ResizeObserver(layout);
    resize.observe(layer);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      device?.stop();
      motionTelemetry.sample = null;
    };
  }, [input, intensity, adaptation, reduced]);

  return (
    <div ref={layerRef} className="absolute inset-0" aria-hidden>
      {HOMES.map((_, i) => (
        <span key={i} ref={(el) => void (dotRefs.current[i] = el)} className="ms-dot" />
      ))}
    </div>
  );
}
