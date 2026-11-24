import { AirVent, Fan, Flame, Link2, Minus, Plus, Power, RefreshCw, Snowflake, Sparkles } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { FAN_MAX, TEMP_MAX, TEMP_MIN } from '../../context/actions';
import { useT } from '../../hooks/useT';
import { OUTSIDE_TEMP_C } from '../../data/defaults';
import { formatTemp } from '../../services/format';
import { DemoTag } from '../../components/controls/DemoTag';
import type { Zone } from '../../types';

export function ClimatePage() {
  const { climate, settings } = useAppState();
  const actions = useActions();
  const t = useT();
  const off = !climate.ac && climate.fan === 0;

  return (
    <div className="h-full p-5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)] gap-4">
      <ZonePanel zone="driver" />

      <section className="card p-5 flex flex-col gap-4 min-h-0" aria-label="Climate modes">
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-2">
            Outside <span className="text-ink font-medium">{formatTemp(OUTSIDE_TEMP_C, settings.tempUnit)}</span> <span className="text-ink-3">(demo)</span>
          </p>
          <p className={`text-sm font-semibold ${off ? 'text-ink-3' : 'text-accent'}`} aria-live="polite">
            {off ? 'Climate off' : climate.auto ? 'AUTO climate' : climate.ac ? 'Cooling' : 'Ventilation only'}
          </p>
        </div>

        <div className="grid grid-cols-5 gap-2">
          <ModeButton icon={Sparkles} label={t('auto')} active={climate.auto} onClick={() => actions.climate.toggle('auto')} />
          <ModeButton icon={Snowflake} label="A/C" active={climate.ac} onClick={() => actions.climate.setAc(!climate.ac)} />
          <ModeButton icon={Link2} label={t('sync')} active={climate.sync} onClick={() => actions.climate.toggle('sync')} />
          <ModeButton icon={RefreshCw} label="Recirc" active={climate.recirculation} onClick={() => actions.climate.toggle('recirculation')} />
          <ModeButton icon={Power} label="OFF" active={off} onClick={off ? () => actions.climate.setAc(true) : actions.climate.off} tone="muted" />
        </div>

        <AirflowSelector />

        <div className="card-inset p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="label flex items-center gap-2">
              <Fan size={14} aria-hidden /> {t('fan')} {climate.auto && <span className="tag tag-accent">AUTO</span>}
            </p>
            <p className="text-sm font-semibold text-ink tabular-nums">
              {climate.fan === 0 ? 'Off' : `${climate.fan} / ${FAN_MAX}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className="icon-btn !rounded-full" onClick={() => actions.climate.adjustFan(-1)} disabled={climate.fan <= 0} aria-label="Fan slower">
              <Minus size={20} />
            </button>
            <div className="flex-1 flex items-end gap-1.5 h-12" role="radiogroup" aria-label="Fan speed">
              {Array.from({ length: FAN_MAX }, (_, i) => {
                const level = i + 1;
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={climate.fan === level}
                    aria-label={`Fan ${level}`}
                    onClick={() => actions.climate.setFan(level)}
                    className={`flex-1 rounded-md transition-colors ${level <= climate.fan ? 'bg-accent' : 'bg-surface-3 hover:bg-line-strong'}`}
                    style={{ height: `${35 + (i / (FAN_MAX - 1)) * 65}%` }}
                  />
                );
              })}
            </div>
            <button type="button" className="icon-btn !rounded-full" onClick={() => actions.climate.adjustFan(1)} disabled={climate.fan >= FAN_MAX} aria-label="Fan faster">
              <Plus size={20} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-auto">
          <DefogButton label="Front defogger" active={climate.frontDefog} onClick={() => actions.climate.toggle('frontDefog')} front />
          <DefogButton label="Rear defogger" active={climate.rearDefog} onClick={() => actions.climate.toggle('rearDefog')} />
        </div>
      </section>

      <ZonePanel zone="passenger" />
    </div>
  );
}

function ZonePanel({ zone }: { zone: Zone }) {
  const { climate, settings } = useAppState();
  const actions = useActions();
  const t = useT();
  const z = climate[zone];
  const pct = ((z.temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100;
  const linked = zone === 'passenger' && climate.sync;

  return (
    <section className="card p-5 flex flex-col gap-4 min-h-0" aria-label={`${t(zone)} zone`}>
      <header className="flex items-center justify-between">
        <h2 className="label">{t(zone)}</h2>
        {linked && <span className="tag tag-accent"><Link2 size={10} aria-hidden /> Synced</span>}
      </header>

      <div className="flex-1 flex items-center gap-4">
        <div className="flex flex-col gap-3">
          <button type="button" className="icon-btn !rounded-full !size-16" onClick={() => actions.climate.adjustTemp(0.5, zone)} disabled={z.temp >= TEMP_MAX} aria-label={`Raise ${zone} temperature`}>
            <Plus size={26} />
          </button>
          <button type="button" className="icon-btn !rounded-full !size-16" onClick={() => actions.climate.adjustTemp(-0.5, zone)} disabled={z.temp <= TEMP_MIN} aria-label={`Lower ${zone} temperature`}>
            <Minus size={26} />
          </button>
        </div>
        <div className="flex-1 text-center" aria-live="polite">
          <p className="text-[5.25rem] font-extralight leading-none text-ink tabular-nums tracking-tighter">{formatTemp(z.temp, settings.tempUnit)}</p>
          <p className="text-sm text-ink-2 mt-2">{settings.tempUnit === 'C' ? `${TEMP_MIN}–${TEMP_MAX} °C` : '61–86 °F'}</p>
        </div>
        <div className="relative w-3 h-48 rounded-full bg-gradient-to-t from-[#4d9eff] via-[#9ab7d6] to-[#f08a5d]" aria-hidden>
          <span className="absolute left-1/2 -translate-x-1/2 size-5 rounded-full bg-white border-4 border-surface shadow transition-[bottom] duration-300" style={{ bottom: `calc(${pct}% - 10px)` }} />
        </div>
      </div>

      <div className="card-inset p-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="label">Seat comfort</p>
          <DemoTag>Simulated hardware</DemoTag>
        </div>
        <SeatControl zone={zone} kind="seatHeat" level={z.seatHeat} />
        <SeatControl zone={zone} kind="seatVent" level={z.seatVent} />
      </div>
    </section>
  );
}

function SeatControl({ zone, kind, level }: { zone: Zone; kind: 'seatHeat' | 'seatVent'; level: number }) {
  const actions = useActions();
  const heat = kind === 'seatHeat';
  const Icon = heat ? Flame : AirVent;
  return (
    <div className="flex items-center gap-3">
      <Icon size={18} className={level ? (heat ? 'text-[#f08a5d]' : 'text-accent') : 'text-ink-3'} aria-hidden />
      <span className="text-sm text-ink w-24">{heat ? 'Heating' : 'Ventilation'}</span>
      <div className="flex-1 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={`${zone} seat ${heat ? 'heating' : 'ventilation'}`}>
        {[0, 1, 2, 3].map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={level === l}
            onClick={() => actions.climate.setSeat(zone, kind, l)}
            className={`h-9 rounded-lg text-xs font-semibold transition-colors ${
              level === l ? (heat && l ? 'bg-[#f08a5d] text-[#1d0f05]' : l ? 'bg-accent text-on-accent' : 'bg-surface-3 text-ink') : 'bg-surface text-ink-2 hover:text-ink border border-line'
            }`}
          >
            {l === 0 ? 'Off' : l}
          </button>
        ))}
      </div>
    </div>
  );
}

function ModeButton({ icon: Icon, label, active, onClick, tone }: { icon: typeof Fan; label: string; active: boolean; onClick: () => void; tone?: 'muted' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-[74px] rounded-2xl flex flex-col items-center justify-center gap-1.5 border transition-colors ${
        active
          ? tone === 'muted'
            ? 'bg-surface-3 border-line-strong text-ink'
            : 'bg-accent-soft border-accent/50 text-accent'
          : 'bg-surface-2 border-line text-ink-2 hover:text-ink'
      }`}
    >
      <Icon size={22} aria-hidden />
      <span className="text-xs font-bold tracking-wide">{label}</span>
      <span className={`size-1.5 rounded-full ${active ? 'bg-current' : 'bg-transparent'}`} aria-hidden />
    </button>
  );
}

function DefogButton({ label, active, onClick, front }: { label: string; active: boolean; onClick: () => void; front?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-16 rounded-2xl flex items-center justify-center gap-3 border font-medium transition-colors ${
        active ? 'bg-warn/15 border-warn/50 text-warn' : 'bg-surface-2 border-line text-ink-2 hover:text-ink'
      }`}
    >
      <svg viewBox="0 0 28 20" className="w-7 h-5" aria-hidden>
        {front ? (
          <path d="M3 16 C 6 6, 22 6, 25 16 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        ) : (
          <rect x="3" y="4" width="22" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
        )}
        <path d={front ? 'M10 9v5M14 8v6M18 9v5' : 'M8 8.5h12M8 12.5h12'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {label}
      <span className="text-[0.625rem] font-bold">{active ? 'ON' : 'OFF'}</span>
    </button>
  );
}

/** Airflow direction: tap the arrows on the occupant figure or the labelled buttons. */
function AirflowSelector() {
  const { climate } = useAppState();
  const actions = useActions();
  const { airflow } = climate;
  const arrow = (on: boolean) => (on ? 'var(--color-accent)' : 'var(--color-ink-3)');

  return (
    <div className="card-inset p-3 flex items-center gap-4">
      <svg viewBox="0 0 220 150" className="w-[220px] h-[150px] shrink-0" role="img" aria-label="Airflow diagram">
        {/* windshield */}
        <path d="M150 8 L 205 70" stroke="var(--color-line-strong)" strokeWidth="5" strokeLinecap="round" />
        {/* occupant */}
        <circle cx="70" cy="34" r="13" fill="var(--color-surface-3)" />
        <path d="M58 52 h22 q8 0 8 9 v34 h30 q10 0 10 10 v28 h-14 v-24 h-48 q-8 0 -8 -8 Z" fill="var(--color-surface-3)" />
        <path d="M40 48 q-6 30 4 72 h16" fill="none" stroke="var(--color-line-strong)" strokeWidth="6" strokeLinecap="round" />
        {/* arrows */}
        <g stroke={arrow(airflow.windshield)} strokeWidth="4" strokeLinecap="round" fill="none" style={{ transition: 'stroke 200ms' }}>
          <path d="M190 112 C 175 80 165 58 168 34" />
          <path d="M160 40 l8 -8 l6 10" />
        </g>
        <g stroke={arrow(airflow.face)} strokeWidth="4" strokeLinecap="round" fill="none" style={{ transition: 'stroke 200ms' }}>
          <path d="M190 112 C 150 70 120 44 96 38" />
          <path d="M104 31 l-9 7 l9 6" />
        </g>
        <g stroke={arrow(airflow.feet)} strokeWidth="4" strokeLinecap="round" fill="none" style={{ transition: 'stroke 200ms' }}>
          <path d="M190 118 C 170 130 150 138 126 140" />
          <path d="M133 134 l-8 6 l8 6" />
        </g>
        <circle cx="192" cy="114" r="6" fill="var(--color-surface-3)" stroke="var(--color-line-strong)" />
      </svg>
      <div className="flex-1 flex flex-col gap-2" role="group" aria-label="Air direction">
        {([
          ['windshield', 'Windshield'],
          ['face', 'Face'],
          ['feet', 'Feet'],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={airflow[key]} onClick={() => actions.climate.toggleAirflow(key)} className="chip !min-h-11 justify-between">
            {label}
            <span className="text-[0.625rem] font-bold">{airflow[key] ? 'ON' : 'OFF'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
