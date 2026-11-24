import type { Place, RouteInfo, RoutePreference } from '../types';

/**
 * Local route simulation on the stylised map. Produces plausible-looking but
 * illustrative distances and timings — not real routing or traffic data.
 */
const KM_PER_UNIT = 0.045;
const SPEED_KMH: Record<RoutePreference, number> = { fastest: 30, shortest: 24, eco: 26 };

const VIA: Record<string, string> = {
  iitm: 'Sardar Patel Road',
  airport: 'GST Road',
  marina: 'Anna Salai',
  central: 'Anna Salai',
  'express-avenue': 'Anna Salai',
  'home-besant': 'Sardar Patel Road',
  'home-anna': 'Inner Ring Road',
  'work-tidel': 'Rajiv Gandhi Salai',
  'work-guindy-ie': 'Inner Ring Road',
  tnagar: 'Anna Salai',
  phoenix: 'Velachery Main Road',
  kapaleeshwarar: 'LB Road',
  sholinganallur: 'Rajiv Gandhi Salai (OMR)',
  'hyundai-plant': 'Poonamallee High Road',
};

const TOLL_IDS = new Set(['sholinganallur', 'hyundai-plant', 'fuel-shell']);

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

export function polylineLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

export function computeRoute(
  origin: Place,
  dest: Place,
  pref: RoutePreference,
  avoidTolls: boolean,
): RouteInfo {
  const dx = dest.x - origin.x;
  const dy = dest.y - origin.y;
  const points: Pt[] =
    pref === 'shortest'
      ? [origin, { x: origin.x + dx * 0.5, y: origin.y + dy * 0.62 }, dest]
      : [
          origin,
          { x: origin.x + dx * 0.08, y: origin.y + dy * 0.42 },
          { x: origin.x + dx * 0.62, y: origin.y + dy * 0.58 },
          { x: dest.x - dx * 0.06, y: dest.y - dy * 0.12 },
          dest,
        ];
  const tollOnRoute = TOLL_IDS.has(dest.id);
  const detour = tollOnRoute && avoidTolls ? 1.12 : 1;
  const distanceKm = Math.max(0.6, polylineLength(points) * KM_PER_UNIT * 1.15 * detour);
  const durationMin = (distanceKm / SPEED_KMH[pref]) * 60 + 2;
  const via = VIA[dest.id] ?? (Math.abs(dx) > Math.abs(dy) ? 'Sardar Patel Road' : 'GST Road');
  return {
    points,
    distanceKm,
    durationMin,
    via: tollOnRoute && avoidTolls ? `${via} · avoiding tolls` : via,
    toll: tollOnRoute && !avoidTolls,
  };
}

/** Position and heading of the vehicle marker at a given progress (0–1). */
export function pointAlong(points: Pt[], progress: number): Pt & { angle: number } {
  const total = polylineLength(points);
  let target = total * Math.min(1, Math.max(0, progress));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = dist(a, b);
    if (target <= seg || i === points.length - 1) {
      const f = seg ? Math.min(1, target / seg) : 0;
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90,
      };
    }
    target -= seg;
  }
  const last = points[points.length - 1];
  return { ...last, angle: 0 };
}

/** The part of the route already driven, ending at the vehicle position. */
export function travelledPoints(points: Pt[], progress: number): Pt[] {
  const total = polylineLength(points);
  let remaining = total * Math.min(1, Math.max(0, progress));
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i]);
    if (remaining <= seg) {
      const f = seg ? remaining / seg : 0;
      out.push({ x: points[i - 1].x + (points[i].x - points[i - 1].x) * f, y: points[i - 1].y + (points[i].y - points[i - 1].y) * f });
      return out;
    }
    out.push(points[i]);
    remaining -= seg;
  }
  return out;
}

const STREETS =['Kotturpuram Main Rd', 'Gandhi Mandapam Rd', 'Canal Bank Rd', '2nd Main Rd', 'Lattice Bridge Rd'];

/** Simulated next manoeuvre for the turn-by-turn banner. */
export function nextManoeuvre(route: RouteInfo, progress: number) {
  const pts = route.points;
  const total = polylineLength(pts);
  const travelled = total * progress;
  let acc = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    acc += dist(pts[i - 1], pts[i]);
    if (acc > travelled) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      return {
        turn: cross > 0 ? ('right' as const) : ('left' as const),
        street: i === 1 ? route.via.split(' · ')[0] : STREETS[(i + pts.length) % STREETS.length],
        distanceKm: (acc - travelled) * KM_PER_UNIT * 1.15,
      };
    }
  }
  return { turn: 'arrive' as const, street: '', distanceKm: (total - travelled) * KM_PER_UNIT * 1.15 };
}
