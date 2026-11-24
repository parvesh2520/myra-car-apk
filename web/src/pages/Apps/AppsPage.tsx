import { useState, type ReactNode } from 'react';
import {
  Ambulance, CircleCheck, CircleLetterP, Cloud, CloudRain, CloudSun, CreditCard, Droplets, Fuel, Hospital, IndianRupee, Landmark, MapPin, MonitorSmartphone, Navigation, Phone, Shield, Siren, Smartphone, Sun, TriangleAlert, Wind,
} from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { PLACES, placeById } from '../../data/places';
import { BHARAT_SERVICES, CONNECTED_DEVICES, DEMO_WEATHER, EMERGENCY, FASTAG } from '../../data/services';
import { computeRoute } from '../../services/routing';
import { formatDistance, formatTemp } from '../../services/format';
import { DemoTag } from '../../components/controls/DemoTag';
import { DrivingNotice } from '../../components/cards/DrivingNotice';
import { BharatTranslator } from './BharatTranslator';

type AppId = 'bharat' | 'fuel' | 'parking' | 'fastag' | 'weather' | 'emergency' | 'devices';

const APPS: { id: AppId; name: string; detail: string; icon: typeof Fuel; colour: string; drivingOk: boolean }[] = [
  { id: 'bharat', name: 'BharatConnect', detail: 'Voice interpreter, PUC, insurance, RC', icon: Landmark, colour: '#E8B65E', drivingOk: false },
  { id: 'fuel', name: 'Fuel stations', detail: 'Nearby petrol pumps', icon: Fuel, colour: '#F08A5D', drivingOk: true },
  { id: 'parking', name: 'Parking', detail: 'Facilities near you', icon: CircleLetterP, colour: '#4D9EFF', drivingOk: true },
  { id: 'fastag', name: 'FASTag & tolls', detail: 'Balance and toll history', icon: CreditCard, colour: '#56C69B', drivingOk: false },
  { id: 'weather', name: 'Weather', detail: 'Chennai forecast', icon: CloudSun, colour: '#7DB8FF', drivingOk: true },
  { id: 'emergency', name: 'Emergency', detail: 'SOS & nearby help', icon: Siren, colour: '#EF6F6C', drivingOk: true },
  { id: 'devices', name: 'Connected devices', detail: 'Phone, wearables, accessories', icon: MonitorSmartphone, colour: '#B9A7FF', drivingOk: false },
];

export function AppsPage() {
  const { pageSection, driveMode } = useAppState();
  const initial = APPS.find((a) => a.id === pageSection)?.id ?? 'bharat';
  const [selected, setSelected] = useState<AppId>(initial);
  const driving = driveMode === 'driving';
  const app = APPS.find((a) => a.id === selected)!;

  return (
    <div className="h-full p-5 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4">
      <section className="flex flex-col gap-3 min-h-0" aria-label="Connected services">
        <header className="flex items-center justify-between px-1">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Apps & services</h1>
            <p className="text-sm text-ink-2">Connected-service demonstrations — no real transactions or calls.</p>
          </div>
        </header>
        <div className="grid grid-cols-2 gap-3 scroll-y min-h-0 pb-1">
          {APPS.map((a) => {
            const blocked = driving && !a.drivingOk;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelected(a.id)}
                aria-pressed={selected === a.id}
                className={`tile p-4 flex items-center gap-4 min-h-[92px] ${selected === a.id ? 'is-active' : ''} ${blocked ? 'opacity-60' : ''}`}
              >
                <span className="grid place-items-center size-12 rounded-2xl shrink-0" style={{ background: `${a.colour}22`, color: a.colour }}>
                  <a.icon size={24} aria-hidden />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-ink">{a.name}</span>
                  <span className="block text-xs text-ink-2 truncate">{blocked ? 'Available when parked' : a.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section key={selected} className="card p-5 flex flex-col gap-4 min-h-0 anim-fade" aria-label={app.name}>
        <header className="flex items-center gap-3">
          <span className="grid place-items-center size-11 rounded-xl" style={{ background: `${app.colour}22`, color: app.colour }}>
            <app.icon size={22} aria-hidden />
          </span>
          <h2 className="text-xl font-semibold text-ink flex-1">{app.name}</h2>
          <DemoTag>{selected === 'devices' ? 'Demo state' : 'Demo data'}</DemoTag>
        </header>
        <div className="flex-1 min-h-0 scroll-y flex flex-col gap-3">
          {driving && !app.drivingOk ? <DrivingNotice /> : <AppDetail id={selected} />}
        </div>
      </section>
    </div>
  );
}

function AppDetail({ id }: { id: AppId }) {
  switch (id) {
    case 'bharat':
      return <BharatDetail />;
    case 'fuel':
      return <PlacesDetail category="fuel" />;
    case 'parking':
      return <PlacesDetail category="parking" />;
    case 'fastag':
      return <FastagDetail />;
    case 'weather':
      return <WeatherDetail />;
    case 'emergency':
      return <EmergencyDetail />;
    case 'devices':
      return <DevicesDetail />;
  }
}

function Row({ icon, title, detail, right, tone }: { icon: ReactNode; title: string; detail: string; right?: ReactNode; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`card-inset p-4 flex items-center gap-4 ${tone === 'warn' ? '!border-warn/50' : ''}`}>
      {icon}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-ink">{title}</p>
        <p className={`text-sm ${tone === 'warn' ? 'text-warn' : 'text-ink-2'}`}>{detail}</p>
      </div>
      {right}
    </div>
  );
}

export function BharatDetail() {
  const actions = useActions();
  return (
    <>
      <BharatTranslator />
      <p className="text-sm text-ink-2">India-specific vehicle services in one place. Records shown here are sample data, not fetched from government systems.</p>
      {BHARAT_SERVICES.map((s) => (
        <Row
          key={s.id}
          icon={s.ok ? <CircleCheck size={22} className="text-ok shrink-0" aria-hidden /> : <TriangleAlert size={22} className="text-warn shrink-0" aria-hidden />}
          title={s.name}
          detail={s.status}
          tone={s.ok ? 'ok' : 'warn'}
          right={!s.ok && <button type="button" className="btn !min-h-10 !text-sm" onClick={() => actions.ui.toast('Renewal is a demonstration — nothing was purchased', 'info')}>Renew (demo)</button>}
        />
      ))}
    </>
  );
}

function PlacesDetail({ category }: { category: 'fuel' | 'parking' }) {
  const { nav, settings } = useAppState();
  const actions = useActions();
  const origin = placeById(nav.originId) ?? PLACES[0];
  const list = PLACES.filter((p) => p.category === category)
    .map((p) => ({ p, km: computeRoute(origin, p, nav.routePref, nav.avoidTolls).distanceKm }))
    .sort((a, b) => a.km - b.km);
  return (
    <>
      {category === 'fuel' && (
        <div className="grid grid-cols-3 gap-2">
          {[['Petrol', '₹100.8/L'], ['Diesel', '₹92.4/L'], ['CNG', '₹91.5/kg']].map(([k, v]) => (
            <div key={k} className="card-inset p-3">
              <p className="label">{k}</p>
              <p className="text-lg font-semibold text-ink tabular-nums">{v}</p>
            </div>
          ))}
          <p className="col-span-3 text-xs text-ink-3">Sample prices for illustration — not live rates.</p>
        </div>
      )}
      {list.map(({ p, km }) => (
        <Row
          key={p.id}
          icon={<MapPin size={22} className={category === 'fuel' ? 'text-warn shrink-0' : 'text-accent shrink-0'} aria-hidden />}
          title={p.name}
          detail={`${p.area} · ${p.detail ?? ''}`}
          right={
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-2 tabular-nums">{formatDistance(km, settings.distanceUnit)}</span>
              <button
                type="button"
                className="btn btn-primary !min-h-10"
                onClick={() => {
                  actions.nav.setDestination(p.id);
                  actions.ui.go('navigation');
                }}
              >
                <Navigation size={16} aria-hidden /> Route
              </button>
            </div>
          }
        />
      ))}
    </>
  );
}

function FastagDetail() {
  const actions = useActions();
  return (
    <>
      <div className="card-inset p-5 flex items-center justify-between">
        <div>
          <p className="label">FASTag balance</p>
          <p className="text-[2.5rem] font-light text-ink tabular-nums flex items-center"><IndianRupee size={30} aria-hidden />{FASTAG.balance.toLocaleString('en-IN')}</p>
          <p className="text-sm text-ink-2">{FASTAG.vehicle}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => actions.ui.toast('Recharge is a demonstration — no payment was made', 'info')}>
          Recharge (demo)
        </button>
      </div>
      <p className="label px-1 pt-1">Recent toll crossings</p>
      {FASTAG.recent.map((r) => (
        <Row key={r.when} icon={<CreditCard size={20} className="text-ok shrink-0" aria-hidden />} title={r.plaza} detail={r.when} right={<span className="font-semibold text-ink tabular-nums">₹{r.amount}</span>} />
      ))}
    </>
  );
}

function WeatherDetail() {
  const { settings } = useAppState();
  const icon = { sun: Sun, cloud: Cloud, rain: CloudRain } as const;
  return (
    <>
      <div className="card-inset p-5 flex items-center gap-6">
        <CloudSun size={64} className="text-warn" aria-hidden />
        <div className="flex-1">
          <p className="text-[3rem] font-light leading-none text-ink tabular-nums">{formatTemp(DEMO_WEATHER.tempC, settings.tempUnit)}</p>
          <p className="text-ink-2 mt-1">{DEMO_WEATHER.condition} · {DEMO_WEATHER.city} · Feels like {formatTemp(DEMO_WEATHER.feelsLikeC, settings.tempUnit)}</p>
        </div>
        <div className="flex flex-col gap-1.5 text-sm text-ink-2">
          <span className="flex items-center gap-2"><Droplets size={15} aria-hidden /> {DEMO_WEATHER.humidity}% humidity</span>
          <span className="flex items-center gap-2"><Wind size={15} aria-hidden /> {DEMO_WEATHER.windKmh} km/h</span>
          <span className="flex items-center gap-2"><Shield size={15} aria-hidden /> AQI {DEMO_WEATHER.aqi} (moderate)</span>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {DEMO_WEATHER.forecast.map((d) => {
          const Icon = icon[d.icon];
          return (
            <div key={d.day} className="card-inset p-3 text-center">
              <p className="text-sm font-medium text-ink">{d.day}</p>
              <Icon size={26} className="mx-auto my-2 text-ink-2" aria-hidden />
              <p className="text-sm text-ink tabular-nums">{formatTemp(d.hi, settings.tempUnit)} <span className="text-ink-3">{formatTemp(d.lo, settings.tempUnit)}</span></p>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink-3">Demo weather data — not a live forecast.</p>
    </>
  );
}

function EmergencyDetail() {
  const [armed, setArmed] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setArmed((a) => !a)}
        className={`rounded-3xl p-6 flex items-center gap-5 text-left border-2 transition-colors ${armed ? 'bg-danger/20 border-danger' : 'bg-danger/10 border-danger/40 hover:border-danger'}`}
        aria-pressed={armed}
      >
        <span className="grid place-items-center size-20 rounded-full bg-danger text-white shrink-0">
          <Siren size={36} aria-hidden />
        </span>
        <span>
          <span className="block text-2xl font-bold text-ink">SOS</span>
          <span className="block text-sm text-ink-2">
            {armed ? 'Demonstration only — no emergency call was placed and no location was shared.' : 'Tap to preview the emergency-assist flow (demo).'}
          </span>
        </span>
      </button>
      {armed && (
        <div className="card-inset p-4 text-sm text-ink-2 anim-fade" role="status">
          In a production system MYRA would call <span className="text-ink font-semibold">112</span> and share the vehicle’s location. This prototype does neither.
          <button type="button" className="btn !min-h-9 !text-sm ml-3" onClick={() => setArmed(false)}>Cancel</button>
        </div>
      )}
      <Row icon={<Hospital size={22} className="text-danger shrink-0" aria-hidden />} title={EMERGENCY.hospital.name} detail={`${EMERGENCY.hospital.distance} away`} />
      <Row icon={<Shield size={22} className="text-accent shrink-0" aria-hidden />} title={EMERGENCY.police.name} detail={`${EMERGENCY.police.distance} away`} />
      <div className="grid grid-cols-3 gap-2">
        {EMERGENCY.numbers.map((n) => (
          <div key={n.number} className="card-inset p-3">
            <p className="label flex items-center gap-1.5">{n.label === 'Ambulance' ? <Ambulance size={13} aria-hidden /> : <Phone size={13} aria-hidden />} {n.label}</p>
            <p className="text-2xl font-semibold text-ink tabular-nums">{n.number}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-3">Helpline numbers are shown for reference. Use your phone to contact emergency services.</p>
    </>
  );
}

function DevicesDetail() {
  const { phone } = useAppState();
  const actions = useActions();
  return (
    <>
      <Row
        icon={<Smartphone size={22} className={phone.deviceConnected ? 'text-accent shrink-0' : 'text-ink-3 shrink-0'} aria-hidden />}
        title={phone.deviceName}
        detail={phone.deviceConnected ? 'Bluetooth · Media & calls' : 'Not connected'}
        right={
          <button type="button" className="btn !min-h-10 !text-sm" onClick={() => actions.ui.go('phone')}>
            Manage
          </button>
        }
      />
      {CONNECTED_DEVICES.filter((d) => d.id !== 'phone').map((d) => (
        <Row key={d.id} icon={<MonitorSmartphone size={22} className="text-ink-2 shrink-0" aria-hidden />} title={d.name} detail={`${d.kind} · ${d.detail}`} right={<span className="tag">Demo</span>} />
      ))}
    </>
  );
}
