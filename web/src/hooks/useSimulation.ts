import { useEffect, useRef } from 'react';
import { useActions, useAppState } from '../context/AppStore';
import { placeById } from '../data/places';
import { useRoute } from './useRoute';

/** Simulated time scale for demo driving: a 20-minute route completes in ~60 s. */
const SPEEDUP = 20;

/**
 * Drives the frontend simulations: track progression, demo route progress and
 * fuel use while in Driving mode. Nothing here reads real vehicle data.
 */
export function useSimulation() {
  const state = useAppState();
  const actions = useActions();
  const { route } = useRoute();
  const routeRef = useRef(route);
  routeRef.current = route;
  const modeRef = useRef(state.driveMode);
  modeRef.current = state.driveMode;

  useEffect(() => {
    const id = window.setInterval(() => {
      actions.media.tick();
      const r = routeRef.current;
      if (modeRef.current === 'driving' && r) {
        const step = SPEEDUP / (r.durationMin * 60);
        actions.nav.advance(step);
        actions.vehicle.drive(r.distanceKm * step);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [actions]);

  const { destinationId, progress } = state.nav;
  useEffect(() => {
    if (destinationId && progress >= 1) {
      const name = placeById(destinationId)?.name ?? 'your destination';
      actions.nav.arrive();
      actions.ui.toast(`You have arrived at ${name} (simulated route)`, 'success');
    }
  }, [destinationId, progress, actions]);
}
