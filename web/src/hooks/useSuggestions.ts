import { useMemo } from 'react';
import { CircleGauge, Heart, House, Briefcase, MapPin, PhoneMissed, Play, Snowflake, Fuel, CircleLetterP, type LucideIcon } from 'lucide-react';
import { useActions, useAppState } from '../context/AppStore';
import { activeProfile } from '../context/actions';
import { playlistById } from '../data/media';
import { placeById, PLACES } from '../data/places';
import { contactById } from '../data/contacts';
import { OUTSIDE_TEMP_C, TYRE_RANGE } from '../data/defaults';
import { computeRoute } from '../services/routing';
import { dayPart, formatMinutes } from '../services/format';

export interface Suggestion {
  id: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  action: string;
  run: () => void;
  tone?: 'accent' | 'warn' | 'ok';
}

const TYRE_NAMES = { fl: 'Front-left', fr: 'Front-right', rl: 'Rear-left', rr: 'Rear-right' } as const;

/** Context-aware cards derived purely from the local (simulated) state. */
export function useSuggestions(limit = 4): Suggestion[] {
  const state = useAppState();
  const actions = useActions();

  return useMemo(() => {
    const out: Suggestion[] = [];
    const { climate, media, nav, vehicle, phone } = state;
    const profile = activeProfile(state);
    const origin = placeById(nav.originId) ?? PLACES[0];
    const part = dayPart(new Date());

    // Comfort
    if (!climate.ac || climate.driver.temp > profile.preferredTemp + 1) {
      out.push({
        id: 'cool',
        icon: Snowflake,
        title: 'Would you like to cool the cabin?',
        detail: `It’s ${OUTSIDE_TEMP_C}° outside (demo). Set AC to your usual ${profile.preferredTemp}°.`,
        action: `Set ${profile.preferredTemp}°`,
        run: () => {
          actions.climate.setTemp(profile.preferredTemp);
          actions.climate.setAc(true);
          actions.ui.toast(`Cabin set to ${profile.preferredTemp}°`, 'success');
        },
        tone: 'accent',
      });
    }

    // Navigation
    if (!nav.destinationId) {
      const preferWork = part === 'morning' && profile.workId;
      const id = preferWork ? profile.workId : profile.homeId;
      const place = placeById(id);
      if (place && place.id !== origin.id) {
        const r = computeRoute(origin, place, nav.routePref, nav.avoidTolls);
        out.push({
          id: 'commute',
          icon: preferWork ? Briefcase : House,
          title: preferWork ? 'Heading to work?' : 'Your saved Home destination is available',
          detail: `${place.name} · about ${formatMinutes(r.durationMin)} (simulated)`,
          action: 'Go',
          run: () => {
            actions.nav.setDestination(place.id);
            actions.ui.go('navigation');
          },
          tone: 'ok',
        });
      }
      const recent = nav.recents.map(placeById).find((p) => p && p.category !== 'home' && p.category !== 'work' && p.id !== origin.id);
      if (recent) {
        out.push({
          id: 'recent-dest',
          icon: MapPin,
          title: 'Your recent destination is ready',
          detail: `${recent.name} · ${recent.area}`,
          action: 'Route',
          run: () => {
            actions.nav.setDestination(recent.id);
            actions.ui.go('navigation');
          },
        });
      }
    } else {
      const dest = placeById(nav.destinationId);
      if (dest && dest.category !== 'parking' && dest.category !== 'fuel') {
        out.push({
          id: 'parking',
          icon: CircleLetterP,
          title: `Parking near ${dest.name}`,
          detail: 'See sample parking options along the route',
          action: 'Show',
          run: () => actions.ui.go('navigation', 'parking'),
        });
      }
    }

    // Media
    const pl = playlistById(media.playlistId);
    const track = pl.tracks[media.trackIndex];
    if (!media.playing && track) {
      out.push({
        id: 'resume',
        icon: Play,
        title: `Continue your ${pl.name} playlist`,
        detail: `“${track.title}” · ${track.artist}`,
        action: 'Play',
        run: () => actions.media.play(),
        tone: 'accent',
      });
    } else if (track && media.source !== 'radio' && !media.favourites.includes(track.id)) {
      out.push({
        id: 'fav',
        icon: Heart,
        title: 'Enjoying this track?',
        detail: `Save “${track.title}” to favourites`,
        action: 'Save',
        run: () => {
          actions.media.toggleFavourite(track.id);
          actions.ui.toast(`Added “${track.title}” to favourites`, 'success');
        },
      });
    }

    // Vehicle
    const low = (Object.keys(vehicle.tyres) as (keyof typeof vehicle.tyres)[]).find((k) => vehicle.tyres[k] < TYRE_RANGE.min);
    if (low) {
      out.push({
        id: 'tyre',
        icon: CircleGauge,
        title: `${TYRE_NAMES[low]} tyre pressure is low`,
        detail: `${vehicle.tyres[low]} psi · recommended ${TYRE_RANGE.recommended} psi (simulated)`,
        action: 'View',
        run: () => actions.ui.go('vehicle', 'tyres'),
        tone: 'warn',
      });
    }
    if (vehicle.fuelPct < 20) {
      out.push({
        id: 'fuel',
        icon: Fuel,
        title: 'Fuel is running low',
        detail: `${Math.round(vehicle.fuelPct)}% left — find a nearby fuel station`,
        action: 'Find',
        run: () => actions.ui.go('navigation', 'fuel'),
        tone: 'warn',
      });
    }

    // Phone
    const missed = phone.recents.find((l) => l.direction === 'missed' && Date.now() - l.at < 8 * 3600_000);
    const missedContact = contactById(missed?.contactId);
    if (missed && missedContact && phone.deviceConnected) {
      out.push({
        id: `missed-${missed.id}`,
        icon: PhoneMissed,
        title: `Missed call from ${missedContact.name}`,
        detail: 'Call back hands-free (simulated)',
        action: 'Call',
        run: () => actions.phone.call(missedContact.id),
      });
    }

    return out.slice(0, limit);
  }, [state, actions, limit]);
}
