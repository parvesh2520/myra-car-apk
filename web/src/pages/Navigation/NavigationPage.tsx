import { useMemo, useState, type ReactNode } from 'react';
import {
  Briefcase, CircleLetterP, Clock, CornerUpLeft, CornerUpRight, Flag, Fuel, House, Info, LocateFixed, MapPin, Mic, Minus, Plus, Search, Star, X,
} from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { activeProfile } from '../../context/actions';
import { useAssistant } from '../../context/AssistantContext';
import { useRoute } from '../../hooks/useRoute';
import { useT } from '../../hooks/useT';
import { PLACES, placeById, searchPlaces } from '../../data/places';
import { computeRoute, nextManoeuvre } from '../../services/routing';
import { formatDistance, formatMinutes } from '../../services/format';
import { MapView } from '../../components/map/MapView';
import { Segmented } from '../../components/controls/Segmented';
import { Toggle } from '../../components/controls/Toggle';
import { DemoTag } from '../../components/controls/DemoTag';
import { Eta } from '../../components/cards/Eta';
import type { Place, PlaceCategory, RoutePreference } from '../../types';

type Tab = 'recent' | 'saved' | 'fuel' | 'parking';

export function NavigationPage() {
  const state = useAppState();
  const actions = useActions();
  const t = useT();
  const assistant = useAssistant();
  const { origin, destination, route, remainingKm, remainingMin } = useRoute();
  const { nav, settings, driveMode, pageSection } = state;
  const driving = driveMode === 'driving';
  const profile = activeProfile(state);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>(pageSection === 'fuel' || pageSection === 'parking' ? pageSection : 'recent');
  const [zoom, setZoom] = useState(1);

  const results = useMemo(() => searchPlaces(query), [query]);
  const lists: Record<Tab, Place[]> = {
    recent: nav.recents.map(placeById).filter((p): p is Place => !!p),
    saved: nav.saved.map(placeById).filter((p): p is Place => !!p),
    fuel: PLACES.filter((p) => p.category === 'fuel'),
    parking: PLACES.filter((p) => p.category === 'parking'),
  };
  const poiCategory: PlaceCategory | null = tab === 'fuel' || tab === 'parking' ? tab : null;
  const home = placeById(profile.homeId);
  const work = placeById(profile.workId);
  const step = route ? nextManoeuvre(route, nav.progress) : null;

  const choose = (id: string) => {
    actions.nav.setDestination(id);
    setQuery('');
    setZoom(1);
  };

  const distanceTo = (p: Place) => computeRoute(origin, p, nav.routePref, nav.avoidTolls).distanceKm;

  return (
    <div className="relative h-full">
      <div className="absolute inset-0">
        <MapView zoom={zoom} showCategory={poiCategory} onSelectPlace={choose} insetLeft={440} insetTop={step ? 110 : 0} />
      </div>

      {/* Left panel */}
      <aside className="absolute left-5 top-5 bottom-5 w-[400px] flex flex-col gap-3 z-10" aria-label="Navigation panel">
        {driving ? (
          <button type="button" onClick={assistant.listen} className="card h-14 flex items-center gap-3 px-4 text-left hover:border-accent/50">
            <Mic size={20} className="text-accent" aria-hidden />
            <span className="text-ink-2">Say a destination — “Airport le chalo”</span>
          </button>
        ) : (
          <div className="card p-2 relative">
            <label htmlFor="dest-search" className="sr-only">
              {t('searchPlaces')}
            </label>
            <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              id="dest-search"
              className="input !pl-11 !pr-11 !bg-transparent !border-transparent focus:!border-accent"
              placeholder={`${t('searchPlaces')} — try “IIT”, “Airport”, “Marina”`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 size-8 grid place-items-center text-ink-3 hover:text-ink" aria-label="Clear search">
                <X size={16} />
              </button>
            )}
          </div>
        )}

        {query ? (
          <div className="card p-2 scroll-y min-h-0" role="listbox" aria-label="Search results">
            {results.length === 0 && <p className="p-4 text-sm text-ink-2">No sample destinations match “{query}”.</p>}
            {results.map((p) => (
              <PlaceRow key={p.id} place={p} km={distanceTo(p)} onGo={() => choose(p.id)} />
            ))}
          </div>
        ) : destination && route ? (
          <section className="card p-5 flex flex-col gap-4 anim-fade" aria-label="Active route">
            <div className="flex items-start gap-3">
              <span className="grid place-items-center size-11 rounded-xl bg-ok/15 text-ok shrink-0">
                <Flag size={20} aria-hidden />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xl font-semibold text-ink truncate">{destination.name}</p>
                <p className="text-sm text-ink-2 truncate">{destination.area}</p>
              </div>
              <button
                type="button"
                className={`icon-btn !size-10 ${nav.saved.includes(destination.id) ? '!text-warn' : ''}`}
                onClick={() => actions.nav.toggleSaved(destination.id)}
                aria-pressed={nav.saved.includes(destination.id)}
                aria-label={nav.saved.includes(destination.id) ? 'Remove from saved places' : 'Save place'}
              >
                <Star size={18} fill={nav.saved.includes(destination.id) ? 'currentColor' : 'none'} />
              </button>
            </div>
            <dl className="grid grid-cols-3 gap-2">
              <Stat label={t('arrive')} value={<Eta minutes={remainingMin} />} />
              <Stat label="Time" value={formatMinutes(remainingMin)} />
              <Stat label={t('remaining')} value={formatDistance(remainingKm, settings.distanceUnit)} />
            </dl>
            <div className="text-sm text-ink-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>via <span className="text-ink">{route.via}</span></span>
              {route.toll && <span className="tag">Toll on route</span>}
              <span className="text-ink-3">From {origin.name}</span>
            </div>
            {!driving && (
              <>
                <Segmented<RoutePreference>
                  label="Route preference"
                  value={nav.routePref}
                  onChange={actions.nav.setRoutePref}
                  options={[
                    { value: 'fastest', label: 'Fastest' },
                    { value: 'shortest', label: 'Shortest' },
                    { value: 'eco', label: 'Eco' },
                  ]}
                />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink">Avoid tolls</span>
                  <Toggle checked={nav.avoidTolls} onChange={actions.nav.toggleAvoidTolls} label="Avoid tolls" />
                </div>
              </>
            )}
            <button type="button" className="btn btn-danger" onClick={actions.nav.cancel}>
              <X size={18} aria-hidden /> {t('endRoute')}
            </button>
            <p className="flex items-start gap-2 text-xs text-ink-3">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
              Simulated route on a stylised map — no live GPS or traffic. {driving ? 'Progress advances in the Driving demo.' : 'Switch the demo to Driving to watch the route progress.'}
            </p>
          </section>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <QuickTile icon={House} label={t('home_')} place={home} onGo={choose} />
              <QuickTile icon={Briefcase} label={t('work')} place={work} onGo={choose} />
            </div>
            <section className="card p-2 flex flex-col min-h-0 flex-1" aria-label="Places">
              <div role="tablist" aria-label="Place lists" className="flex gap-1.5 p-1.5">
                {([
                  ['recent', t('recent'), Clock],
                  ['saved', t('saved'), Star],
                  ['fuel', t('fuel'), Fuel],
                  ['parking', t('parking'), CircleLetterP],
                ] as const).map(([id, label, Icon]) => (
                  <button key={id} role="tab" aria-selected={tab === id} type="button" className="chip flex-1 justify-center !px-2" onClick={() => setTab(id)}>
                    <Icon size={15} aria-hidden /> {label}
                  </button>
                ))}
              </div>
              <div className="scroll-y min-h-0 flex-1 px-1 pb-1" role="tabpanel">
                {lists[tab].length === 0 && <p className="p-4 text-sm text-ink-2">Nothing here yet.</p>}
                {lists[tab].map((p) => (
                  <PlaceRow key={p.id} place={p} km={distanceTo(p)} onGo={() => choose(p.id)} saved={nav.saved.includes(p.id)} onToggleSave={driving ? undefined : () => actions.nav.toggleSaved(p.id)} />
                ))}
                {(tab === 'fuel' || tab === 'parking') && (
                  <p className="px-3 py-2 text-xs text-ink-3">Sample {tab === 'fuel' ? 'fuel stations' : 'parking facilities'} — availability is not live.</p>
                )}
              </div>
            </section>
          </>
        )}
      </aside>

      {/* Turn-by-turn banner */}
      {step && (
        <div className="absolute left-[440px] right-[100px] top-5 flex justify-center z-10 pointer-events-none">
          <div className="rounded-2xl bg-accent text-on-accent shadow-[0_12px_30px_-10px_rgb(0_0_0/0.6)] flex items-center gap-4 px-5 py-3 pointer-events-auto" role="status">
            {step.turn === 'left' ? <CornerUpLeft size={34} aria-hidden /> : step.turn === 'right' ? <CornerUpRight size={34} aria-hidden /> : <Flag size={30} aria-hidden />}
            <div>
              <p className="text-2xl font-bold leading-none tabular-nums">{formatDistance(step.distanceKm, settings.distanceUnit)}</p>
              <p className="text-sm font-medium opacity-90 mt-1">{step.turn === 'arrive' ? `Arrive at ${destination?.name}` : `Turn ${step.turn} onto ${step.street}`}</p>
            </div>
          </div>
        </div>
      )}

      {/* Map controls */}
      <div className="absolute right-5 top-5 flex flex-col gap-2 z-10">
        <button type="button" className="icon-btn !size-12 shadow-lg" onClick={() => setZoom((z) => Math.min(3, z + 0.5))} aria-label="Zoom in">
          <Plus size={20} />
        </button>
        <button type="button" className="icon-btn !size-12 shadow-lg" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="Zoom out">
          <Minus size={20} />
        </button>
        <button type="button" className="icon-btn !size-12 shadow-lg" onClick={() => setZoom(1)} aria-label="Recentre map">
          <LocateFixed size={20} />
        </button>
      </div>

      <div className="absolute right-5 bottom-5 flex items-center gap-2 z-10">
        <DemoTag>Stylised map · Demo data</DemoTag>
        <button type="button" onClick={() => assistant.submit(profile.homeId ? 'Ghar le chalo' : 'Airport le chalo')} className="chip !bg-surface shadow-lg">
          <Mic size={14} className="text-accent" aria-hidden /> “{profile.homeId ? 'Ghar le chalo' : 'Airport le chalo'}”
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="card-inset px-3 py-2.5">
      <dt className="label">{label}</dt>
      <dd className="text-lg font-semibold text-ink tabular-nums mt-0.5">{value}</dd>
    </div>
  );
}

function QuickTile({ icon: Icon, label, place, onGo }: { icon: typeof House; label: string; place?: Place; onGo: (id: string) => void }) {
  const actions = useActions();
  return (
    <button
      type="button"
      onClick={() => (place ? onGo(place.id) : actions.ui.go('settings', 'profiles'))}
      className="card flex items-center gap-3 p-3.5 text-left hover:border-line-strong transition-colors"
    >
      <span className="grid place-items-center size-11 rounded-xl bg-accent-soft text-accent shrink-0">
        <Icon size={20} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{label}</span>
        <span className="block text-xs text-ink-2 truncate">{place?.name ?? 'Tap to set'}</span>
      </span>
    </button>
  );
}

const CATEGORY_ICON: Partial<Record<PlaceCategory, typeof MapPin>> = { fuel: Fuel, parking: CircleLetterP, home: House, work: Briefcase };

function PlaceRow({ place, km, onGo, saved, onToggleSave }: { place: Place; km: number; onGo: () => void; saved?: boolean; onToggleSave?: () => void }) {
  const { settings } = useAppState();
  const Icon = CATEGORY_ICON[place.category] ?? MapPin;
  return (
    <div className="flex items-center gap-1 rounded-xl hover:bg-surface-2 transition-colors">
      <button type="button" onClick={onGo} className="flex-1 min-w-0 flex items-center gap-3 p-2.5 text-left" aria-label={`Route to ${place.name}`}>
        <span className={`grid place-items-center size-10 rounded-xl shrink-0 ${place.category === 'fuel' ? 'bg-warn/15 text-warn' : 'bg-surface-3 text-ink-2'}`}>
          <Icon size={18} aria-hidden />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[0.9375rem] font-medium text-ink truncate">{place.name}</span>
          <span className="block text-xs text-ink-2 truncate">{place.detail ? `${place.area} · ${place.detail}` : place.area}</span>
        </span>
        <span className="text-sm text-ink-2 tabular-nums shrink-0">{formatDistance(km, settings.distanceUnit)}</span>
      </button>
      {onToggleSave && (
        <button
          type="button"
          onClick={onToggleSave}
          className={`grid place-items-center size-10 rounded-xl shrink-0 ${saved ? 'text-warn' : 'text-ink-3 hover:text-ink'}`}
          aria-pressed={saved}
          aria-label={saved ? `Unsave ${place.name}` : `Save ${place.name}`}
        >
          <Star size={17} fill={saved ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );
}
