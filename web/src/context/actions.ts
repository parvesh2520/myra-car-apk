import type {
  AppState,
  AudioSource,
  ClimateState,
  CustomCommand,
  DriveMode,
  DriverProfile,
  MediaState,
  PageId,
  PlaylistId,
  Projection,
  RoutePreference,
  SettingsState,
  Toast,
  VehicleState,
  Zone,
} from '../types';
import { playlistById } from '../data/media';
import { contactById, CONTACTS } from '../data/contacts';
import { createDefaultState, OUTSIDE_TEMP_C, TYRE_RANGE } from '../data/defaults';
import { clamp } from '../services/format';
import { clearSavedState } from '../services/storage';

export type Updater = (s: AppState) => AppState;
type Update = (fn: Updater) => void;

export const TEMP_MIN = 16;
export const TEMP_MAX = 30;
export const FAN_MAX = 7;
export const VOLUME_MAX = 30;

let toastSeq = 0;

const autoFanFor = (temp: number) => clamp(Math.round((OUTSIDE_TEMP_C - temp) / 2.5) + 1, 1, FAN_MAX);

const withClimate = (s: AppState, patch: Partial<ClimateState>): AppState => {
  const climate = { ...s.climate, ...patch };
  if (climate.auto) climate.fan = autoFanFor(climate.driver.temp);
  return { ...s, climate };
};

const withMedia = (s: AppState, patch: Partial<MediaState>): AppState => ({ ...s, media: { ...s.media, ...patch } });

const pushRecent = (recent: string[], id: string) => [id, ...recent.filter((r) => r !== id)].slice(0, 12);

/** Moves playback to a track and records it in "recently played". */
const selectTrack = (s: AppState, playlistId: PlaylistId, index: number, playing = s.media.playing): AppState => {
  const pl = playlistById(playlistId);
  const i = ((index % pl.tracks.length) + pl.tracks.length) % pl.tracks.length;
  return withMedia(s, {
    playlistId,
    trackIndex: i,
    position: 0,
    playing,
    recent: playing ? pushRecent(s.media.recent, pl.tracks[i].id) : s.media.recent,
  });
};

export const activeProfile = (s: AppState): DriverProfile =>
  s.profiles.find((p) => p.id === s.activeProfileId) ?? s.profiles[0];

export function createActions(update: Update) {
  const toast = (text: string, tone: Toast['tone'] = 'info') =>
    update((s) => ({ ...s, toast: { id: ++toastSeq, text, tone } }));

  const climate = {
    setTemp: (value: number, zone: Zone | 'both' = 'driver') =>
      update((s) => {
        const temp = clamp(Math.round(value * 2) / 2, TEMP_MIN, TEMP_MAX);
        const c = s.climate;
        if (zone === 'passenger') {
          return withClimate(s, { sync: false, passenger: { ...c.passenger, temp } });
        }
        const both = zone === 'both' || c.sync;
        return withClimate(s, {
          driver: { ...c.driver, temp },
          passenger: both ? { ...c.passenger, temp } : c.passenger,
          fan: c.fan === 0 ? 3 : c.fan,
        });
      }),
    adjustTemp: (delta: number, zone: Zone = 'driver') =>
      update((s) => {
        const current = s.climate[zone].temp;
        const temp = clamp(current + delta, TEMP_MIN, TEMP_MAX);
        const c = s.climate;
        if (zone === 'passenger') return withClimate(s, { sync: false, passenger: { ...c.passenger, temp } });
        return withClimate(s, {
          driver: { ...c.driver, temp },
          passenger: c.sync ? { ...c.passenger, temp } : c.passenger,
        });
      }),
    setFan: (level: number) => update((s) => withClimate(s, { fan: clamp(level, 0, FAN_MAX), auto: false })),
    adjustFan: (delta: number) =>
      update((s) => withClimate(s, { fan: clamp(s.climate.fan + delta, 0, FAN_MAX), auto: false })),
    setAc: (on: boolean) =>
      update((s) => withClimate(s, on ? { ac: true, fan: s.climate.fan || 3 } : { ac: false, auto: false })),
    toggle: (key: 'auto' | 'sync' | 'recirculation' | 'frontDefog' | 'rearDefog') =>
      update((s) => {
        const c = s.climate;
        const on = !c[key];
        switch (key) {
          case 'auto':
            return withClimate(s, { auto: on, ac: on ? true : c.ac });
          case 'sync':
            return withClimate(s, { sync: on, passenger: on ? { ...c.passenger, temp: c.driver.temp } : c.passenger });
          case 'frontDefog':
            return withClimate(s, {
              frontDefog: on,
              ac: on ? true : c.ac,
              fan: on ? Math.max(c.fan, 4) : c.fan,
              airflow: on ? { ...c.airflow, windshield: true } : c.airflow,
            });
          default:
            return withClimate(s, { [key]: on });
        }
      }),
    toggleAirflow: (key: keyof ClimateState['airflow']) =>
      update((s) => {
        const airflow = { ...s.climate.airflow, [key]: !s.climate.airflow[key] };
        if (!airflow.face && !airflow.feet && !airflow.windshield) return s; // keep at least one vent open
        return withClimate(s, { airflow });
      }),
    setSeat: (zone: Zone, kind: 'seatHeat' | 'seatVent', level: number) =>
      update((s) => {
        const z = { ...s.climate[zone], [kind]: clamp(level, 0, 3) };
        // Heating and ventilation are mutually exclusive on the same seat.
        if (level > 0) z[kind === 'seatHeat' ? 'seatVent' : 'seatHeat'] = 0;
        return withClimate(s, { [zone]: z });
      }),
    off: () => update((s) => withClimate(s, { ac: false, auto: false, fan: 0 })),
  };

  const media = {
    play: () =>
      update((s) => {
        const pl = playlistById(s.media.playlistId);
        const track = pl.tracks[s.media.trackIndex];
        return withMedia(s, {
          playing: true,
          recent: s.media.source === 'radio' || !track ? s.media.recent : pushRecent(s.media.recent, track.id),
        });
      }),
    pause: () => update((s) => withMedia(s, { playing: false })),
    toggle: () =>
      update((s) => {
        if (s.media.playing) return withMedia(s, { playing: false });
        const track = playlistById(s.media.playlistId).tracks[s.media.trackIndex];
        return withMedia(s, { playing: true, recent: track ? pushRecent(s.media.recent, track.id) : s.media.recent });
      }),
    next: () =>
      update((s) => {
        const pl = playlistById(s.media.playlistId);
        let i = s.media.trackIndex + 1;
        if (s.media.shuffle && pl.tracks.length > 1) {
          do i = Math.floor(Math.random() * pl.tracks.length);
          while (i === s.media.trackIndex);
        }
        return selectTrack(s, s.media.playlistId, i);
      }),
    prev: () =>
      update((s) =>
        s.media.position > 5
          ? withMedia(s, { position: 0 })
          : selectTrack(s, s.media.playlistId, s.media.trackIndex - 1),
      ),
    seek: (position: number) => update((s) => withMedia(s, { position: Math.max(0, position) })),
    setVolume: (v: number) => update((s) => withMedia(s, { volume: clamp(Math.round(v), 0, VOLUME_MAX), muted: false })),
    adjustVolume: (d: number) =>
      update((s) => withMedia(s, { volume: clamp(s.media.volume + d, 0, VOLUME_MAX), muted: false })),
    toggleMute: () => update((s) => withMedia(s, { muted: !s.media.muted })),
    playPlaylist: (id: PlaylistId, index = 0) =>
      update((s) => {
        const source: AudioSource = id === 'podcasts' ? 'podcasts' : s.media.source === 'usb' ? 'usb' : 'bluetooth';
        return selectTrack({ ...s, media: { ...s.media, source } }, id, index, true);
      }),
    setSource: (source: AudioSource) =>
      update((s) => {
        if (source === s.media.source) return s;
        if (source === 'radio') return withMedia(s, { source });
        if (source === 'podcasts') return withMedia(s, { source, playlistId: 'podcasts', trackIndex: 0, position: 0 });
        const playlistId = s.media.playlistId === 'podcasts' ? activeProfile(s).favouriteGenre : s.media.playlistId;
        return withMedia(s, {
          source,
          playlistId,
          trackIndex: playlistId === s.media.playlistId ? s.media.trackIndex : 0,
          position: playlistId === s.media.playlistId ? s.media.position : 0,
        });
      }),
    playRadio: (id: string) => update((s) => withMedia(s, { source: 'radio', radioStationId: id, playing: true })),
    toggleFavourite: (trackId: string) =>
      update((s) => {
        const fav = s.media.favourites;
        return withMedia(s, { favourites: fav.includes(trackId) ? fav.filter((f) => f !== trackId) : [trackId, ...fav] });
      }),
    toggleShuffle: () => update((s) => withMedia(s, { shuffle: !s.media.shuffle })),
    toggleRepeat: () => update((s) => withMedia(s, { repeat: !s.media.repeat })),
    /** Advances simulated playback by one second. */
    tick: () =>
      update((s) => {
        const m = s.media;
        if (!m.playing || m.source === 'radio') return s;
        const pl = playlistById(m.playlistId);
        const track = pl.tracks[m.trackIndex];
        if (!track) return s;
        if (m.position + 1 < track.duration) return withMedia(s, { position: m.position + 1 });
        return m.repeat ? withMedia(s, { position: 0 }) : selectTrack(s, m.playlistId, m.trackIndex + 1, true);
      }),
  };

  const nav = {
    setDestination: (id: string) =>
      update((s) => ({
        ...s,
        nav: {
          ...s.nav,
          destinationId: id,
          progress: 0,
          routeStartedAt: Date.now(),
          recents: [id, ...s.nav.recents.filter((r) => r !== id)].slice(0, 8),
        },
      })),
    cancel: () => update((s) => ({ ...s, nav: { ...s.nav, destinationId: null, progress: 0, routeStartedAt: null } })),
    toggleSaved: (id: string) =>
      update((s) => {
        const saved = s.nav.saved.includes(id) ? s.nav.saved.filter((x) => x !== id) : [...s.nav.saved, id];
        return { ...s, nav: { ...s.nav, saved } };
      }),
    setRoutePref: (routePref: RoutePreference) => update((s) => ({ ...s, nav: { ...s.nav, routePref } })),
    toggleAvoidTolls: () => update((s) => ({ ...s, nav: { ...s.nav, avoidTolls: !s.nav.avoidTolls } })),
    /** Simulated progress while in Driving mode (demo only). */
    advance: (step: number) =>
      update((s) =>
        s.nav.destinationId ? { ...s, nav: { ...s.nav, progress: Math.min(1, s.nav.progress + step) } } : s,
      ),
    arrive: () =>
      update((s) => {
        const { destinationId } = s.nav;
        if (!destinationId) return s;
        return { ...s, nav: { ...s.nav, originId: destinationId, destinationId: null, progress: 0, routeStartedAt: null } };
      }),
    resetOrigin: () => update((s) => ({ ...s, nav: { ...s.nav, originId: 'guindy' } })),
  };

  const phone = {
    simulateIncoming: (contactId?: string) =>
      update((s) => {
        if (s.phone.call.status !== 'idle' || !s.phone.deviceConnected) return s;
        const id = contactId ?? CONTACTS[Math.floor(Math.random() * 5)].id;
        return {
          ...s,
          phone: { ...s.phone, call: { status: 'incoming', direction: 'incoming', contactId: id, startedAt: null, muted: false } },
        };
      }),
    accept: () =>
      update((s) => ({ ...s, phone: { ...s.phone, call: { ...s.phone.call, status: 'active', startedAt: Date.now() } } })),
    reject: () =>
      update((s) => {
        const { contactId } = s.phone.call;
        const log = contactId
          ? [{ id: `l${Date.now()}`, contactId, direction: 'missed' as const, at: Date.now(), durationSec: 0 }]
          : [];
        return {
          ...s,
          phone: { ...s.phone, recents: [...log, ...s.phone.recents], call: { ...s.phone.call, status: 'idle', contactId: null } },
        };
      }),
    call: (contactId: string) =>
      update((s) => {
        if (!s.phone.deviceConnected || !contactById(contactId)) return s;
        return {
          ...s,
          phone: { ...s.phone, call: { status: 'active', direction: 'outgoing', contactId, startedAt: Date.now(), muted: false } },
        };
      }),
    end: () =>
      update((s) => {
        const { contactId, startedAt, direction } = s.phone.call;
        const log = contactId
          ? [{ id: `l${Date.now()}`, contactId, direction, at: Date.now(), durationSec: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0 }]
          : [];
        return {
          ...s,
          phone: {
            ...s.phone,
            recents: [...log, ...s.phone.recents].slice(0, 20),
            call: { status: 'idle', direction: 'incoming', contactId: null, startedAt: null, muted: false },
          },
        };
      }),
    toggleMute: () =>
      update((s) => ({ ...s, phone: { ...s.phone, call: { ...s.phone.call, muted: !s.phone.call.muted } } })),
    setBluetooth: (on: boolean) =>
      update((s) => ({
        ...s,
        phone: {
          ...s.phone,
          bluetooth: on,
          deviceConnected: on ? s.phone.deviceConnected : false,
          projection: on ? s.phone.projection : 'none',
          call: on ? s.phone.call : { status: 'idle', direction: 'incoming', contactId: null, startedAt: null, muted: false },
        },
      })),
    setConnected: (on: boolean) =>
      update((s) => ({
        ...s,
        phone: { ...s.phone, bluetooth: on ? true : s.phone.bluetooth, deviceConnected: on, projection: on ? s.phone.projection : 'none' },
      })),
    setProjection: (projection: Projection) =>
      update((s) => ({ ...s, phone: { ...s.phone, projection: s.phone.deviceConnected ? projection : 'none' } })),
  };

  const vehicle = {
    patch: (patch: Partial<VehicleState>) => update((s) => ({ ...s, vehicle: { ...s.vehicle, ...patch } })),
    setAdas: (key: keyof VehicleState['adas'], on: boolean) =>
      update((s) => ({ ...s, vehicle: { ...s.vehicle, adas: { ...s.vehicle.adas, [key]: on } } })),
    inflateTyres: () =>
      update((s) => ({
        ...s,
        vehicle: { ...s.vehicle, tyres: { fl: TYRE_RANGE.recommended, fr: TYRE_RANGE.recommended, rl: TYRE_RANGE.recommended, rr: TYRE_RANGE.recommended } },
      })),
    refuel: () => update((s) => ({ ...s, vehicle: { ...s.vehicle, fuelPct: 100 } })),
    drive: (km: number) =>
      update((s) => ({
        ...s,
        vehicle: {
          ...s.vehicle,
          odometerKm: s.vehicle.odometerKm + km,
          fuelPct: Math.max(4, s.vehicle.fuelPct - km * 0.16),
        },
      })),
  };

  const settings = {
    patch: (patch: Partial<SettingsState>) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
    addCustomCommand: (phrase: string, command: string) =>
      update((s) => {
        const cmd: CustomCommand = { id: `cc-${Date.now()}`, phrase: phrase.trim().toLowerCase(), command: command.trim() };
        return { ...s, settings: { ...s.settings, customCommands: [...s.settings.customCommands, cmd] } };
      }),
    removeCustomCommand: (id: string) =>
      update((s) => ({
        ...s,
        settings: { ...s.settings, customCommands: s.settings.customCommands.filter((c) => c.id !== id) },
      })),
    resetAll: () => {
      clearSavedState();
      update((s) => ({ ...createDefaultState(), booted: s.booted, toast: { id: ++toastSeq, text: 'All settings restored to defaults', tone: 'success' } }));
    },
  };

  const applyProfile = (s: AppState, p: DriverProfile): AppState => {
    const c = s.climate;
    const next = withClimate(s, {
      driver: { ...c.driver, temp: p.preferredTemp },
      passenger: c.sync ? { ...c.passenger, temp: p.preferredTemp } : c.passenger,
    });
    return {
      ...next,
      activeProfileId: p.id,
      settings: { ...next.settings, voiceLanguage: p.language, theme: p.theme },
      media: next.media.playing ? next.media : { ...next.media, playlistId: p.favouriteGenre, trackIndex: 0, position: 0 },
      phone: { ...next.phone, deviceName: p.id === 'guest' ? 'Guest device' : `${p.name}’s Phone` },
    };
  };

  const profiles = {
    switchTo: (id: string) =>
      update((s) => {
        const p = s.profiles.find((x) => x.id === id);
        if (!p) return s;
        return {
          ...applyProfile(s, p),
          toast: { id: ++toastSeq, text: `Welcome, ${p.name}. Your preferences are ready.`, tone: 'success' },
        };
      }),
    update: (id: string, patch: Partial<DriverProfile>) =>
      update((s) => {
        const profilesNext = s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p));
        const next = { ...s, profiles: profilesNext };
        if (id !== s.activeProfileId) return next;
        // Keep live preferences in step with the active profile.
        const p = profilesNext.find((x) => x.id === id)!;
        return {
          ...next,
          settings: {
            ...next.settings,
            voiceLanguage: patch.language ?? next.settings.voiceLanguage,
            theme: patch.theme ?? next.settings.theme,
          },
          phone: patch.name ? { ...next.phone, deviceName: `${p.name}’s Phone` } : next.phone,
        };
      }),
    add: (name: string) =>
      update((s) => {
        const p: DriverProfile = {
          id: `p-${Date.now()}`,
          name: name.trim() || 'New driver',
          preferredTemp: 23,
          language: 'en',
          favouriteGenre: 'english',
          homeId: '',
          workId: '',
          theme: 'dark',
          colour: ['#4D9EFF', '#56C69B', '#E8B65E', '#FF7A8A', '#B9A7FF'][s.profiles.length % 5],
        };
        return { ...applyProfile({ ...s, profiles: [...s.profiles, p] }, p) };
      }),
    remove: (id: string) =>
      update((s) => {
        if (s.profiles.length <= 1 || id === s.activeProfileId) return s;
        return { ...s, profiles: s.profiles.filter((p) => p.id !== id) };
      }),
  };

  const ui = {
    go: (page: PageId, section: string | null = null) =>
      update((s) => (s.page === page && s.pageSection === section ? s : { ...s, page, pageSection: section })),
    setDriveMode: (driveMode: DriveMode) => update((s) => ({ ...s, driveMode })),
    setAssistantOpen: (assistantOpen: boolean) => update((s) => ({ ...s, assistantOpen })),
    boot: () => update((s) => ({ ...s, booted: true, page: 'home', pageSection: null })),
    standby: () => update((s) => ({ ...s, booted: false, assistantOpen: false, media: { ...s.media, playing: false } })),
    toast,
    dismissToast: (id: number) => update((s) => (s.toast?.id === id ? { ...s, toast: null } : s)),
  };

  return { climate, media, nav, phone, vehicle, settings, profiles, ui };
}

export type Actions = ReturnType<typeof createActions>;
