import { ChevronRight, CircleCheck, Fuel, Lock, LockOpen, TriangleAlert } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { useT } from '../../hooks/useT';
import { FULL_TANK_RANGE_KM, TYRE_RANGE } from '../../data/defaults';
import { formatDistance } from '../../services/format';
import { DemoTag } from '../../components/controls/DemoTag';
import type { TyreId } from '../../types';

const TYRE_ORDER: [TyreId, string][] = [
  ['fl', 'FL'],
  ['fr', 'FR'],
  ['rl', 'RL'],
  ['rr', 'RR'],
];

export function VehicleCard() {
  const { vehicle, settings } = useAppState();
  const actions = useActions();
  const t = useT();
  const range = (vehicle.fuelPct / 100) * FULL_TANK_RANGE_KM;
  const lowTyres = TYRE_ORDER.filter(([k]) => vehicle.tyres[k] < TYRE_RANGE.min);
  const healthy = lowTyres.length === 0 && vehicle.fuelPct >= 15;

  return (
    <section className="card p-4 flex flex-col gap-3" aria-label={t('vehicleStatus')}>
      <header className="flex items-center justify-between">
        <button type="button" onClick={() => actions.ui.go('vehicle')} className="label flex items-center gap-1 hover:text-ink-2">
          {t('vehicleStatus')} <ChevronRight size={13} aria-hidden />
        </button>
        <DemoTag>Simulated</DemoTag>
      </header>

      <div className="flex items-end gap-3">
        <Fuel size={20} className="text-ink-2 mb-1" aria-hidden />
        <div className="flex-1">
          <div className="flex items-baseline justify-between">
            <p className="text-2xl font-semibold text-ink tabular-nums">{Math.round(vehicle.fuelPct)}%</p>
            <p className="text-sm text-ink-2 tabular-nums">
              {t('range')} <span className="text-ink font-semibold">{formatDistance(range, settings.distanceUnit)}</span>
            </p>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-surface-3 overflow-hidden" role="meter" aria-label="Fuel level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(vehicle.fuelPct)}>
            <div className={`h-full rounded-full ${vehicle.fuelPct < 20 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${vehicle.fuelPct}%` }} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        {healthy ? <CircleCheck size={17} className="text-ok" aria-hidden /> : <TriangleAlert size={17} className="text-warn" aria-hidden />}
        <span className="text-ink">{healthy ? 'All systems normal' : `${lowTyres.length} item${lowTyres.length === 1 ? ' needs' : 's need'} attention`}</span>
        <span className="ml-auto flex items-center gap-1.5 text-ink-2">
          {vehicle.locked ? <Lock size={14} aria-hidden /> : <LockOpen size={14} className="text-warn" aria-hidden />}
          {vehicle.locked ? 'Locked' : 'Unlocked'}
        </span>
      </div>

      <button type="button" onClick={() => actions.ui.go('vehicle', 'tyres')} className="mt-auto grid grid-cols-4 gap-2" aria-label="Tyre pressures, open tyre details">
        {TYRE_ORDER.map(([k, label]) => {
          const low = vehicle.tyres[k] < TYRE_RANGE.min;
          return (
            <div key={k} className={`rounded-xl px-2 py-2 text-center border ${low ? 'border-warn/50 bg-warn/10' : 'border-line bg-surface-2'}`}>
              <p className="text-[0.625rem] font-bold tracking-wider text-ink-3">{label}</p>
              <p className={`text-base font-semibold tabular-nums ${low ? 'text-warn' : 'text-ink'}`}>
                {vehicle.tyres[k]}
                {low && <TriangleAlert size={11} className="inline ml-0.5 -mt-0.5" aria-label="low" />}
              </p>
            </div>
          );
        })}
      </button>
    </section>
  );
}
