import type { MotionAdaptation, MotionIntensity } from '../types';

/**
 * MYRA MotionSense — motion processing pipeline.
 *
 * Every motion input (simulator, this device's sensors, or a future vehicle IMU)
 * produces vehicle-frame samples; one processor turns them into a normalised cue
 * that the overlay renders. Nothing here touches React or the DOM.
 */

/** Linear acceleration in the vehicle frame, m/s², gravity removed. lat: + right · lon: + forward · vert: + up. */
export interface MotionSample {
  lat: number;
  lon: number;
  vert: number;
}

/** Normalised cue: x + right, y + down on screen (each −1…1); level = filtered motion magnitude 0…1. */
export interface MotionCue {
  x: number;
  y: number;
  level: number;
}

/** Anything that can report the current vehicle motion. `null` means "no reading". */
export interface MotionProvider {
  sample(nowMs: number): MotionSample | null;
}

/**
 * Motion → screen mapping. Initial design values; calibrate during testing.
 * Forward acceleration pushes cues toward the rear (down), braking toward the front (up),
 * a left turn pushes them right, a right turn left, and an upward bump gives a small dip.
 */
export const MOTION_MAPPING = {
  lateral: -1,
  longitudinal: 1,
  vertical: 0.6,
};

const TUNING = {
  inputTau: 0.12, // s — low-pass on raw input (noise)
  baselineTau: 6, // s — slow bias/offset removal, learned only while calm
  deadZone: 0.3, // m/s² — ignore small vibration
  fullScale: { lat: 4, lon: 4, vert: 3 } as MotionSample, // m/s² that maps to full cue travel
  outputTau: 0.16, // s — final cue smoothing
};

const AXES = ['lat', 'lon', 'vert'] as const;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Exponential-moving-average coefficient for a time constant, independent of frame rate. */
const ema = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

export class MotionProcessor {
  private filtered: MotionSample = { lat: 0, lon: 0, vert: 0 };
  private baseline: MotionSample = { lat: 0, lon: 0, vert: 0 };
  private out: MotionCue = { x: 0, y: 0, level: 0 };

  /** Advance the pipeline by `dt` seconds with the latest sample and return the smoothed cue. */
  step(sample: MotionSample | null, dt: number): MotionCue {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    if (dt === 0) return this.out;
    const n: MotionSample = { lat: 0, lon: 0, vert: 0 };
    for (const k of AXES) {
      const raw = sample && Number.isFinite(sample[k]) ? sample[k] : 0;
      this.filtered[k] += ema(dt, TUNING.inputTau) * (raw - this.filtered[k]);
      const dev = this.filtered[k] - this.baseline[k];
      if (Math.abs(dev) < TUNING.deadZone * 2) this.baseline[k] += ema(dt, TUNING.baselineTau) * dev;
      const live = Math.sign(dev) * Math.max(0, Math.abs(dev) - TUNING.deadZone);
      n[k] = clamp(live / TUNING.fullScale[k], -1, 1);
    }
    const target: MotionCue = {
      x: clamp(MOTION_MAPPING.lateral * n.lat, -1, 1),
      y: clamp(MOTION_MAPPING.longitudinal * n.lon + MOTION_MAPPING.vertical * n.vert, -1, 1),
      level: clamp(Math.hypot(n.lat, n.lon, n.vert * 0.6), 0, 1),
    };
    const a = ema(dt, TUNING.outputTau);
    this.out = {
      x: this.out.x + a * (target.x - this.out.x),
      y: this.out.y + a * (target.y - this.out.y),
      level: this.out.level + a * (target.level - this.out.level),
    };
    return this.out;
  }
}

/* ---------- Cue → visual ---------- */

const GAIN: Record<MotionIntensity, number> = { low: 0.45, medium: 0.7, high: 1 };
const OPACITY: Record<MotionIntensity, number> = { low: 0.22, medium: 0.32, high: 0.42 };
/** Maximum cue travel at High intensity, in screen pixels. Restrained on purpose. */
export const MAX_TRAVEL_PX = 24;

/**
 * Manual: fixed gain and visibility. Adaptive: small motion is de-emphasised and
 * cues fade back when the ride is steady, growing with the filtered motion magnitude.
 */
export function cueVisual(cue: MotionCue, intensity: MotionIntensity, adaptation: MotionAdaptation) {
  const adaptive = adaptation === 'adaptive';
  const gain = GAIN[intensity] * (adaptive ? 0.4 + 0.6 * cue.level : 1);
  const opacity = OPACITY[intensity] * (adaptive ? 0.5 + 0.5 * cue.level : 1);
  return { dx: cue.x * gain * MAX_TRAVEL_PX, dy: cue.y * gain * MAX_TRAVEL_PX, opacity };
}

/** Latest pipeline values from the running overlay, for the on-screen live readout. Read by polling. */
export const motionTelemetry: { sample: MotionSample | null; cue: MotionCue } = { sample: null, cue: { x: 0, y: 0, level: 0 } };

/* ---------- Simulation input ---------- */

export type Manoeuvre = 'accelerate' | 'brake' | 'left' | 'right' | 'bump' | 'steady';

/** Smooth rise → hold → fall envelope, 0…1. */
function envelope(t: number, rise: number, hold: number, fall: number) {
  const s = (x: number) => x * x * (3 - 2 * x);
  if (t < rise) return s(t / rise);
  if (t < rise + hold) return 1;
  return t < rise + hold + fall ? 1 - s((t - rise - hold) / fall) : 0;
}

const PROFILES: Record<Exclude<Manoeuvre, 'steady'>, { duration: number; at: (t: number) => Partial<MotionSample> }> = {
  accelerate: { duration: 2.6, at: (t) => ({ lon: 2.6 * envelope(t, 0.5, 1.4, 0.7) }) },
  brake: { duration: 2.2, at: (t) => ({ lon: -3.4 * envelope(t, 0.3, 1.2, 0.7) }) },
  left: { duration: 3, at: (t) => ({ lat: -3 * envelope(t, 0.6, 1.6, 0.8) }) },
  right: { duration: 3, at: (t) => ({ lat: 3 * envelope(t, 0.6, 1.6, 0.8) }) },
  bump: { duration: 1.2, at: (t) => ({ vert: 4.5 * Math.exp(-t / 0.25) * Math.sin(2 * Math.PI * 2.5 * t) }) },
};

/** Light road vibration so the dead zone is exercised like real input. */
const noise = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.15;

/**
 * Synthetic vehicle motion. Produces raw samples that go through the same
 * processor as sensor input — it never drives the overlay directly.
 */
class MotionSimulator implements MotionProvider {
  private active: { kind: Exclude<Manoeuvre, 'steady'>; start: number } | null = null;

  trigger(kind: Manoeuvre) {
    this.active = kind === 'steady' ? null : { kind, start: performance.now() };
  }

  sample(nowMs: number): MotionSample {
    const s: MotionSample = { lat: noise(), lon: noise(), vert: noise() };
    if (this.active) {
      const t = (nowMs - this.active.start) / 1000;
      const p = PROFILES[this.active.kind];
      if (t > p.duration) this.active = null;
      else {
        const m = p.at(Math.max(0, t));
        s.lat += m.lat ?? 0;
        s.lon += m.lon ?? 0;
        s.vert += m.vert ?? 0;
      }
    }
    return s;
  }
}

export const motionSimulator = new MotionSimulator();

/* ---------- Transient runtime state (not persisted) ---------- */

export type DeviceMotionStatus = 'idle' | 'requesting' | 'active' | 'no-data' | 'denied' | 'unsupported' | 'insecure';

export interface MotionRuntime {
  /** Settings preview: simulated motion only, device sensors stay off. */
  preview: boolean;
  device: DeviceMotionStatus;
}

let runtime: MotionRuntime = { preview: false, device: 'idle' };
const listeners = new Set<() => void>();

export const motionRuntime = {
  get: () => runtime,
  set(patch: Partial<MotionRuntime>) {
    const next = { ...runtime, ...patch };
    if (next.preview === runtime.preview && next.device === runtime.device) return;
    runtime = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
