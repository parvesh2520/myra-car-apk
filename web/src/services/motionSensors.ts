import type { DeviceMotionStatus, MotionProvider, MotionSample } from './motionSense';

/**
 * Device motion input for MotionSense testing. This reads the accelerometer and
 * gyroscope of the device running MYRA (tablet/phone) — not the car's IMU.
 */

type Vec = [number, number, number];
type PermissionRequest = () => Promise<'granted' | 'denied'>;

const NO_DATA_TIMEOUT_MS = 2000;
const STALE_MS = 500;
/** Rotation faster than this (°/s) means the device is being handled, not the vehicle moving. */
const HANDLING_DEG_S = 180;

export function deviceMotionAvailability(): 'ok' | 'unsupported' | 'insecure' {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return 'unsupported';
  return window.isSecureContext ? 'ok' : 'insecure';
}

/** Must be called from a user gesture. Browsers without a permission model (Android, desktop) resolve true. */
export async function requestDeviceMotionPermission(): Promise<boolean> {
  const request = (window.DeviceMotionEvent as unknown as { requestPermission?: PermissionRequest }).requestPermission;
  if (typeof request !== 'function') return true;
  try {
    return (await request()) === 'granted';
  } catch {
    return false;
  }
}

const vec = (v: DeviceMotionEventAcceleration | null): Vec | null =>
  v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? [v.x!, v.y!, v.z!] : null;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec): Vec | null => {
  const m = Math.hypot(...a);
  return m > 1e-3 ? scale(a, 1 / m) : null;
};

/**
 * Convert device-frame linear acceleration into the vehicle frame, using the
 * measured gravity direction (so upright and flat mounting both work) and the
 * current screen rotation. Assumes the screen faces the occupant, i.e. rearward.
 */
function toVehicleFrame(a: Vec, gravity: Vec, screenAngleDeg: number): MotionSample | null {
  const th = (screenAngleDeg * Math.PI) / 180;
  const screenRight: Vec = [Math.cos(th), -Math.sin(th), 0];
  const screenUp: Vec = [Math.sin(th), Math.cos(th), 1];
  // A viewed screen is upright or tilted back, so "up" has a positive screen-up/out component.
  // Some platforms report the opposite sign convention — detect it and flip.
  if (dot(gravity, screenUp) < 0) {
    a = scale(a, -1);
    gravity = scale(gravity, -1);
  }
  const up = norm(gravity);
  if (!up) return null;
  const right = norm(sub(screenRight, scale(up, dot(screenRight, up))));
  if (!right) return null;
  const forward = cross(up, right);
  return { lat: dot(a, right), lon: dot(a, forward), vert: dot(a, up) };
}

export class DeviceMotionProvider implements MotionProvider {
  private gravity: Vec | null = null;
  private latest: MotionSample | null = null;
  private lastEvent = 0;
  private holdUntil = 0;
  private gotData = false;
  private timer = 0;

  constructor(private onStatus: (s: DeviceMotionStatus) => void) {}

  start() {
    window.addEventListener('devicemotion', this.onMotion);
    this.timer = window.setTimeout(() => !this.gotData && this.onStatus('no-data'), NO_DATA_TIMEOUT_MS);
  }

  stop() {
    window.removeEventListener('devicemotion', this.onMotion);
    window.clearTimeout(this.timer);
  }

  sample(nowMs: number) {
    return nowMs - this.lastEvent > STALE_MS ? null : this.latest;
  }

  private onMotion = (e: DeviceMotionEvent) => {
    const withGravity = vec(e.accelerationIncludingGravity);
    const linearRaw = vec(e.acceleration);
    if (!withGravity && !linearRaw) return; // API present but no sensor behind it
    if (!this.gotData) {
      this.gotData = true;
      this.onStatus('active');
    }
    const now = performance.now();
    const dt = this.lastEvent ? Math.min(0.1, (now - this.lastEvent) / 1000) : 0.016;
    this.lastEvent = now;

    // Slow low-pass of the raw signal isolates gravity (orientation) from motion.
    if (withGravity) {
      const k = 1 - Math.exp(-dt / 0.8);
      this.gravity = this.gravity ? this.gravity.map((g, i) => g + k * (withGravity[i] - g)) as Vec : withGravity;
    }
    const gravity = this.gravity ?? ([0, 9.81, 0] as Vec); // no gravity data: assume an upright screen
    const linear = linearRaw ?? (withGravity ? sub(withGravity, gravity) : null);
    if (!linear) return;

    const r = e.rotationRate;
    const rotation = r ? Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0) : 0;
    if (rotation > HANDLING_DEG_S) this.holdUntil = now + 400;
    this.latest = now < this.holdUntil ? { lat: 0, lon: 0, vert: 0 } : toVehicleFrame(linear, gravity, screen.orientation?.angle ?? 0);
  };
}
