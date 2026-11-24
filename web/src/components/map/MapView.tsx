import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppState } from '../../context/AppStore';
import { useRoute } from '../../hooks/useRoute';
import { MAP_ROADS, PLACES } from '../../data/places';
import { pointAlong, travelledPoints } from '../../services/routing';
import type { Place, PlaceCategory } from '../../types';

interface MapViewProps {
  /** Manual zoom (1 = framed view). */
  zoom?: number;
  showCategory?: PlaceCategory | null;
  onSelectPlace?: (id: string) => void;
  /** Screen pixels covered by overlaid panels, so the route is framed in the visible area. */
  insetLeft?: number;
  insetTop?: number;
  dense?: boolean;
}

const AREA_LABELS: [string, number, number][] = [
  ['ANNA NAGAR', 430, 70],
  ['T. NAGAR', 600, 214],
  ['MYLAPORE', 760, 224],
  ['GUINDY', 500, 312],
  ['ADYAR', 740, 330],
  ['VELACHERY', 600, 520],
  ['TARAMANI', 700, 476],
  ['MEENAMBAKKAM', 330, 486],
  ['PORUR', 260, 300],
  ['SRIPERUMBUDUR', 70, 262],
];

/** Never zoom in further than this many map units per screen pixel. */
const MIN_UNITS_PER_PX = 0.5;

const toD = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

/**
 * Stylised local map of Chennai — not a tile service or a GPS position.
 * Strokes, labels and markers keep a constant on-screen size at every zoom level.
 */
export const MapView = memo(function MapView({ zoom = 1, showCategory = null, onSelectPlace, insetLeft = 0, insetTop = 0, dense = true }: MapViewProps) {
  const { nav, driveMode } = useAppState();
  const { origin, destination, route } = useRoute();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const car = route ? pointAlong(route.points, nav.progress) : { x: origin.x, y: origin.y, angle: 0 };

  const { viewBox, s } = useMemo(() => {
    const pad = 80;
    const box = route
      ? {
          x0: Math.min(...route.points.map((p) => p.x)) - pad,
          x1: Math.max(...route.points.map((p) => p.x)) + pad,
          y0: Math.min(...route.points.map((p) => p.y)) - pad,
          y1: Math.max(...route.points.map((p) => p.y)) + pad,
        }
      : { x0: origin.x - 340, x1: origin.x + 340, y0: origin.y - 250, y1: origin.y + 250 };
    const regionW = Math.max(240, size.w - insetLeft);
    const regionH = Math.max(160, size.h - insetTop);
    let unitsPerPx = Math.max((box.x1 - box.x0) / regionW, (box.y1 - box.y0) / regionH, MIN_UNITS_PER_PX);
    unitsPerPx /= zoom;
    const followCar = zoom > 1 && (driveMode === 'driving' || !route);
    const cx = followCar ? car.x : (box.x0 + box.x1) / 2;
    const cy = followCar ? car.y : (box.y0 + box.y1) / 2;
    const x0 = cx - (insetLeft + regionW / 2) * unitsPerPx;
    const y0 = cy - (insetTop + regionH / 2) * unitsPerPx;
    return { viewBox: `${x0} ${y0} ${size.w * unitsPerPx} ${size.h * unitsPerPx}`, s: unitsPerPx };
  }, [route, origin.x, origin.y, size, insetLeft, insetTop, zoom, driveMode, car.x, car.y]);

  const routeD = route ? toD(route.points) : '';
  const doneD = route && nav.progress > 0 ? toD(travelledPoints(route.points, nav.progress)) : '';
  const pois = showCategory ? PLACES.filter((p) => p.category === showCategory) : [];
  const nss = { vectorEffect: 'non-scaling-stroke' } as const;

  return (
    <div ref={ref} className="w-full h-full">
      <svg
        viewBox={viewBox}
        className="block w-full h-full bg-map-land"
        role="img"
        aria-label={destination ? `Map showing simulated route to ${destination.name}` : 'Stylised demo map of Chennai'}
      >
        <defs>
          <clipPath id="land-clip">
            <path d="M-900 -700 H872 C 858 120 876 260 860 380 C 850 470 884 540 900 1300 H-900 Z" />
          </clipPath>
          <pattern id="grid-minor" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(-9)">
            <path d="M34 0H0V34" fill="none" stroke="var(--color-map-road)" strokeWidth="1.4" />
          </pattern>
          <pattern id="blocks" width="68" height="68" patternUnits="userSpaceOnUse" patternTransform="rotate(-9)">
            <rect x="6" y="6" width="22" height="22" rx="3" fill="var(--color-map-block)" />
            <rect x="40" y="38" width="22" height="22" rx="3" fill="var(--color-map-block)" />
          </pattern>
          <filter id="route-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={6 * s} />
          </filter>
        </defs>

        <rect x="-900" y="-700" width="3000" height="2000" fill="var(--color-map-land)" />
        {dense && <rect x="-900" y="-700" width="3000" height="2000" fill="url(#blocks)" clipPath="url(#land-clip)" />}
        <rect x="-900" y="-700" width="3000" height="2000" fill="url(#grid-minor)" clipPath="url(#land-clip)" opacity={dense ? 1 : 0.6} />

        <ellipse cx="556" cy="356" rx="44" ry="26" fill="var(--color-map-park)" />
        <ellipse cx="636" cy="404" rx="30" ry="18" fill="var(--color-map-park)" />
        <ellipse cx="772" cy="380" rx="16" ry="10" fill="var(--color-map-park)" />

        <path d="M872 -700 C 858 120 876 260 860 380 C 850 470 884 540 900 1300 H2100 V-700 Z" fill="var(--color-map-water)" />
        <path d="M180 474 C 330 440 420 412 520 398 S 700 350 770 364 S 840 372 880 368" fill="none" stroke="var(--color-map-water)" strokeWidth="7" strokeLinecap="round" style={nss} />
        <path d="M60 214 C 240 184 420 152 560 134 S 760 112 880 104" fill="none" stroke="var(--color-map-water)" strokeWidth="5" strokeLinecap="round" style={nss} />
        <path d="M802 -40 C 798 160 806 380 812 640" fill="none" stroke="var(--color-map-water)" strokeWidth="2.5" style={nss} />

        {MAP_ROADS.map((r) => (
          <path key={`${r.id}-casing`} d={r.d} fill="none" stroke="var(--color-map-land)" strokeWidth={r.major ? 10 : 7} strokeLinecap="round" strokeLinejoin="round" style={nss} />
        ))}
        {MAP_ROADS.map((r) => (
          <path key={r.id} d={r.d} fill="none" stroke={r.major ? 'var(--color-map-road-major)' : 'var(--color-map-road)'} strokeWidth={r.major ? 6 : 4} strokeLinecap="round" strokeLinejoin="round" style={nss} />
        ))}

        <g fill="var(--color-map-label)" fontWeight="600" textAnchor="middle" style={{ fontSize: 11 * s, letterSpacing: 2.2 * s }}>
          {AREA_LABELS.map(([name, x, y]) => (
            <text key={name} x={x} y={y}>
              {name}
            </text>
          ))}
          <text x="0" y="0" transform="translate(935 300) rotate(90)" opacity="0.7" style={{ letterSpacing: 4 * s }}>
            BAY OF BENGAL
          </text>
        </g>

        {route && (
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d={routeD} stroke="var(--color-accent)" strokeWidth="16" opacity="0.35" filter="url(#route-glow)" style={nss} />
            <path d={routeD} stroke="var(--color-accent)" strokeWidth="7" style={nss} />
            <path d={routeD} stroke="#fff" strokeOpacity="0.6" strokeWidth="2" strokeDasharray="2 16" style={{ ...nss, animation: 'route-dash 1.6s linear infinite' }} />
            {doneD && <path d={doneD} stroke="var(--color-ink-3)" strokeWidth="7.5" style={nss} />}
          </g>
        )}

        {pois.map((p) => (
          <PoiMarker key={p.id} place={p} scale={s} active={p.id === destination?.id} onSelect={onSelectPlace} />
        ))}

        {destination && (
          <g transform={`translate(${destination.x} ${destination.y}) scale(${s})`}>
            <ellipse cx="0" cy="2" rx="9" ry="3.5" fill="#000" opacity="0.35" />
            <path d="M0 0 C -4 -10 -14 -16 -14 -27 A 14 14 0 1 1 14 -27 C 14 -16 4 -10 0 0 Z" fill="var(--color-ok)" stroke="#fff" strokeWidth="2.5" />
            <circle cx="0" cy="-27" r="5" fill="#fff" />
          </g>
        )}

        <g transform={`translate(${car.x} ${car.y}) scale(${s})`}>
          <circle r="22" fill="var(--color-accent)" opacity="0.18">
            <animate attributeName="r" values="15;24;15" dur="2.4s" repeatCount="indefinite" />
          </circle>
          <circle r="13" fill="#fff" />
          <circle r="10.5" fill="var(--color-accent)" />
          <path d="M0 -6 L5 5 L0 2.4 L-5 5 Z" fill="#fff" transform={`rotate(${route ? car.angle : 0})`} />
        </g>
      </svg>
    </div>
  );
});

function PoiMarker({ place, active, scale, onSelect }: { place: Place; active: boolean; scale: number; onSelect?: (id: string) => void }) {
  const fuel = place.category === 'fuel';
  return (
    <g
      transform={`translate(${place.x} ${place.y}) scale(${scale})`}
      onClick={onSelect ? () => onSelect(place.id) : undefined}
      style={{ cursor: onSelect ? 'pointer' : undefined }}
      role={onSelect ? 'button' : undefined}
      aria-label={onSelect ? `Route to ${place.name}` : undefined}
    >
      <circle r={active ? 15 : 12} fill={fuel ? 'var(--color-warn)' : 'var(--color-accent)'} stroke="#fff" strokeWidth="2" />
      {fuel ? (
        <path d="M-4.5 6V-5.5a1.5 1.5 0 0 1 1.5-1.5h5a1.5 1.5 0 0 1 1.5 1.5V6M-5.5 6h9M-3 -3h4M3.5 -1l2.5 2v4a1 1 0 0 0 2 0V-2" fill="none" stroke="#0b1320" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <text y="4.5" textAnchor="middle" fontSize="13" fontWeight="800" fill="#0b1320">
          P
        </text>
      )}
    </g>
  );
}
