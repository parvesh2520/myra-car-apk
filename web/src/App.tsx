import { useEffect } from 'react';
import { AppStoreProvider, useAppState } from './context/AppStore';
import { AssistantProvider } from './context/AssistantContext';
import { DriverMonitorProvider } from './context/DriverMonitorContext';
import { useSimulation } from './hooks/useSimulation';
import { useClock } from './hooks/useClock';
import { ScreenScaler } from './components/layout/ScreenScaler';
import { StandbyScreen } from './components/layout/StandbyScreen';
import { Shell } from './components/layout/Shell';

export default function App() {
  return (
    <AppStoreProvider>
      <AssistantProvider>
        <DriverMonitorProvider>
          <Display />
        </DriverMonitorProvider>
      </AssistantProvider>
    </AppStoreProvider>
  );
}

/** The infotainment display itself: theme, accessibility attributes and scaling. */
function Display() {
  const { settings, booted } = useAppState();
  const now = useClock(60_000);
  useSimulation();

  const hour = now.getHours();
  const theme = settings.autoDayNight ? (hour >= 7 && hour < 18 ? 'light' : 'dark') : settings.theme;

  useEffect(() => {
    document.documentElement.style.fontSize = settings.largeText ? '17.5px' : '16px';
    document.documentElement.lang = settings.uiLanguage === 'hi' ? 'hi' : 'en';
  }, [settings.largeText, settings.uiLanguage]);

  return (
    <ScreenScaler fit={settings.screenFit}>
      <div
        data-theme={theme}
        data-contrast={settings.highContrast ? 'high' : 'normal'}
        data-reduce-motion={settings.reduceMotion}
        className="relative w-full h-full overflow-hidden bg-bg text-ink font-sans"
      >
        {booted ? <Shell /> : <StandbyScreen />}
        {settings.brightness < 100 && (
          <div
            className="pointer-events-none absolute inset-0 z-[100] bg-black"
            style={{ opacity: (100 - settings.brightness) / 100 * 0.75 }}
            aria-hidden
          />
        )}
      </div>
    </ScreenScaler>
  );
}
