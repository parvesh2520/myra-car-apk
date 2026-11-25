import type { AppState, DriverProfile, SettingsState } from '../types';
import { seedCallLog } from './contacts';
import { inCarApp } from '../services/carModel';

/** Demo outside temperature used by climate suggestions (not a live reading). */
export const OUTSIDE_TEMP_C = 31;

export const DEFAULT_PROFILES: DriverProfile[] = [
  {
    id: 'kanishk',
    name: 'Kanishk',
    preferredTemp: 22,
    language: 'hinglish',
    favouriteGenre: 'hiphop',
    homeId: 'home-besant',
    workId: 'work-tidel',
    theme: 'dark',
    colour: '#4D9EFF',
  },
  {
    id: 'priya',
    name: 'Priya',
    preferredTemp: 24,
    language: 'en',
    favouriteGenre: 'romantic',
    homeId: 'home-anna',
    workId: 'work-guindy-ie',
    theme: 'dark',
    colour: '#56C69B',
  },
  {
    id: 'guest',
    name: 'Guest',
    preferredTemp: 23,
    language: 'en',
    favouriteGenre: 'english',
    homeId: '',
    workId: '',
    theme: 'dark',
    colour: '#E8B65E',
  },
];

export const DEFAULT_SETTINGS: SettingsState = {
  brightness: 100,
  theme: 'dark',
  autoDayNight: false,
  screenFit: 'fill',
  uiLanguage: 'en',
  voiceLanguage: 'hinglish',
  tempUnit: 'C',
  distanceUnit: 'km',
  clock24h: true,
  largeText: false,
  highContrast: false,
  reduceMotion: inCarApp(), // car head units are slow: no animations by default
  speakResponses: true,
  voiceRate: 1,
  showVoiceChips: true,
  confirmClimate: true,
  wifi: true,
  autoConnectPhone: true,
  bass: 1,
  mid: 0,
  treble: 1,
  balance: 0,
  fader: 0,
  speedVolume: true,
  touchBeep: false,
  customCommands: [
    { id: 'cc-chill', phrase: 'chill mode', command: 'AC 21 pe kar do and play focus' },
  ],
  motionSense: { enabled: false, intensity: 'medium', adaptation: 'adaptive', passengerMode: false, input: 'simulation' },
};

export function createDefaultState(): AppState {
  const profile = DEFAULT_PROFILES[0];
  return {
    booted: false,
    page: 'home',
    pageSection: null,
    driveMode: 'parked',
    assistantOpen: false,
    climate: {
      ac: true,
      auto: false,
      sync: true,
      recirculation: false,
      fan: 3,
      airflow: { face: true, feet: false, windshield: false },
      frontDefog: false,
      rearDefog: false,
      driver: { temp: profile.preferredTemp, seatHeat: 0, seatVent: 1 },
      passenger: { temp: profile.preferredTemp, seatHeat: 0, seatVent: 0 },
    },
    media: {
      source: 'bluetooth',
      playlistId: profile.favouriteGenre,
      trackIndex: 0,
      position: 48,
      playing: false,
      volume: 14,
      muted: false,
      shuffle: false,
      repeat: false,
      favourites: ['ro1', 'fo1', 'hh3'],
      recent: ['hh1', 'ro2', 'en1', 'fo1'],
      radioStationId: 'fm911',
    },
    nav: {
      originId: 'guindy',
      destinationId: null,
      progress: 0,
      routeStartedAt: null,
      recents: ['iitm', 'marina', 'airport'],
      saved: ['iitm', 'phoenix', 'kapaleeshwarar'],
      routePref: 'fastest',
      avoidTolls: false,
    },
    phone: {
      bluetooth: true,
      deviceConnected: true,
      deviceName: `${profile.name}’s Phone`,
      projection: 'none',
      call: { status: 'idle', direction: 'incoming', contactId: null, startedAt: null, muted: false },
      recents: seedCallLog(),
    },
    vehicle: {
      fuelPct: 64,
      odometerKm: 18240,
      oilLifePct: 72,
      batteryV: 12.6,
      tyres: { fl: 34, fr: 34, rl: 30, rr: 33 },
      adas: {
        laneDeparture: true,
        collisionWarning: true,
        parkingAssist: true,
        blindSpot: true,
        driverMonitoring: true,
        safeExit: true,
      },
      headlampsAuto: true,
      followMeHomeSec: 30,
      ambientColour: '#4D9EFF',
      ambientBrightness: 6,
      locked: true,
      autoLock: true,
      welcomeLight: true,
      mirrorAutoFold: true,
      drivePref: 'normal',
    },
    settings: { ...DEFAULT_SETTINGS, voiceLanguage: profile.language },
    profiles: DEFAULT_PROFILES,
    activeProfileId: profile.id,
    toast: null,
  };
}

/** Tyre pressure band (psi) treated as normal in this simulation. */
export const TYRE_RANGE = { min: 32, max: 36, recommended: 34 };
/** Simulated full-tank range used to estimate remaining range. */
export const FULL_TANK_RANGE_KM = 640;
