/**
 * Adapter between BhashaDrive's command schemas and MYRA's `Intent` union, so every backend answer is executed
 * by MYRA's own handlers (`assistantBrain.respond`) — the backend never changes cockpit state itself.
 *
 *  - Cloud assistant (`/assistant/interpret`): commands from backend/bhashadrive/nlu/cockpit_commands.py.
 *  - Offline NLU (`/text`): one validated V2 action (backend/bhashadrive/nlu/taxonomy.py).
 *
 * `COMMAND_MAP` must name every backend command (checked by backend test_command_llm.py); `null` marks a
 * vehicle function this simulator does not have, which MYRA reports instead of pretending.
 */
import type { BackendCommand, NluResult } from './api';
import type { Intent } from './intentParser';
import type { PageId, PlaylistId } from '../types';
import { PLACES } from '../data/places';
import { findContact } from '../data/contacts';

type Cmd = BackendCommand & Record<string, unknown>;
type Mapper = ((c: Cmd) => Intent[]) | null;

const repeat = (n: number, i: Intent): Intent[] => Array.from({ length: Math.max(1, Math.min(3, Math.abs(n))) }, () => i);
const GENRE: Record<string, PlaylistId> = { lofi: 'focus', romantic: 'romantic', party: 'hiphop', retro: 'bollywood', devotional: 'bollywood' };
const MOOD: Record<string, PlaylistId> = { party: 'hiphop', relax: 'focus', romantic: 'romantic', focus: 'focus', energy: 'hiphop', cozy: 'romantic' };
const SCREEN: Record<string, PageId> = { home: 'home', nav: 'navigation', media: 'media', climate: 'climate', lights: 'vehicle', phone: 'phone', vehicle: 'vehicle' };

/** A spoken destination -> MYRA's navigation intent (home/work keywords, then place names and aliases). */
export function destinationIntent(destination: string): Intent {
  const q = destination.trim().toLowerCase();
  if (/\b(home|ghar|घर)\b/.test(q)) return { type: 'nav.home' };
  if (/\b(work|office|daftar|ऑफिस)\b/.test(q)) return { type: 'nav.work' };
  if (/\b(petrol|fuel|pump)\b/.test(q)) return { type: 'nav.fuel' };
  if (/\bparking\b/.test(q)) return { type: 'nav.parking' };
  const place = PLACES.find((p) => p.name.toLowerCase() === q || p.aliases?.some((a) => q.includes(a)) || q.includes(p.name.toLowerCase()));
  return place ? { type: 'nav.place', placeId: place.id } : { type: 'unknown', text: destination };
}

export const COMMAND_MAP: Record<string, Mapper> = {
  'climate.setTemp': (c) => [{ type: 'climate.set', value: Number(c.value) }],
  'climate.adjustTemp': (c) => repeat(Number(c.delta), Number(c.delta) > 0 ? { type: 'climate.tempUp' } : { type: 'climate.tempDown' }),
  'climate.power': (c) => [c.on ? { type: 'climate.acOn' } : { type: 'climate.acOff' }],
  'climate.fan': (c) =>
    c.value != null ? [{ type: 'climate.fanSet', value: Number(c.value) }]
      : repeat(Number(c.delta ?? 1), Number(c.delta ?? 1) > 0 ? { type: 'climate.fanUp' } : { type: 'climate.fanDown' }),
  'climate.auto': () => [{ type: 'climate.toggle', key: 'auto', on: true }],
  'climate.recirc': (c) => [{ type: 'climate.toggle', key: 'recirculation', on: typeof c.on === 'boolean' ? c.on : null }],
  'climate.defrost': (c) => [{ type: 'climate.toggle', key: 'frontDefog', on: typeof c.on === 'boolean' ? c.on : null }],
  'media.play': (c) =>
    c.radio || c.freq != null ? [{ type: 'media.radio' }]
      : typeof c.genre === 'string' && GENRE[c.genre] ? [{ type: 'media.playlist', playlist: GENRE[c.genre] }]
        : [{ type: 'media.play' }],
  'media.pause': () => [{ type: 'media.pause' }],
  'media.skip': (c) => [c.dir === -1 ? { type: 'media.prev' } : { type: 'media.next' }],
  'media.volume': (c) =>
    c.mute === true ? [{ type: 'media.mute' }]
      : c.mute === false ? [{ type: 'media.unmute' }]
        : c.value != null ? [{ type: 'media.volSet', value: Number(c.value) }]
          : repeat(Math.round(Number(c.delta ?? 3) / 3), Number(c.delta ?? 3) > 0 ? { type: 'media.volUp' } : { type: 'media.volDown' }),
  mood: (c) => (typeof c.mood === 'string' && MOOD[c.mood] ? [{ type: 'media.playlist', playlist: MOOD[c.mood] }] : []),
  'nav.start': (c) => [destinationIntent(String(c.destination))],
  'nav.stop': () => [{ type: 'nav.cancel' }],
  'phone.call': (c) => {
    const contact = findContact(String(c.contact));
    return [contact ? { type: 'phone.call', contactId: contact.id } : { type: 'phone.callUnknown', name: String(c.contact) }];
  },
  'phone.end': () => [{ type: 'phone.reject' }],
  'doors.lock': (c) => [{ type: 'vehicle.lock', on: !!c.locked }],
  screen: (c) => [{ type: 'open', page: SCREEN[String(c.page)] ?? 'home' }],
  query: (c) => {
    const topic = String(c.topic);
    if (topic === 'fuel') return [{ type: 'vehicle.fuel' }];
    if (topic === 'tyres') return [{ type: 'vehicle.tyres' }];
    if (topic === 'time') return [{ type: 'info.time' }];
    if (topic === 'temp') return [{ type: 'info.weather' }];
    return [{ type: 'vehicle.status' }];
  },
  greet: () => [{ type: 'greet' }],
  help: () => [{ type: 'help' }],
  thanks: () => [{ type: 'thanks' }],
  // Vehicle functions the MYRA simulator does not model: reported to the driver, never faked.
  'ambient.color': null, 'ambient.power': null, 'ambient.brightness': null, 'ambient.mode': null, 'ambient.hue': null,
  wipers: null, window: null, sunroof: null, 'seat.vent': null, profile: null, 'drive.mode': null,
  'lights.head': null, 'lights.hazard': null, ignition: null, rev: null, gear: null, indicator: null,
  'lights.cabin': null, autohold: null, 'cluster.view': null, 'adas.lka': null, cruise: null,
  'shortcut.create': null, 'shortcut.delete': null, 'shortcut.list': null,
};

/** Backend commands -> MYRA intents, plus the command types MYRA cannot perform. */
export function fromCloudCommands(cmds: BackendCommand[]): { intents: Intent[]; unsupported: string[] } {
  const intents: Intent[] = [];
  const unsupported: string[] = [];
  for (const c of cmds) {
    const map = COMMAND_MAP[c.type];
    const out = map ? map(c as Cmd) : [];
    if (out.length) intents.push(...out);
    else unsupported.push(c.type);
  }
  return { intents, unsupported };
}

/** The offline NLU's validated action -> MYRA intents; empty unless the backend decided to execute. */
export function fromNlu(r: NluResult): Intent[] {
  if (r.decision !== 'execute' || !r.action) return [];
  const p = r.action.parameters;
  const steps = p.amount === 'large' ? 3 : p.amount === 'medium' ? 2 : 1;
  switch (r.action.intent) {
    case 'climate_temperature_up': return repeat(steps, { type: 'climate.tempUp' });
    case 'climate_temperature_down': return repeat(steps, { type: 'climate.tempDown' });
    case 'climate_temperature_set': return p.target_temperature_celsius != null ? [{ type: 'climate.set', value: p.target_temperature_celsius }] : [];
    case 'climate_fan_speed_up': return repeat(steps, { type: 'climate.fanUp' });
    case 'climate_fan_speed_down': return repeat(steps, { type: 'climate.fanDown' });
    case 'climate_on': return [{ type: 'climate.acOn' }];
    case 'climate_off': return [{ type: 'climate.acOff' }];
    case 'volume_up': return repeat(steps, { type: 'media.volUp' });
    case 'volume_down': return repeat(steps, { type: 'media.volDown' });
    case 'media_play': return [{ type: 'media.play' }];
    case 'media_pause': return [{ type: 'media.pause' }];
    case 'media_next': return [{ type: 'media.next' }];
    case 'media_previous': return [{ type: 'media.prev' }];
    case 'navigation_destination_request': return p.destination ? [destinationIntent(p.destination)] : [];
    default: return [];
  }
}
