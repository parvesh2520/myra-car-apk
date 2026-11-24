import { Briefcase, ChevronRight, CornerUpLeft, CornerUpRight, Flag, House, MapPin, X } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { activeProfile } from '../../context/actions';
import { useRoute } from '../../hooks/useRoute';
import { useT } from '../../hooks/useT';
import { placeById } from '../../data/places';
import { formatDistance, formatMinutes } from '../../services/format';
import { nextManoeuvre } from '../../services/routing';
import { MapView } from '../../components/map/MapView';
import { DemoTag } from '../../components/controls/DemoTag';
import { Eta } from '../../components/cards/Eta';

export function NavigationCard({ className = '', large = false }: { className?: string; large?: boolean }) {
  const state = useAppState();
  const actions = useActions();
  const t = useT();
  const { destination, route, remainingKm, remainingMin } = useRoute();
  const profile = activeProfile(state);
  const { settings, nav } = state;
  const home = placeById(profile.homeId);
  const work = placeById(profile.workId);
  const recents = nav.recents.map(placeById).filter((p) => p && p.category !== 'home' && p.category !== 'work').slice(0, large ? 2 : 3);
  const step = route ? nextManoeuvre(route, nav.progress) : null;

  const go = (id: string) => {
    actions.nav.setDestination(id);
    if (!large) actions.ui.go('navigation');
  };

  return (
    <section className={`card overflow-hidden flex flex-col ${className}`} aria-label={t('navigation')}>
      <button
        type="button"
        onClick={() => actions.ui.go('navigation')}
        className="relative flex-1 min-h-0 text-left"
        aria-label="Open navigation"
      >
        <MapView dense={false} insetTop={step && large ? 140 : 44} />
        <div className="absolute inset-x-0 top-0 p-4 flex items-start justify-between bg-gradient-to-b from-surface/90 to-transparent">
          <span className="label !text-ink-2">{t('navigation')}</span>
          <DemoTag>Simulated map</DemoTag>
        </div>
        {step && large && (
          <div className="absolute left-4 top-12 rounded-2xl bg-accent text-on-accent shadow-[0_12px_30px_-10px_rgb(0_0_0/0.6)] flex items-center gap-3 px-4 py-3" role="status">
            {step.turn === 'left' ? <CornerUpLeft size={30} /> : step.turn === 'right' ? <CornerUpRight size={30} /> : <Flag size={28} />}
            <div>
              <p className="text-2xl font-bold leading-none tabular-nums">{formatDistance(step.distanceKm, settings.distanceUnit)}</p>
              <p className="text-sm font-medium opacity-90 mt-1">{step.turn === 'arrive' ? `Arrive at ${destination?.name}` : `Turn ${step.turn} onto ${step.street}`}</p>
            </div>
          </div>
        )}
      </button>

      <div className="p-4 pt-3 border-t border-line">
        {destination && route ? (
          <div className="flex items-center gap-4">
            <span className="grid place-items-center size-11 rounded-xl bg-ok/15 text-ok shrink-0">
              <MapPin size={20} aria-hidden />
            </span>
            <div className="flex-1 min-w-0">
              <p className={`${large ? 'text-xl' : 'text-lg'} font-semibold text-ink truncate`}>{destination.name}</p>
              <p className="text-sm text-ink-2 truncate">via {route.via}</p>
            </div>
            <dl className="flex gap-5 text-right shrink-0">
              <div>
                <dt className="label">{t('arrive')}</dt>
                <dd className={`${large ? 'text-2xl' : 'text-xl'} font-semibold text-ink tabular-nums`}>
                  <Eta minutes={remainingMin} />
                </dd>
              </div>
              <div>
                <dt className="label">{t('remaining')}</dt>
                <dd className={`${large ? 'text-2xl' : 'text-xl'} font-semibold text-ink tabular-nums`}>
                  {formatDistance(remainingKm, settings.distanceUnit)}
                </dd>
                <dd className="text-xs text-ink-2">{formatMinutes(remainingMin)}</dd>
              </div>
            </dl>
            <button type="button" onClick={actions.nav.cancel} className="icon-btn shrink-0" aria-label={t('endRoute')}>
              <X size={20} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold text-ink">{t('whereTo')}</p>
              <button type="button" className="text-sm text-accent flex items-center gap-1" onClick={() => actions.ui.go('navigation')}>
                Search <ChevronRight size={15} aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ShortcutTile icon={House} label={t('home_')} place={home?.name} onClick={home ? () => go(home.id) : () => actions.ui.go('settings', 'profiles')} />
              <ShortcutTile icon={Briefcase} label={t('work')} place={work?.name} onClick={work ? () => go(work.id) : () => actions.ui.go('settings', 'profiles')} />
            </div>
            {recents.length > 0 && (
              <div className="flex gap-2 overflow-hidden" aria-label={t('recent')}>
                {recents.map((p) => (
                  <button key={p!.id} type="button" className="chip" onClick={() => go(p!.id)}>
                    <MapPin size={14} aria-hidden /> {p!.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ShortcutTile({ icon: Icon, label, place, onClick }: { icon: typeof House; label: string; place?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="tile flex items-center gap-3 p-3 min-h-[60px]">
      <span className="grid place-items-center size-10 rounded-xl bg-accent-soft text-accent shrink-0">
        <Icon size={19} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.9375rem] font-semibold text-ink">{label}</span>
        <span className="block text-xs text-ink-2 truncate">{place ?? 'Not set — tap to add'}</span>
      </span>
    </button>
  );
}
