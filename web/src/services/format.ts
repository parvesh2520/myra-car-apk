import type { SettingsState, UiLanguage } from '../types';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function formatTemp(c: number, unit: SettingsState['tempUnit'], withUnit = false): string {
  const value = unit === 'F' ? Math.round((c * 9) / 5 + 32) : Number.isInteger(c) ? c : c.toFixed(1);
  return `${value}°${withUnit ? unit : ''}`;
}

export function formatDistance(km: number, unit: SettingsState['distanceUnit']): string {
  const v = unit === 'mi' ? km * 0.621371 : km;
  if (unit === 'km' && v < 1) return `${Math.round(v * 1000)} m`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${unit}`;
}

export function formatClock(d: Date, h24: boolean): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: !h24 });
}

export function formatDate(d: Date, lang: UiLanguage): string {
  return d.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatMinutes(min: number): string {
  const m = Math.max(1, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function relativeTime(at: number, now = Date.now()): string {
  const min = Math.round((now - at) / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';
export function dayPart(d: Date): DayPart {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
