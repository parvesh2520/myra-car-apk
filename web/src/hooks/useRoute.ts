import { useMemo } from 'react';
import { useAppState } from '../context/AppStore';
import { placeById } from '../data/places';
import { computeRoute } from '../services/routing';
import type { Place, RouteInfo } from '../types';

export interface ActiveRoute {
  origin: Place;
  destination: Place | null;
  route: RouteInfo | null;
  remainingKm: number;
  remainingMin: number;
  eta: Date | null;
}

/** Derived (simulated) route for the current destination. */
export function useRoute(): ActiveRoute {
  const { nav } = useAppState();
  return useMemo(() => {
    const origin = placeById(nav.originId) ?? placeById('guindy')!;
    const destination = placeById(nav.destinationId) ?? null;
    if (!destination || destination.id === origin.id) {
      return { origin, destination, route: null, remainingKm: 0, remainingMin: 0, eta: null };
    }
    const route = computeRoute(origin, destination, nav.routePref, nav.avoidTolls);
    const left = 1 - nav.progress;
    const remainingMin = route.durationMin * left;
    return {
      origin,
      destination,
      route,
      remainingKm: route.distanceKm * left,
      remainingMin,
      eta: new Date(Date.now() + remainingMin * 60000),
    };
  }, [nav.originId, nav.destinationId, nav.routePref, nav.avoidTolls, nav.progress]);
}
