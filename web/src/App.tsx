import { lazy, Suspense, useEffect } from 'react';
import { AppStoreProvider, useAppState } from './context/AppStore';
import { AssistantProvider } from './context/AssistantContext';
import { DriverMonitorProvider } from './context/DriverMonitorContext';
import { useSimulation } from './hooks/useSimulation';
import { useClock } from './hooks/useClock';
import { ScreenScaler } from './components/layout/ScreenScaler';
import { CarScreen } from './components/car/CarScreen';
import { inCarApp } from './services/carModel';

// The full infotainment UI is loaded only outside the car app, so a low-end head unit never parses or runs it.
const Shell = lazy(() => import('./components/layout/Shell').then((m) => ({ default: m.Shell })));
const StandbyScreen = lazy(() => import('./components/layout/StandbyScreen').then((m) => ({ default: m.StandbyScreen })));

export default function App() {
  if (inCarApp()) {
    // Car app: the voice assistant screen only. No camera monitor, simulation timers, maps or media pages.
    return (
      <AppStoreProvider>
        <AssistantProvider>
          <CarDisplay />
        </AssistantProvider>
      </AppStoreProvider>
    );
  }
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

function CarDisplay() {
  const { settings } = useAppState();
  return (
    <ScreenScaler fit={settings.screenFit}>
      <div data-theme="dark" data-contrast="normal" data-reduce-motion="true" data-car="true" className="relative w-full h-full overflow-hidden bg-bg text-ink font-sans">
        <CarScreen />
      </div>
    </ScreenScaler>
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
        <Suspense fallback={null}>{booted ? <Shell /> : <StandbyScreen />}</Suspense>
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
