/**
 * Driver drowsiness analysis from per-frame face measurements.
 * Uses standard fatigue signals: PERCLOS (share of time the eyes are closed),
 * long eye closures (micro-sleeps), blink rate and yawning.
 */

export type DrowsinessLevel = 'alert' | 'tiring' | 'drowsy' | 'asleep' | 'noFace';

export interface DrowsinessMetrics {
  level: DrowsinessLevel;
  /** 0–100 combined alertness score. */
  alertness: number;
  /** 0–100, how open the eyes are right now. */
  eyeOpenness: number;
  /** How long the eyes have currently been closed. */
  closedMs: number;
  /** Share of the last 30 s the eyes were closed, 0–100. */
  perclos: number;
  blinksPerMin: number;
  /** Yawns in the last 3 minutes. */
  yawns: number;
  mouthOpen: number;
}

export interface FaceSample {
  t: number;
  face: boolean;
  /** 0–1 eye-closure score (average of both eyes). */
  eyeClosed: number;
  /** 0–1 jaw-open score. */
  jawOpen: number;
}

/** Eyes closed at least this long count as a micro-sleep. */
export const MICROSLEEP_MS = 1500;
export const DROWSY_BELOW = 40;
const PERCLOS_WINDOW_MS = 30_000;
const BLINK_WINDOW_MS = 60_000;
const YAWN_WINDOW_MS = 180_000;
const YAWN_MIN_MS = 1200;
const NO_FACE_MS = 2000;

export const INITIAL_METRICS: DrowsinessMetrics = {
  level: 'alert', alertness: 100, eyeOpenness: 100, closedMs: 0, perclos: 0, blinksPerMin: 0, yawns: 0, mouthOpen: 0,
};

export class DrowsinessTracker {
  private samples: { t: number; closed: boolean }[] = [];
  private blinks: number[] = [];
  private yawnTimes: number[] = [];
  private closedSince: number | null = null;
  private jawSince: number | null = null;
  private yawnCounted = false;
  private lastFace: number | null = null;
  /** Running open-eye baseline, so people whose eyes look "half closed" to the model are not flagged. */
  private baseline = 0.15;

  update(s: FaceSample): DrowsinessMetrics {
    const { t } = s;
    if (!s.face) {
      this.closedSince = null;
      this.jawSince = null;
      this.lastFace ??= t; // never seen a face: count from the first frame
      const lost = t - this.lastFace;
      const m = this.metrics(t, 0, 0, 0);
      return lost > NO_FACE_MS ? { ...m, level: 'noFace' } : m;
    }
    this.lastFace = t;

    // Eye closure, relative to this driver's own open-eye baseline.
    if (s.eyeClosed < 0.5) this.baseline += (s.eyeClosed - this.baseline) * 0.02;
    const closed = s.eyeClosed > Math.max(0.5, this.baseline + 0.3);
    if (closed) this.closedSince ??= t;
    else if (this.closedSince !== null) {
      if (t - this.closedSince < 500) this.blinks.push(t); // a normal blink is short
      this.closedSince = null;
    }
    this.samples.push({ t, closed });

    // Yawns: mouth wide open for over a second.
    if (s.jawOpen > 0.55) {
      this.jawSince ??= t;
      if (!this.yawnCounted && t - this.jawSince > YAWN_MIN_MS) {
        this.yawnTimes.push(t);
        this.yawnCounted = true;
      }
    } else {
      this.jawSince = null;
      this.yawnCounted = false;
    }

    const closedMs = this.closedSince === null ? 0 : t - this.closedSince;
    return this.metrics(t, closedMs, 1 - s.eyeClosed, s.jawOpen);
  }

  private metrics(t: number, closedMs: number, openness: number, jawOpen: number): DrowsinessMetrics {
    this.samples = this.samples.filter((x) => t - x.t <= PERCLOS_WINDOW_MS);
    this.blinks = this.blinks.filter((x) => t - x <= BLINK_WINDOW_MS);
    this.yawnTimes = this.yawnTimes.filter((x) => t - x <= YAWN_WINDOW_MS);

    const perclos = this.samples.length ? this.samples.filter((x) => x.closed).length / this.samples.length : 0;
    const yawns = this.yawnTimes.length;
    const blinksPerMin = this.blinks.length;
    let alertness = 100 - Math.min(60, perclos * 300) - Math.min(30, yawns * 12) - (blinksPerMin > 30 ? 10 : 0);
    if (closedMs >= MICROSLEEP_MS) alertness = 0;
    alertness = Math.max(0, Math.round(alertness));

    const level: DrowsinessLevel =
      closedMs >= MICROSLEEP_MS ? 'asleep' : alertness < DROWSY_BELOW ? 'drowsy' : alertness < 70 ? 'tiring' : 'alert';
    return {
      level,
      alertness,
      eyeOpenness: Math.round(Math.max(0, Math.min(1, openness)) * 100),
      closedMs,
      perclos: Math.round(perclos * 100),
      blinksPerMin,
      yawns,
      mouthOpen: Math.round(jawOpen * 100),
    };
  }
}
