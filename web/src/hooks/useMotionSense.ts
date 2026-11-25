import { useSyncExternalStore } from 'react';
import { useAppState } from '../context/AppStore';
import { motionRuntime } from '../services/motionSense';
import type { MotionInput } from '../types';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia?.(REDUCED_QUERY);
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
};
const getReduced = () => window.matchMedia?.(REDUCED_QUERY).matches ?? false;

/** Resolved MotionSense state: settings, transient runtime, and whether cues should be shown. */
export function useMotionSense() {
  const { settings, driveMode } = useAppState();
  const runtime = useSyncExternalStore(motionRuntime.subscribe, motionRuntime.get);
  const systemReduced = useSyncExternalStore(subscribeReduced, getReduced);
  const ms = settings.motionSense;
  // Without passenger mode the screen is treated as the driver's display: no cues while driving.
  const suppressed = driveMode === 'driving' && !ms.passengerMode;
  const live = ms.enabled && !suppressed;
  // Preview and the demo always use simulated motion; the demo also runs at High intensity so the dots read from across a room.
  const input: MotionInput = runtime.preview || runtime.demo ? 'simulation' : ms.input;
  return {
    ms,
    runtime,
    suppressed,
    live,
    demo: runtime.demo,
    active: runtime.demo || runtime.preview || live,
    input,
    intensity: runtime.demo ? ('high' as const) : ms.intensity,
    reducedMotion: settings.reduceMotion || systemReduced,
  };
}
