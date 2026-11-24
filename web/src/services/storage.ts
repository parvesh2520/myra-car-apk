import type { AppState } from '../types';

const KEY = 'myra.infotainment.v1';

/** Slices of state that survive a reload. Transient UI state (page, calls, toasts) is excluded. */
type Persisted = Pick<AppState, 'climate' | 'settings' | 'profiles' | 'activeProfileId' | 'vehicle'> & {
  media: Partial<AppState['media']>;
  nav: Partial<AppState['nav']>;
  phone: Partial<AppState['phone']>;
};

function pick(state: AppState): Persisted {
  const { playing: _playing, ...media } = state.media;
  return {
    climate: state.climate,
    settings: state.settings,
    profiles: state.profiles,
    activeProfileId: state.activeProfileId,
    vehicle: state.vehicle,
    media,
    nav: {
      originId: state.nav.originId,
      recents: state.nav.recents,
      saved: state.nav.saved,
      routePref: state.nav.routePref,
      avoidTolls: state.nav.avoidTolls,
    },
    phone: { bluetooth: state.phone.bluetooth, projection: state.phone.projection },
  };
}

export function loadState(defaults: AppState): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<Persisted>;
    const profiles = Array.isArray(saved.profiles) && saved.profiles.length ? saved.profiles : defaults.profiles;
    return {
      ...defaults,
      climate: { ...defaults.climate, ...saved.climate },
      settings: {
        ...defaults.settings,
        ...saved.settings,
        motionSense: { ...defaults.settings.motionSense, ...saved.settings?.motionSense },
      },
      vehicle: { ...defaults.vehicle, ...saved.vehicle },
      media: { ...defaults.media, ...saved.media, playing: false },
      nav: { ...defaults.nav, ...saved.nav },
      phone: { ...defaults.phone, ...saved.phone },
      profiles,
      activeProfileId: profiles.some((p) => p.id === saved.activeProfileId)
        ? (saved.activeProfileId as string)
        : profiles[0].id,
    };
  } catch {
    return defaults;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(pick(state)));
  } catch {
    /* storage may be unavailable (private mode, quota) — settings simply won't persist */
  }
}

export function clearSavedState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
