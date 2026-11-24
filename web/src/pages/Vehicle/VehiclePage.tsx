import { useState, type ReactNode } from 'react';
import {
  Activity, BatteryMedium, CarFront, CircleCheck, CircleGauge, DoorOpen, Droplets, Eye, Fuel, Gauge, Lightbulb, Lock, LockOpen, Radar, ScanFace, Settings2, ShieldCheck, TriangleAlert, Wrench,
} from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { FULL_TANK_RANGE_KM, TYRE_RANGE } from '../../data/defaults';
import { AMBIENT_COLOURS, MAINTENANCE } from '../../data/services';
import { formatDistance } from '../../services/format';
import { Toggle } from '../../components/controls/Toggle';
import { Slider } from '../../components/controls/Slider';
import { Segmented } from '../../components/controls/Segmented';
import { DemoTag } from '../../components/controls/DemoTag';
import { DrivingNotice } from '../../components/cards/DrivingNotice';
import type { AdasState, DrivePreference, TyreId } from '../../types';

type Section = 'status' | 'tyres' | 'assist' | 'settings' | 'maintenance';

const SECTIONS: { id: Section; label: string; icon: typeof Gauge; parkedOnly?: boolean }[] = [
  { id: 'status', label: 'Vehicle status', icon: Gauge },
  { id: 'tyres', label: 'Tyres', icon: CircleGauge },
  { id: 'assist', label: 'Driver assistance', icon: ShieldCheck },
  { id: 'settings', label: 'Vehicle settings', icon: Settings2, parkedOnly: true },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench, parkedOnly: true },
];

export function VehiclePage() {
  const { pageSection, driveMode } = useAppState();
  const initial = SECTIONS.find((s) => s.id === pageSection)?.id ?? 'status';
  const [section, setSection] = useState<Section>(initial);
  const driving = driveMode === 'driving';
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="h-full p-5 grid grid-cols-[260px_minmax(0,1fr)] gap-4">
      <nav className="card p-2 flex flex-col gap-1 self-start" aria-label="Vehicle sections">
        {SECTIONS.map(({ id, label, icon: Icon, parkedOnly }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            aria-current={section === id ? 'page' : undefined}
            className={`flex items-center gap-3 h-14 px-4 rounded-xl text-left transition-colors ${section === id ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}
          >
            <Icon size={19} aria-hidden />
            <span className="flex-1 font-medium">{label}</span>
            {driving && parkedOnly && <Lock size={14} className="text-warn" aria-label="Parked only" />}
          </button>
        ))}
        <p className="px-4 py-3 text-xs text-ink-3">All vehicle data and controls are simulated. MYRA is not connected to the vehicle’s ECU, CAN bus, cameras or sensors.</p>
      </nav>

      <div key={section} className="anim-fade min-h-0">
        {driving && current.parkedOnly ? (
          <DrivingNotice />
        ) : section === 'status' ? (
          <StatusSection />
        ) : section === 'tyres' ? (
          <TyreSection />
        ) : section === 'assist' ? (
          <AssistSection />
        ) : section === 'settings' ? (
          <SettingsSection />
        ) : (
          <MaintenanceSection />
        )}
      </div>
    </div>
  );
}

function Panel({ title, children, action, className = '' }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 flex flex-col gap-4 ${className}`} aria-label={title}>
      <header className="flex items-center justify-between gap-3">
        <h2 className="label">{title}</h2>
        {action ?? <DemoTag>Simulated</DemoTag>}
      </header>
      {children}
    </section>
  );
}

function StatusSection() {
  const { vehicle, settings, driveMode } = useAppState();
  const actions = useActions();
  const range = (vehicle.fuelPct / 100) * FULL_TANK_RANGE_KM;
  const low = (Object.values(vehicle.tyres) as number[]).some((p) => p < TYRE_RANGE.min);
  const checks = [
    { label: 'Engine', ok: true, detail: driveMode === 'driving' ? 'Running · normal' : 'Off · ready to start' },
    { label: 'Brakes', ok: true, detail: 'Normal' },
    { label: 'Airbags', ok: true, detail: 'Ready' },
    { label: 'Exterior lights', ok: true, detail: 'All working' },
    { label: 'Tyre pressure', ok: !low, detail: low ? 'Check pressure' : 'Normal' },
    { label: '12V battery', ok: true, detail: `${vehicle.batteryV.toFixed(1)} V` },
  ];

  return (
    <div className="grid grid-cols-2 content-start gap-4">
      <Panel title="Fuel & range" className="row-span-1">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[3.5rem] font-light leading-none text-ink tabular-nums">{Math.round(vehicle.fuelPct)}<span className="text-2xl text-ink-2">%</span></p>
            <p className="text-sm text-ink-2 mt-2 flex items-center gap-1.5"><Fuel size={15} aria-hidden /> Petrol</p>
          </div>
          <div className="text-right">
            <p className="label">Est. range</p>
            <p className="text-3xl font-semibold text-ink tabular-nums">{formatDistance(range, settings.distanceUnit)}</p>
          </div>
        </div>
        <div className="h-3 rounded-full bg-surface-3 overflow-hidden" role="meter" aria-label="Fuel level" aria-valuenow={Math.round(vehicle.fuelPct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${vehicle.fuelPct < 20 ? 'bg-warn' : 'bg-gradient-to-r from-ok to-[#7fe0bb]'}`} style={{ width: `${vehicle.fuelPct}%` }} />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-2">Odometer <span className="text-ink font-medium tabular-nums">{Math.round(vehicle.odometerKm).toLocaleString('en-IN')} km</span></span>
          <button type="button" className="btn !min-h-10 !text-sm" onClick={() => { actions.vehicle.refuel(); actions.ui.toast('Tank refilled (simulation)', 'success'); }}>
            Demo: refuel
          </button>
        </div>
      </Panel>

      <Panel title="Engine & electrics">
        <div className="grid grid-cols-2 gap-3">
          <Metric icon={Activity} label="Engine" value={driveMode === 'driving' ? 'Running' : 'Off'} />
          <Metric icon={BatteryMedium} label="Battery" value={`${vehicle.batteryV.toFixed(1)} V`} />
          <Metric icon={Droplets} label="Oil life" value={`${vehicle.oilLifePct}%`} />
          <Metric icon={vehicle.locked ? Lock : LockOpen} label="Doors" value={vehicle.locked ? 'Locked' : 'Unlocked'} />
        </div>
      </Panel>

      <Panel title="Vehicle health" className="col-span-2">
        <ul className="grid grid-cols-3 gap-3" role="list">
          {checks.map((c) => (
            <li key={c.label} className={`card-inset p-4 flex items-center gap-3 ${c.ok ? '' : '!border-warn/50'}`}>
              {c.ok ? <CircleCheck size={22} className="text-ok shrink-0" aria-hidden /> : <TriangleAlert size={22} className="text-warn shrink-0" aria-hidden />}
              <div>
                <p className="font-medium text-ink">{c.label}</p>
                <p className={`text-sm ${c.ok ? 'text-ink-2' : 'text-warn'}`}>{c.ok ? '✓ ' : '! '}{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string }) {
  return (
    <div className="card-inset p-4">
      <p className="label flex items-center gap-1.5"><Icon size={13} aria-hidden /> {label}</p>
      <p className="text-xl font-semibold text-ink mt-1">{value}</p>
    </div>
  );
}

const TYRE_POS: Record<TyreId, { label: string; x: number; y: number }> = {
  fl: { label: 'Front left', x: 0, y: 0 },
  fr: { label: 'Front right', x: 1, y: 0 },
  rl: { label: 'Rear left', x: 0, y: 1 },
  rr: { label: 'Rear right', x: 1, y: 1 },
};

function TyreSection() {
  const { vehicle, driveMode } = useAppState();
  const actions = useActions();
  const lowCount = (Object.keys(vehicle.tyres) as TyreId[]).filter((k) => vehicle.tyres[k] < TYRE_RANGE.min).length;

  return (
    <Panel
      title="Tyre pressure"
      className="h-full"
      action={
        <div className="flex items-center gap-2">
          <DemoTag>Simulated TPMS</DemoTag>
          {driveMode === 'parked' && lowCount > 0 && (
            <button type="button" className="btn !min-h-9 !text-sm" onClick={() => { actions.vehicle.inflateTyres(); actions.ui.toast('Tyres set to recommended pressure (simulation)', 'success'); }}>
              Demo: inflate to {TYRE_RANGE.recommended} psi
            </button>
          )}
        </div>
      }
    >
      <div className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center gap-8 px-6">
        <div className="flex flex-col gap-16">
          <TyreReading id="fl" psi={vehicle.tyres.fl} />
          <TyreReading id="rl" psi={vehicle.tyres.rl} />
        </div>
        <CarTopView tyres={vehicle.tyres} />
        <div className="flex flex-col gap-16">
          <TyreReading id="fr" psi={vehicle.tyres.fr} />
          <TyreReading id="rr" psi={vehicle.tyres.rr} />
        </div>
      </div>
      <p className={`text-sm flex items-center gap-2 ${lowCount ? 'text-warn' : 'text-ok'}`} role="status">
        {lowCount ? <TriangleAlert size={16} aria-hidden /> : <CircleCheck size={16} aria-hidden />}
        {lowCount ? `${lowCount} tyre${lowCount > 1 ? 's' : ''} below ${TYRE_RANGE.min} psi — inflate at the next opportunity.` : 'All tyres are within the normal range.'}
        <span className="text-ink-3 ml-auto">Recommended {TYRE_RANGE.recommended} psi (cold)</span>
      </p>
    </Panel>
  );
}

function TyreReading({ id, psi }: { id: TyreId; psi: number }) {
  const low = psi < TYRE_RANGE.min;
  const high = psi > TYRE_RANGE.max;
  const status = low ? 'Low' : high ? 'High' : 'Normal';
  return (
    <div className={`card-inset p-4 ${low || high ? '!border-warn/60 !bg-warn/10' : ''}`}>
      <p className="label">{TYRE_POS[id].label}</p>
      <p className={`text-[2.25rem] font-light leading-tight tabular-nums ${low || high ? 'text-warn' : 'text-ink'}`}>
        {psi}<span className="text-base text-ink-2 ml-1">psi</span>
      </p>
      <p className={`text-sm font-medium flex items-center gap-1.5 ${low || high ? 'text-warn' : 'text-ok'}`}>
        {low || high ? <TriangleAlert size={14} aria-hidden /> : <CircleCheck size={14} aria-hidden />} {status}
      </p>
    </div>
  );
}

function CarTopView({ tyres }: { tyres: Record<TyreId, number> }) {
  const tyreFill = (k: TyreId) => (tyres[k] < TYRE_RANGE.min ? 'var(--color-warn)' : 'var(--color-ok)');
  return (
    <svg viewBox="0 0 160 300" className="h-[330px]" role="img" aria-label="Vehicle top view">
      <rect x="6" y="48" width="22" height="50" rx="7" fill={tyreFill('fl')} />
      <rect x="132" y="48" width="22" height="50" rx="7" fill={tyreFill('fr')} />
      <rect x="6" y="200" width="22" height="50" rx="7" fill={tyreFill('rl')} />
      <rect x="132" y="200" width="22" height="50" rx="7" fill={tyreFill('rr')} />
      <path d="M40 30 Q80 0 120 30 L134 80 L134 240 Q134 286 80 292 Q26 286 26 240 L26 80 Z" fill="var(--color-surface-3)" stroke="var(--color-line-strong)" strokeWidth="2" />
      <path d="M44 92 Q80 72 116 92 L110 128 Q80 120 50 128 Z" fill="var(--color-surface)" opacity="0.9" />
      <path d="M50 220 Q80 228 110 220 L114 246 Q80 258 46 246 Z" fill="var(--color-surface)" opacity="0.9" />
      <rect x="48" y="134" width="64" height="80" rx="10" fill="var(--color-surface-2)" />
      <path d="M48 24 Q80 10 112 24" stroke="var(--color-accent)" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

const ADAS_ITEMS: { key: keyof AdasState; label: string; detail: string; icon: typeof Gauge }[] = [
  { key: 'laneDeparture', label: 'Lane departure warning', detail: 'Alerts when drifting out of lane', icon: Radar },
  { key: 'collisionWarning', label: 'Forward collision warning', detail: 'Warns of vehicles ahead', icon: TriangleAlert },
  { key: 'blindSpot', label: 'Blind-spot alert', detail: 'Mirror alerts for vehicles alongside', icon: Eye },
  { key: 'parkingAssist', label: 'Parking assistance', detail: 'Distance warnings when parking', icon: CarFront },
  { key: 'driverMonitoring', label: 'Driver attention monitor', detail: 'Suggests breaks when attention drops', icon: ScanFace },
  { key: 'safeExit', label: 'Safe exit assist', detail: 'Warns of approaching traffic before doors open', icon: DoorOpen },
];

function AssistSection() {
  const { vehicle, driveMode } = useAppState();
  const actions = useActions();
  const driving = driveMode === 'driving';
  return (
    <Panel title="Driver assistance" className="h-full" action={<DemoTag>Simulated status</DemoTag>}>
      <ul className="grid grid-cols-2 gap-3" role="list">
        {ADAS_ITEMS.map(({ key, label, detail, icon: Icon }) => {
          const on = vehicle.adas[key];
          return (
            <li key={key} className="card-inset p-4 flex items-center gap-4">
              <span className={`grid place-items-center size-12 rounded-xl ${on ? 'bg-ok/15 text-ok' : 'bg-surface-3 text-ink-3'}`}>
                <Icon size={22} aria-hidden />
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-ink">{label}</p>
                <p className="text-xs text-ink-2">{detail}</p>
                <p className={`text-xs font-semibold mt-1 ${on ? 'text-ok' : 'text-ink-3'}`}>{on ? '● Active' : '○ Off'}</p>
              </div>
              <Toggle checked={on} onChange={(v) => actions.vehicle.setAdas(key, v)} label={label} disabled={driving} />
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-3 mt-auto">
        {driving ? 'Safety settings can only be changed while parked. ' : ''}Driver monitoring status is illustrative — MYRA does not use an in-cabin camera.
      </p>
    </Panel>
  );
}

function SettingsSection() {
  const { vehicle } = useAppState();
  const actions = useActions();
  const set = actions.vehicle.patch;
  return (
    <div className="h-full grid grid-cols-2 gap-4 min-h-0 scroll-y pr-1">
      <Panel title="Lighting">
        <Row icon={Lightbulb} label="Automatic headlamps"><Toggle checked={vehicle.headlampsAuto} onChange={(v) => set({ headlampsAuto: v })} label="Automatic headlamps" /></Row>
        <div>
          <p className="text-sm text-ink mb-2">Follow-me-home lights</p>
          <Segmented<number>
            label="Follow-me-home duration"
            value={vehicle.followMeHomeSec}
            onChange={(v) => set({ followMeHomeSec: v })}
            options={[0, 30, 60, 90].map((v) => ({ value: v, label: v ? `${v}s` : 'Off' }))}
            className="w-full"
          />
        </div>
      </Panel>

      <Panel title="Ambient lighting">
        <div className="flex items-center gap-3" role="radiogroup" aria-label="Ambient colour">
          {AMBIENT_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={vehicle.ambientColour === c}
              aria-label={`Colour ${c}`}
              onClick={() => set({ ambientColour: c })}
              className={`size-11 rounded-full border-2 transition-transform ${vehicle.ambientColour === c ? 'border-ink scale-110' : 'border-transparent'}`}
              style={{ background: c, boxShadow: `0 0 18px -2px ${c}` }}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink w-24">Brightness</span>
          <Slider value={vehicle.ambientBrightness} min={0} max={10} onChange={(v) => set({ ambientBrightness: v })} label="Ambient brightness" />
          <span className="w-6 text-sm text-ink tabular-nums">{vehicle.ambientBrightness}</span>
        </div>
        <p className="text-xs text-ink-3">Preview: the thin line under MYRA’s status bar uses this colour.</p>
      </Panel>

      <Panel title="Doors & locks">
        <div className="flex items-center gap-4">
          <span className={`grid place-items-center size-14 rounded-2xl ${vehicle.locked ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'}`}>
            {vehicle.locked ? <Lock size={24} aria-hidden /> : <LockOpen size={24} aria-hidden />}
          </span>
          <div className="flex-1">
            <p className="text-lg font-semibold text-ink">{vehicle.locked ? 'All doors locked' : 'Doors unlocked'}</p>
            <p className="text-xs text-ink-2">Simulated lock state</p>
          </div>
          <button type="button" className="btn" onClick={() => set({ locked: !vehicle.locked })}>
            {vehicle.locked ? 'Unlock' : 'Lock'}
          </button>
        </div>
        <Row label="Auto-lock when driving"><Toggle checked={vehicle.autoLock} onChange={(v) => set({ autoLock: v })} label="Auto-lock when driving" /></Row>
      </Panel>

      <Panel title="Convenience & driving">
        <Row label="Welcome light"><Toggle checked={vehicle.welcomeLight} onChange={(v) => set({ welcomeLight: v })} label="Welcome light" /></Row>
        <Row label="Mirror auto-fold on lock"><Toggle checked={vehicle.mirrorAutoFold} onChange={(v) => set({ mirrorAutoFold: v })} label="Mirror auto-fold" /></Row>
        <div>
          <p className="text-sm text-ink mb-2">Drive mode preference</p>
          <Segmented<DrivePreference>
            label="Drive mode preference"
            value={vehicle.drivePref}
            onChange={(v) => set({ drivePref: v })}
            options={[{ value: 'eco', label: 'Eco' }, { value: 'normal', label: 'Normal' }, { value: 'sport', label: 'Sport' }]}
            className="w-full"
          />
        </div>
      </Panel>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon?: typeof Gauge; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-11">
      <span className="flex items-center gap-2 text-sm text-ink">
        {Icon && <Icon size={16} className="text-ink-2" aria-hidden />}
        {label}
      </span>
      {children}
    </div>
  );
}

function MaintenanceSection() {
  const actions = useActions();
  const tone = { info: 'text-accent bg-accent-soft', warning: 'text-warn bg-warn/15', ok: 'text-ok bg-ok/15' } as const;
  return (
    <Panel title="Maintenance reminders" className="h-full">
      <ul className="flex flex-col gap-3" role="list">
        {MAINTENANCE.map((m) => (
          <li key={m.id} className="card-inset p-4 flex items-center gap-4">
            <span className={`grid place-items-center size-12 rounded-xl ${tone[m.level]}`}>
              {m.level === 'warning' ? <TriangleAlert size={20} aria-hidden /> : m.level === 'ok' ? <CircleCheck size={20} aria-hidden /> : <Wrench size={20} aria-hidden />}
            </span>
            <div className="flex-1">
              <p className="font-medium text-ink">{m.title}</p>
              <p className="text-sm text-ink-2">{m.due}</p>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-primary self-start mt-auto" onClick={() => actions.ui.toast('Service booking is a demonstration — no request was sent', 'info')}>
        <Wrench size={18} aria-hidden /> Book a service (demo)
      </button>
    </Panel>
  );
}
