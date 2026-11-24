import { useEffect, type ComponentType } from 'react';
import { useAppState } from '../../context/AppStore';
import { useAssistant } from '../../context/AssistantContext';
import type { PageId } from '../../types';
import { StatusBar } from './StatusBar';
import { Toast } from './Toast';
import { CallOverlay } from './CallOverlay';
import { DrowsinessAlarm } from './DrowsinessAlarm';
import { MotionSenseOverlay } from './MotionSenseOverlay';
import { Dock } from '../navigation/Dock';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { HomePage } from '../../pages/Home/HomePage';
import { NavigationPage } from '../../pages/Navigation/NavigationPage';
import { MediaPage } from '../../pages/Media/MediaPage';
import { ClimatePage } from '../../pages/Climate/ClimatePage';
import { PhonePage } from '../../pages/Phone/PhonePage';
import { VehiclePage } from '../../pages/Vehicle/VehiclePage';
import { AppsPage } from '../../pages/Apps/AppsPage';
import { FeaturesPage } from '../../pages/Features/FeaturesPage';
import { SettingsPage } from '../../pages/Settings/SettingsPage';

const PAGES: Record<PageId, ComponentType> = {
  home: HomePage,
  navigation: NavigationPage,
  media: MediaPage,
  climate: ClimatePage,
  phone: PhonePage,
  vehicle: VehiclePage,
  apps: AppsPage,
  features: FeaturesPage,
  settings: SettingsPage,
};

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName));

export function Shell() {
  const { page, assistantOpen, vehicle } = useAppState();
  const assistant = useAssistant();
  const Page = PAGES[page];

  // Space = talk to Myra (as in the original cockpit), Escape = dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && assistantOpen) assistant.close();
      if (e.code === 'Space' && !isTyping(e.target) && !e.repeat) {
        e.preventDefault();
        if (assistant.status === 'listening') assistant.stopListening();
        else if (assistant.recognitionSupported) assistant.listen();
        else assistant.open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assistant, assistantOpen]);

  return (
    <div className="relative flex flex-col h-full">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: 'radial-gradient(1200px 500px at 15% -10%, rgb(77 158 255 / 0.08), transparent 60%)' }}
        aria-hidden
      />
      <StatusBar />
      <div
        className="h-px w-full opacity-60"
        style={{ background: `linear-gradient(90deg, transparent, ${vehicle.ambientColour}, transparent)`, opacity: vehicle.ambientBrightness / 12 }}
        aria-hidden
      />
      <div className="relative flex flex-1 min-h-0">
        <Dock />
        <main className="relative flex-1 min-w-0 overflow-hidden" id="main">
          <div key={page} className="anim-page h-full">
            <Page />
          </div>
          {assistantOpen && <AssistantPanel />}
        </main>
      </div>
      <CallOverlay />
      <MotionSenseOverlay />
      <DrowsinessAlarm />
      <Toast />
    </div>
  );
}
