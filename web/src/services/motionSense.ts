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

const GAIN: Record<MotionIntensity, number> = { low: 0.5, medium: 0.75, high: 1 };
const OPACITY: Record<MotionIntensity, number> = { low: 0.6, medium: 0.8, high: 0.95 };
/** Dot flow speed at full cue and High intensity, in logical screen pixels per second (720 px tall canvas). */
export const MAX_FLOW_PX_S = 170;

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/**
 * Manual: dots always shown at full size with a fixed gain. Automatic (adaptive): like
 * iPhone Vehicle Motion Cues, dots shrink back while the ride is steady and grow in
 * with the filtered motion magnitude, so they only claim attention when needed.
 * `vx`/`vy` is the velocity the dots stream at, in px/s: new dots appear on the
 * upstream side and shrink and fade as they travel downstream.
 */
export function cueVisual(cue: MotionCue, intensity: MotionIntensity, adaptation: MotionAdaptation) {
  const adaptive = adaptation === 'adaptive';
  const presence = adaptive ? smoothstep(clamp(cue.level / 0.35, 0, 1)) : 1;
  const gain = GAIN[intensity] * (adaptive ? 0.6 + 0.4 * presence : 1);
  return {
    vx: cue.x * gain * MAX_FLOW_PX_S,
    vy: cue.y * gain * MAX_FLOW_PX_S,
    opacity: OPACITY[intensity] * (adaptive ? 0.4 + 0.6 * presence : 1),
    scale: adaptive ? 0.55 + 0.45 * presence : 1,
  };
}

/** Latest pipeline values from the running overlay, for the on-screen live readout. Read by polling. */
export const motionTelemetry: { sample: MotionSample | null; cue: MotionCue } = { sample: null, cue: { x: 0, y: 0, level: 0 } };

/* ---------- Simulation input ---------- */

export type Manoeuvre = 'accelerate' | 'brake' | 'left' | 'right' | 'bump' | 'steady';

/** Verna-class sedan. Representative values, not measurements. */
const CAR = {
  mass: 1250, // kg
  power: 60_000, // W delivered at the wheels
  maxAccel: 3.2, // m/s² — traction / first-gear limit
  brakeDecel: 6.5, // m/s² — firm sudden stop, about 0.66 g
  maxLat: 3.6, // m/s² — brisk but comfortable cornering
  minRadius: 6, // m — tightest turn; limits sideways force at low speed
  wheelbase: 2.67, // m
  minSpeed: 15 / 3.6, // m/s — simulated braking slows the car but never parks it
  maxSpeed: 110 / 3.6,
  jerk: { throttle: 6, brake: 20, release: 10, lat: 5 }, // m/s³ — how fast forces build and fade
  pitchPerAccel: 0.006, // rad per m/s² — nose dive and squat
  rollPerAccel: 0.009, // rad per m/s² — body roll in turns
};

/** How long each manoeuvre commands the car, in seconds. */
const MANOEUVRE_S: Record<Exclude<Manoeuvre, 'steady'>, number> = { accelerate: 3, brake: 1.6, left: 2.6, right: 2.6, bump: 1.4 };

const G = 9.81;
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.73;
const approach = (value: number, target: number, maxStep: number) => value + clamp(target - value, -maxStep, maxStep);

/** Ornstein–Uhlenbeck process: band-limited road noise whose amplitude does not depend on frame rate. */
class RoadNoise {
  private v = 0;
  constructor(private tau: number) {}
  step(dt: number, sd: number) {
    this.v += (-this.v * dt) / this.tau + sd * Math.sqrt((2 * dt) / this.tau) * gauss();
    return this.v;
  }
}

/** Under-damped suspension mode (pitch or roll): follows its target with a realistic overshoot. */
class Spring {
  private x = 0;
  private v = 0;
  constructor(private hz: number, private zeta: number) {}
  step(target: number, dt: number) {
    const w = 2 * Math.PI * this.hz;
    this.v += (w * w * (target - this.x) - 2 * this.zeta * w * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export interface SimulatedVehicle {
  speedKmh: number;
  /** Front-wheel steering angle in degrees; + right. */
  steerDeg: number;
  braking: boolean;
  throttle: boolean;
}

/**
 * Synthetic vehicle with simple longitudinal, lateral, suspension and road models.
 * It produces raw IMU-style samples that go through the same processor as sensor
 * input — it never drives the overlay directly.
 */
class MotionSimulator implements MotionProvider {
  private speed = 40 / 3.6;
  private lon = 0;
  private lat = 0;
  private active: { kind: Exclude<Manoeuvre, 'steady'>; t: number } | null = null;
  private bump: { t: number; delay: number } | null = null;
  private last = 0;
  private held: MotionSample = { lat: 0, lon: 0, vert: 0 };
  private pitch = new Spring(1.3, 0.4);
  private roll = new Spring(1.1, 0.45);
  private noise = { lat: new RoadNoise(0.3), lon: new RoadNoise(0.3), vert: new RoadNoise(0.05) };
  /** Freezes the car and holds the last reading, so the dots stay where they are. */
  paused = false;

  trigger(kind: Manoeuvre) {
    this.active = kind === 'steady' ? null : { kind, t: 0 };
    if (kind === 'bump') this.bump = { t: 0, delay: CAR.wheelbase / Math.max(this.speed, 3) };
  }

  /** Steady cruising at the given speed, all forces settled. */
  reset(speedKmh = 40) {
    this.speed = speedKmh / 3.6;
    this.lon = this.lat = 0;
    this.active = this.bump = null;
    this.pitch = new Spring(1.3, 0.4);
    this.roll = new Spring(1.1, 0.45);
  }

  get state(): SimulatedVehicle {
    const curvature = this.lat / Math.max(this.speed * this.speed, 1);
    return {
      speedKmh: this.speed * 3.6,
      steerDeg: (Math.atan(CAR.wheelbase * curvature) * 180) / Math.PI,
      braking: this.lon < -0.5,
      throttle: this.active?.kind === 'accelerate' && this.lon > 0.3,
    };
  }

  sample(nowMs: number): MotionSample {
    const dt = this.last ? clamp((nowMs - this.last) / 1000, 0, 0.05) : 0;
    this.last = nowMs;
    if (this.paused || dt === 0) return this.held;

    // Driver commands for the active manoeuvre.
    if (this.active && (this.active.t += dt) > MANOEUVRE_S[this.active.kind]) this.active = null;
    const kind = this.active?.kind;
    let lonCmd = 0;
    let latCmd = 0;
    if (kind === 'accelerate' && this.speed < CAR.maxSpeed) lonCmd = Math.min(CAR.maxAccel, CAR.power / (CAR.mass * Math.max(this.speed, 1)));
    if (kind === 'brake' && this.speed > CAR.minSpeed) lonCmd = -CAR.brakeDecel;
    if (kind === 'left' || kind === 'right') latCmd = (kind === 'left' ? -1 : 1) * Math.min(CAR.maxLat, (this.speed * this.speed) / CAR.minRadius);

    // Forces build and fade at a limited rate (jerk), as in a real car.
    const lonRate = lonCmd < 0 && lonCmd < this.lon ? CAR.jerk.brake : lonCmd > 0 && lonCmd > this.lon ? CAR.jerk.throttle : CAR.jerk.release;
    this.lon = approach(this.lon, lonCmd, lonRate * dt);
    this.lat = approach(this.lat, latCmd, CAR.jerk.lat * dt);
    this.speed = clamp(this.speed + this.lon * dt, 0, CAR.maxSpeed);

    // A body-mounted IMU tilts with pitch and roll and picks up part of gravity,
    // which is why a real car "rocks back" right after a hard stop.
    const pitch = this.pitch.step(CAR.pitchPerAccel * this.lon, dt);
    const roll = this.roll.step(CAR.rollPerAccel * this.lat, dt);
    const roughness = 0.25 + 0.75 * Math.min(1, this.speed / 25);

    let vert = this.noise.vert.step(dt, 0.2 * roughness);
    if (this.bump) {
      const b = this.bump;
      b.t += dt;
      // Body heave around 1.4 Hz, the frequency passengers actually feel; front axle, then a softer rear-axle hit.
      const hit = (t: number, amp: number) => (t > 0 ? amp * Math.exp(-t / 0.35) * Math.sin(2 * Math.PI * 1.4 * t) : 0);
      vert += hit(b.t, 5.5) + hit(b.t - b.delay, 1.8);
      if (b.t > b.delay + 1.8) this.bump = null;
    }

    this.held = {
      lat: this.lat + G * Math.sin(roll) + this.noise.lat.step(dt, 0.07 * roughness),
      lon: this.lon + G * Math.sin(pitch) + this.noise.lon.step(dt, 0.07 * roughness),
      vert,
    };
    return this.held;
  }
}

export const motionSimulator = new MotionSimulator();

/* ---------- Transient runtime state (not persisted) ---------- */

export type DeviceMotionStatus = 'idle' | 'requesting' | 'active' | 'no-data' | 'denied' | 'unsupported' | 'insecure';

export interface MotionRuntime {
  /** Settings preview: simulated motion only, device sensors stay off. */
  preview: boolean;
  /** Guided presentation demo: scripted manoeuvres, blurred interface, highlighted dots. */
  demo: boolean;
  device: DeviceMotionStatus;
}

let runtime: MotionRuntime = { preview: false, demo: false, device: 'idle' };
const listeners = new Set<() => void>();

export const motionRuntime = {
  get: () => runtime,
  set(patch: Partial<MotionRuntime>) {
    const next = { ...runtime, ...patch };
    if ((Object.keys(next) as (keyof MotionRuntime)[]).every((k) => next[k] === runtime[k])) return;
    runtime = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

/** Start the guided MotionSense demo; works from anywhere in the interface. */
export function startMotionDemo() {
  motionSimulator.reset(40);
  motionSimulator.paused = false;
  motionRuntime.set({ demo: true });
}

export function stopMotionDemo() {
  motionSimulator.trigger('steady');
  motionSimulator.paused = false;
  motionRuntime.set({ demo: false });
}
