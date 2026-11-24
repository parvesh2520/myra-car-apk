export type PageId =
  | 'home'
  | 'navigation'
  | 'media'
  | 'climate'
  | 'phone'
  | 'vehicle'
  | 'apps'
  | 'features'
  | 'settings';

export type DriveMode = 'parked' | 'driving';
export type UiLanguage = 'en' | 'hi';
export type VoiceLanguage = 'en' | 'hi' | 'hinglish';
export type Zone = 'driver' | 'passenger';

/* ---------- Climate ---------- */
export interface ZoneClimate {
  temp: number; // °C, 16–30
  seatHeat: number; // 0–3
  seatVent: number; // 0–3
}

export interface Airflow {
  face: boolean;
  feet: boolean;
  windshield: boolean;
}

export interface ClimateState {
  ac: boolean;
  auto: boolean;
  sync: boolean;
  recirculation: boolean;
  fan: number; // 0 = off, 1–7
  airflow: Airflow;
  frontDefog: boolean;
  rearDefog: boolean;
  driver: ZoneClimate;
  passenger: ZoneClimate;
}

/* ---------- Media ---------- */
export type AudioSource = 'bluetooth' | 'radio' | 'usb' | 'podcasts';
export type PlaylistId = 'hiphop' | 'romantic' | 'bollywood' | 'focus' | 'english' | 'podcasts';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  art: [string, string]; // gradient colours for generated artwork
}

export interface Playlist {
  id: PlaylistId;
  name: string;
  nameHi: string;
  description: string;
  art: [string, string];
  tracks: Track[];
}

export interface RadioStation {
  id: string;
  frequency: string;
  name: string;
  genre: string;
}

export interface MediaState {
  source: AudioSource;
  playlistId: PlaylistId;
  trackIndex: number;
  position: number;
  playing: boolean;
  volume: number; // 0–30
  muted: boolean;
  shuffle: boolean;
  repeat: boolean;
  favourites: string[];
  recent: string[];
  radioStationId: string;
}

/* ---------- Navigation ---------- */
export type PlaceCategory =
  | 'home'
  | 'work'
  | 'education'
  | 'transport'
  | 'leisure'
  | 'shopping'
  | 'culture'
  | 'fuel'
  | 'parking'
  | 'business';

export interface Place {
  id: string;
  name: string;
  area: string;
  category: PlaceCategory;
  x: number; // mock map coordinates (0–1000)
  y: number; // mock map coordinates (0–600)
  aliases: string[];
  detail?: string;
}

export type RoutePreference = 'fastest' | 'shortest' | 'eco';

export interface NavState {
  originId: string;
  destinationId: string | null;
  progress: number; // 0–1 along the simulated route
  routeStartedAt: number | null;
  recents: string[];
  saved: string[];
  routePref: RoutePreference;
  avoidTolls: boolean;
}

export interface RouteInfo {
  points: { x: number; y: number }[];
  distanceKm: number;
  durationMin: number;
  via: string;
  toll: boolean;
}

/* ---------- Phone ---------- */
export interface Contact {
  id: string;
  name: string;
  label: string;
  number: string;
  favourite: boolean;
  colour: string;
}

export type CallDirection = 'incoming' | 'outgoing' | 'missed';

export interface CallLog {
  id: string;
  contactId: string;
  direction: CallDirection;
  at: number;
  durationSec: number;
}

export type Projection = 'none' | 'androidAuto' | 'carPlay';

export interface CallState {
  status: 'idle' | 'incoming' | 'active';
  direction: 'incoming' | 'outgoing';
  contactId: string | null;
  startedAt: number | null;
  muted: boolean;
}

export interface PhoneState {
  bluetooth: boolean;
  deviceConnected: boolean;
  deviceName: string;
  projection: Projection;
  call: CallState;
  recents: CallLog[];
}

/* ---------- Vehicle ---------- */
export type TyreId = 'fl' | 'fr' | 'rl' | 'rr';
export type DrivePreference = 'eco' | 'normal' | 'sport';

export interface AdasState {
  laneDeparture: boolean;
  collisionWarning: boolean;
  parkingAssist: boolean;
  blindSpot: boolean;
  driverMonitoring: boolean;
  safeExit: boolean;
}

export interface VehicleState {
  fuelPct: number;
  odometerKm: number;
  oilLifePct: number;
  batteryV: number;
  tyres: Record<TyreId, number>; // psi
  adas: AdasState;
  headlampsAuto: boolean;
  followMeHomeSec: number;
  ambientColour: string;
  ambientBrightness: number; // 0–10
  locked: boolean;
  autoLock: boolean;
  welcomeLight: boolean;
  mirrorAutoFold: boolean;
  drivePref: DrivePreference;
}

/* ---------- Settings & profiles ---------- */
export type ThemePref = 'dark' | 'light';
export type ScreenFit = 'reference' | 'fill';

export interface SettingsState {
  brightness: number; // 40–100
  theme: ThemePref;
  autoDayNight: boolean;
  screenFit: ScreenFit;
  uiLanguage: UiLanguage;
  voiceLanguage: VoiceLanguage;
  tempUnit: 'C' | 'F';
  distanceUnit: 'km' | 'mi';
  clock24h: boolean;
  largeText: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  speakResponses: boolean;
  voiceRate: number; // 0.8–1.2
  showVoiceChips: boolean;
  confirmClimate: boolean;
  wifi: boolean;
  autoConnectPhone: boolean;
  bass: number; // −5…5
  mid: number;
  treble: number;
  balance: number;
  fader: number;
  speedVolume: boolean;
  touchBeep: boolean;
  customCommands: CustomCommand[];
  motionSense: MotionSenseSettings;
}

/* ---------- MYRA MotionSense ---------- */
export type MotionIntensity = 'low' | 'medium' | 'high';
export type MotionAdaptation = 'adaptive' | 'manual';
/** Where motion data comes from. A vehicle IMU would be a third input feeding the same pipeline. */
export type MotionInput = 'simulation' | 'device';

export interface MotionSenseSettings {
  enabled: boolean;
  intensity: MotionIntensity;
  adaptation: MotionAdaptation;
  /** Allow cues while driving (a passenger is using the screen). Off keeps the driver's display clear. */
  passengerMode: boolean;
  input: MotionInput;
}

export interface DriverProfile {
  id: string;
  name: string;
  preferredTemp: number;
  language: VoiceLanguage;
  favouriteGenre: PlaylistId;
  homeId: string;
  workId: string;
  theme: ThemePref;
  colour: string;
}

/** A phrase taught by the user ("Teach Voice") that maps to a built-in command. */
export interface CustomCommand {
  id: string;
  phrase: string;
  command: string;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'warning';
}

export interface AppState {
  booted: boolean;
  page: PageId;
  /** Optional sub-section to open on the current page (e.g. a settings category). */
  pageSection: string | null;
  driveMode: DriveMode;
  assistantOpen: boolean;
  climate: ClimateState;
  media: MediaState;
  nav: NavState;
  phone: PhoneState;
  vehicle: VehicleState;
  settings: SettingsState;
  profiles: DriverProfile[];
  activeProfileId: string;
  toast: Toast | null;
}
