import type { Detection } from '@mediapipe/tasks-vision';

/**
 * Safe exit analysis for a rear/side camera feed, shown mirrored like a door
 * mirror: things on the left of the picture are on the car's left side.
 * Distance comes from each object's apparent height (pinhole camera model);
 * closing speed from how that distance changes over time.
 */

export type Side = 'left' | 'right';
export type Risk = 'clear' | 'caution' | 'danger';

export interface SideStatus {
  risk: Risk;
  label: string | null;
  distanceM: number | null;
  /** Positive when the object is coming closer. */
  closingMps: number;
  /** Seconds until it reaches the car, when approaching. */
  ttcS: number | null;
}

export interface Box {
  /** Normalised to the mirrored display, 0–1. */
  x: number; y: number; w: number; h: number;
  label: string;
  distanceM: number;
  side: Side;
}

/** Typical real-world heights in metres. */
const HEIGHT_M: Record<string, number> = { person: 1.7, bicycle: 1.1, motorcycle: 1.2, car: 1.5, bus: 3.0, truck: 3.0 };
const NAMES: Record<string, string> = { person: 'Pedestrian', bicycle: 'Cyclist', motorcycle: 'Motorbike', car: 'Car', bus: 'Bus', truck: 'Truck' };
/** 2·tan(vertical FOV / 2) for a typical ~60° webcam. */
const FOV_FACTOR = 1.155;
export const DANGER_M = 3;
export const TTC_DANGER_S = 3;
const CAUTION_M = 10;

export const CLEAR: SideStatus = { risk: 'clear', label: null, distanceM: null, closingMps: 0, ttcS: null };

export class SafeExitTracker {
  private tracks: Record<Side, { d: number; t: number; v: number } | null> = { left: null, right: null };

  update(detections: Detection[], width: number, height: number, t: number): { sides: Record<Side, SideStatus>; boxes: Box[] } {
    const boxes: Box[] = [];
    for (const det of detections) {
      const bb = det.boundingBox;
      const cat = det.categories[0]?.categoryName;
      if (!bb || !cat || !(cat in HEIGHT_M)) continue;
      const w = bb.width / width;
      const h = bb.height / height;
      const x = 1 - (bb.originX / width + w); // mirror horizontally
      const y = bb.originY / height;
      const distanceM = HEIGHT_M[cat] / (Math.max(h, 0.02) * FOV_FACTOR);
      boxes.push({ x, y, w, h, label: NAMES[cat], distanceM, side: x + w / 2 < 0.5 ? 'left' : 'right' });
    }

    const sides = { left: CLEAR, right: CLEAR } as Record<Side, SideStatus>;
    for (const side of ['left', 'right'] as Side[]) {
      const nearest = boxes.filter((b) => b.side === side).sort((a, b) => a.distanceM - b.distanceM)[0];
      const prev = this.tracks[side];
      if (!nearest) {
        if (prev && t - prev.t > 1000) this.tracks[side] = null;
        continue;
      }
      // Smooth distance and closing speed to ride out per-frame box jitter.
      let d = nearest.distanceM;
      let v = 0;
      if (prev && t - prev.t < 1000) {
        d = prev.d + (d - prev.d) * 0.4;
        const dt = (t - prev.t) / 1000;
        v = dt > 0 ? prev.v + (((prev.d - d) / dt) - prev.v) * 0.3 : prev.v;
      }
      this.tracks[side] = { d, t, v };
      const ttcS = v > 0.3 ? d / v : null;
      const risk: Risk = d < DANGER_M || (ttcS !== null && ttcS < TTC_DANGER_S) ? 'danger' : d < CAUTION_M || v > 0.3 ? 'caution' : 'clear';
      sides[side] = { risk, label: nearest.label, distanceM: d, closingMps: v, ttcS };
    }
    return { sides, boxes };
  }
}
