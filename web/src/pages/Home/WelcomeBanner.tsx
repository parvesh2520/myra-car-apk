import { CloudSun, Smartphone, Sparkles } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { activeProfile } from '../../context/actions';
import { useAssistant } from '../../context/AssistantContext';
import { useClock } from '../../hooks/useClock';
import { useT } from '../../hooks/useT';
import { DEMO_WEATHER } from '../../data/services';
import { dayPart, formatDate, formatTemp } from '../../services/format';
import { DemoTag } from '../../components/controls/DemoTag';

const TRY_PHRASES = ['Garmi lag rahi hai', 'Ghar le chalo', 'Romantic gaane chalao', 'Fan speed badhao'];

export function WelcomeBanner({ className = '' }: { className?: string }) {
  const state = useAppState();
  const actions = useActions();
  const assistant = useAssistant();
  const t = useT();
  const now = useClock(30_000);
  const profile = activeProfile(state);
  const { settings, climate, phone } = state;
  const phrase = TRY_PHRASES[Math.floor(now.getMinutes() / 15) % TRY_PHRASES.length];

  const comfortReady = climate.ac && Math.abs(climate.driver.temp - profile.preferredTemp) < 1;

  return (
    <section className={`flex items-center gap-4 ${className}`} aria-label="Welcome">
      <div className="flex-1 min-w-0">
        <h1 className="text-[1.875rem] font-semibold tracking-tight text-ink leading-tight truncate">
          {t(dayPart(now))}, {profile.name}
        </h1>
        <p className="text-[0.9375rem] text-ink-2 mt-0.5 truncate">
          {formatDate(now, settings.uiLanguage)} ·{' '}
          {comfortReady ? `Your preferred climate (${formatTemp(profile.preferredTemp, settings.tempUnit)}) is ready` : t('welcomeBack')}
        </p>
      </div>

      <button
        type="button"
        onClick={() => actions.ui.go('apps', 'weather')}
        className="card flex items-center gap-3 h-[68px] pl-4 pr-5 hover:border-line-strong transition-colors"
        aria-label={`Weather demo: ${DEMO_WEATHER.tempC} degrees, ${DEMO_WEATHER.condition}`}
      >
        <CloudSun size={30} className="text-warn" aria-hidden />
        <div className="text-left">
          <p className="text-xl font-semibold text-ink leading-none tabular-nums">{formatTemp(DEMO_WEATHER.tempC, settings.tempUnit)}</p>
          <p className="text-xs text-ink-2 mt-1">{DEMO_WEATHER.condition} · {DEMO_WEATHER.city}</p>
        </div>
        <DemoTag />
      </button>

      <button
        type="button"
        onClick={() => actions.ui.go('phone')}
        className="card flex items-center gap-3 h-[68px] pl-4 pr-5 hover:border-line-strong transition-colors"
        aria-label={`Phone ${phone.deviceConnected ? 'connected' : 'not connected'}`}
      >
        <span className={`grid place-items-center size-10 rounded-xl ${phone.deviceConnected ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-ink-3'}`}>
          <Smartphone size={20} aria-hidden />
        </span>
        <div className="text-left">
          <p className="text-sm font-semibold text-ink leading-tight">{phone.deviceConnected ? phone.deviceName : 'No phone'}</p>
          <p className="text-xs text-ink-2 mt-0.5">
            {phone.deviceConnected
              ? phone.projection === 'androidAuto'
                ? 'Android Auto (demo)'
                : phone.projection === 'carPlay'
                  ? 'Apple CarPlay (demo)'
                  : `${t('connected')} · Bluetooth`
              : t('notConnected')}
          </p>
        </div>
      </button>

      <button
        type="button"
        onClick={() => assistant.submit(phrase)}
        className="card flex items-center gap-3 h-[68px] pl-4 pr-5 hover:border-accent/50 transition-colors !bg-accent-soft"
        aria-label={`Ask Myra: ${phrase}`}
      >
        <Sparkles size={20} className="text-accent" aria-hidden />
        <div className="text-left">
          <p className="text-xs text-ink-2">Try saying</p>
          <p className="text-sm font-semibold text-ink">“{phrase}”</p>
        </div>
      </button>
    </section>
  );
}
