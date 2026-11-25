import { useEffect, useRef, useState } from 'react';
import { Bluetooth, BluetoothOff, Check, ChevronDown, CloudSun, Fan, Settings2, Signal, Snowflake, Waves, Wifi, WifiOff } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { activeProfile } from '../../context/actions';
import { useClock } from '../../hooks/useClock';
import { useT } from '../../hooks/useT';
import { useMotionSense } from '../../hooks/useMotionSense';
import { motionRuntime, stopMotionDemo } from '../../services/motionSense';
import { DEMO_WEATHER } from '../../data/services';
import { formatClock, formatTemp, initials } from '../../services/format';
import { MyraMark } from './MyraMark';

export function StatusBar() {
  const state = useAppState();
  const actions = useActions();
  const t = useT();
  const now = useClock();
  const { settings, climate, phone, driveMode } = state;
  const driving = driveMode === 'driving';

  const date = now.toLocaleDateString(settings.uiLanguage === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <header className="relative z-30 h-14 shrink-0 flex items-center gap-4 px-5 border-b border-line bg-bg/80 backdrop-blur-md">
      <div className="flex items-center gap-3 w-[300px] shrink-0">
        <MyraMark className="h-6" />
        <span className="h-4 w-px bg-line-strong" aria-hidden />
        <span className="text-[0.6875rem] font-semibold tracking-[0.42em] text-ink-3">VERNA</span>
      </div>

      <div className="flex-1 flex items-center justify-center gap-3 min-w-0" aria-live="off">
        <time className="text-[1.375rem] font-semibold tracking-tight text-ink tabular-nums" dateTime={now.toISOString()}>
          {formatClock(now, settings.clock24h)}
        </time>
        <span className="text-sm text-ink-2 truncate">{date}</span>
      </div>

      <div className="flex items-center gap-2 justify-end shrink-0">
        <MotionSenseChip />
        <button
          type="button"
          onClick={() => actions.ui.go('apps', 'weather')}
          className="chip !min-h-9"
          title="Demo weather — not live"
          aria-label={`Outside ${DEMO_WEATHER.tempC} degrees, demo weather`}
        >
          <CloudSun size={16} aria-hidden />
          {formatTemp(DEMO_WEATHER.tempC, settings.tempUnit)}
        </button>
        <button
          type="button"
          onClick={() => actions.ui.go('climate')}
          className="chip !min-h-9"
          aria-label={`Climate ${climate.ac ? 'AC on' : 'AC off'}, ${climate.driver.temp} degrees, fan ${climate.fan}. Open climate`}
        >
          <Snowflake size={15} className={climate.ac ? 'text-accent' : 'text-ink-3'} aria-hidden />
          <span className="text-ink tabular-nums">{formatTemp(climate.driver.temp, settings.tempUnit)}</span>
          <Fan size={14} aria-hidden />
          <span className="tabular-nums">{climate.auto ? 'A' : climate.fan}</span>
        </button>

        <div className="flex items-center gap-2.5 px-3 text-ink-2" aria-label="Connectivity">
          {phone.bluetooth ? (
            <Bluetooth size={17} className={phone.deviceConnected ? 'text-accent' : ''} aria-label={phone.deviceConnected ? 'Bluetooth connected' : 'Bluetooth on'} />
          ) : (
            <BluetoothOff size={17} className="text-ink-3" aria-label="Bluetooth off" />
          )}
          {settings.wifi ? <Wifi size={17} aria-label="Wi-Fi on" /> : <WifiOff size={17} className="text-ink-3" aria-label="Wi-Fi off" />}
          <span className="flex items-center gap-1" aria-label="Mobile signal, demo">
            <Signal size={17} aria-hidden />
            <span className="text-[0.625rem] font-bold">4G</span>
          </span>
        </div>

        <ProfileMenu />

        <button
          type="button"
          onClick={() => actions.ui.setDriveMode(driving ? 'parked' : 'driving')}
          className={`flex items-center gap-2 h-10 pl-1.5 pr-3 rounded-full border transition-colors ${
            driving ? 'border-warn/50 bg-warn/12 text-warn' : 'border-line bg-surface-2 text-ink-2'
          }`}
          aria-label={`Demo drive state: ${driving ? 'Driving' : 'Parked'}. Switch to ${driving ? 'Parked' : 'Driving'}`}
          title="Prototype control — MYRA does not read the real vehicle state"
        >
          <span className={`grid place-items-center size-7 rounded-full text-xs font-bold ${driving ? 'bg-warn text-[#1d1405]' : 'bg-surface-3 text-ink'}`}>
            {driving ? 'D' : 'P'}
          </span>
          <span className="text-sm font-semibold">{driving ? t('driving') : t('parked')}</span>
          <span className="text-[0.5625rem] font-bold tracking-wider uppercase opacity-70">{t('demo')}</span>
        </button>
      </div>
    </header>
  );
}

/** Shown only while MotionSense cues are on screen: one tap turns them off. */
function MotionSenseChip() {
  const actions = useActions();
  const { active, runtime, ms } = useMotionSense();
  if (!active) return null;
  const off = () => {
    if (runtime.demo) return stopMotionDemo();
    if (runtime.preview) return motionRuntime.set({ preview: false });
    actions.settings.patch({ motionSense: { ...ms, enabled: false } });
    actions.ui.toast('MotionSense turned off', 'info');
  };
  return (
    <button type="button" onClick={off} className="chip !min-h-9 text-accent" aria-label={runtime.preview ? 'Exit MotionSense preview' : 'Turn off MotionSense'} title="MotionSense is on — tap to turn off">
      <Waves size={16} aria-hidden />
      {runtime.demo ? 'Demo' : runtime.preview ? 'Preview' : 'MotionSense'}
    </button>
  );
}

function ProfileMenu() {
  const state = useAppState();
  const actions = useActions();
  const profile = activeProfile(state);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 h-10 pl-1 pr-2.5 rounded-full border border-line bg-surface-2 hover:bg-surface-3 transition-colors"
      >
        <span className="grid place-items-center size-8 rounded-full text-xs font-bold text-[#06101d]" style={{ background: profile.colour }}>
          {initials(profile.name)}
        </span>
        <span className="text-sm font-medium text-ink max-w-28 truncate">{profile.name}</span>
        <ChevronDown size={15} className="text-ink-3" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="anim-fade absolute right-0 top-12 w-64 card p-2 z-50">
          <p className="label px-3 pt-2 pb-1">Driver profile</p>
          {state.profiles.map((p) => (
            <button
              key={p.id}
              role="menuitemradio"
              aria-checked={p.id === profile.id}
              type="button"
              onClick={() => {
                actions.profiles.switchTo(p.id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-3 px-3 h-12 rounded-xl hover:bg-surface-2 text-left"
            >
              <span className="grid place-items-center size-8 rounded-full text-xs font-bold text-[#06101d]" style={{ background: p.colour }}>
                {initials(p.name)}
              </span>
              <span className="flex-1 text-sm text-ink">{p.name}</span>
              {p.id === profile.id && <Check size={16} className="text-accent" aria-hidden />}
            </button>
          ))}
          <div className="h-px bg-line my-1.5" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              actions.ui.go('settings', 'profiles');
              setOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3 h-11 rounded-xl hover:bg-surface-2 text-sm text-ink-2"
          >
            <Settings2 size={16} aria-hidden /> Manage profiles
          </button>
          <p className="px-3 pt-1 pb-2 text-[0.6875rem] text-ink-3">Profiles are chosen manually — no biometric recognition.</p>
        </div>
      )}
    </div>
  );
}
