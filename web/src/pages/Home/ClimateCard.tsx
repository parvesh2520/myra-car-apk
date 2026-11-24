import { ChevronRight, Fan, Link2, Minus, Plus, RefreshCw, Snowflake, Wind } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { FAN_MAX, TEMP_MAX, TEMP_MIN } from '../../context/actions';
import { useT } from '../../hooks/useT';
import { formatTemp } from '../../services/format';
import { Toggle } from '../../components/controls/Toggle';

/** Home climate shortcut — reads and writes the same shared climate state as the Climate page and Myra. */
export function ClimateCard({ large = false }: { large?: boolean }) {
  const { climate, settings } = useAppState();
  const actions = useActions();
  const t = useT();
  const { driver } = climate;

  return (
    <section className="card p-4 flex flex-col gap-3" aria-label={t('climate')}>
      <header className="flex items-center justify-between">
        <button type="button" onClick={() => actions.ui.go('climate')} className="label flex items-center gap-1 hover:text-ink-2">
          {t('climate')} <ChevronRight size={13} aria-hidden />
        </button>
        <div className="flex items-center gap-2.5">
          <span className={`text-xs font-bold tracking-wide ${climate.ac ? 'text-accent' : 'text-ink-3'}`}>
            <Snowflake size={13} className="inline -mt-0.5 mr-1" aria-hidden />
            A/C {climate.ac ? 'ON' : 'OFF'}
          </span>
          <Toggle checked={climate.ac} onChange={actions.climate.setAc} label="Air conditioning" />
        </div>
      </header>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className={`icon-btn !rounded-full ${large ? '!size-16' : '!size-14'}`}
          onClick={() => actions.climate.adjustTemp(-0.5)}
          disabled={driver.temp <= TEMP_MIN}
          aria-label="Lower temperature"
        >
          <Minus size={24} />
        </button>
        <div className="text-center" aria-live="polite">
          <p className={`${large ? 'text-[3.5rem]' : 'text-[2.75rem]'} font-light leading-none text-ink tabular-nums tracking-tight`}>
            {formatTemp(driver.temp, settings.tempUnit)}
          </p>
          <p className="text-xs text-ink-2 mt-1">
            {climate.sync ? `${t('driver')} + ${t('passenger')}` : t('driver')} {climate.auto && '· AUTO'}
          </p>
        </div>
        <button
          type="button"
          className={`icon-btn !rounded-full ${large ? '!size-16' : '!size-14'}`}
          onClick={() => actions.climate.adjustTemp(0.5)}
          disabled={driver.temp >= TEMP_MAX}
          aria-label="Raise temperature"
        >
          <Plus size={24} />
        </button>
      </div>

      <div className="flex items-center justify-center gap-2" role="group" aria-label="Quick climate modes">
        <button type="button" className="chip !min-h-9" aria-pressed={climate.sync} onClick={() => actions.climate.toggle('sync')}>
          <Link2 size={14} aria-hidden /> {t('sync')}
        </button>
        <button type="button" className="chip !min-h-9" aria-pressed={climate.recirculation} onClick={() => actions.climate.toggle('recirculation')}>
          <RefreshCw size={14} aria-hidden /> Recirc
        </button>
        <button type="button" className="chip !min-h-9" aria-pressed={climate.frontDefog} onClick={() => actions.climate.toggle('frontDefog')}>
          <Wind size={14} aria-hidden /> Defog
        </button>
      </div>

      <div className="mt-auto flex items-center gap-2">
        <button type="button" className="icon-btn !size-11" onClick={() => actions.climate.adjustFan(-1)} disabled={climate.fan <= 0} aria-label="Fan slower">
          <Minus size={16} />
        </button>
        <div className="flex-1 flex items-center gap-2" aria-label={`Fan speed ${climate.fan} of ${FAN_MAX}${climate.auto ? ', auto' : ''}`} role="img">
          <Fan size={18} className="text-ink-2 shrink-0" aria-hidden />
          <div className="flex-1 flex gap-1 items-end h-5">
            {Array.from({ length: FAN_MAX }, (_, i) => (
              <span
                key={i}
                className={`flex-1 rounded-sm transition-colors ${i < climate.fan ? 'bg-accent' : 'bg-surface-3'}`}
                style={{ height: `${40 + (i / (FAN_MAX - 1)) * 60}%` }}
              />
            ))}
          </div>
          <span className="w-6 text-right text-sm font-semibold text-ink tabular-nums">{climate.fan}</span>
        </div>
        <button type="button" className="icon-btn !size-11" onClick={() => actions.climate.adjustFan(1)} disabled={climate.fan >= FAN_MAX} aria-label="Fan faster">
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="chip !min-h-11"
          aria-pressed={climate.auto}
          onClick={() => actions.climate.toggle('auto')}
        >
          {t('auto')}
        </button>
      </div>
    </section>
  );
}
