import { BrainCircuit, Car, Fan, House, LayoutGrid, Lock, Navigation, Phone, Settings, EighthNotes, type LucideIcon } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { useT } from '../../hooks/useT';
import type { PageId } from '../../types';
import type { TKey } from '../../services/i18n';
import { MicButton } from '../assistant/MicButton';

export const NAV_ITEMS: { id: PageId; icon: LucideIcon; key: TKey }[] = [
  { id: 'home', icon: House, key: 'home' },
  { id: 'navigation', icon: Navigation, key: 'navigation' },
  { id: 'media', icon: EighthNotes, key: 'media' },
  { id: 'climate', icon: Fan, key: 'climate' },
  { id: 'phone', icon: Phone, key: 'phone' },
  { id: 'vehicle', icon: Car, key: 'vehicle' },
  { id: 'features', icon: BrainCircuit, key: 'features' },
  { id: 'apps', icon: LayoutGrid, key: 'apps' },
  { id: 'settings', icon: Settings, key: 'settings' },
];

/** Pages simplified or restricted while the demo is in Driving mode. */
export const DRIVING_LIMITED: PageId[] = ['settings', 'apps'];

export function Dock() {
  const { page, driveMode, phone } = useAppState();
  const actions = useActions();
  const t = useT();
  const driving = driveMode === 'driving';

  return (
    <nav aria-label="Main" className="relative z-20 w-[100px] shrink-0 flex flex-col items-center border-r border-line bg-bg/60 py-3">
      <ul className="flex-1 flex flex-col gap-1 w-full px-2.5" role="list">
        {NAV_ITEMS.map(({ id, icon: Icon, key }) => {
          const active = page === id;
          const limited = driving && DRIVING_LIMITED.includes(id);
          const badge = id === 'phone' && phone.call.status === 'incoming';
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => actions.ui.go(id)}
                aria-current={active ? 'page' : undefined}
                className={`group relative w-full h-[56px] flex flex-col items-center justify-center gap-1 rounded-2xl transition-colors duration-150 ${
                  active ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:text-ink hover:bg-surface-2'
                }`}
              >
                <span
                  className={`absolute left-[-10px] top-1/2 -translate-y-1/2 h-7 w-[3px] rounded-full bg-accent transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
                  aria-hidden
                />
                <span className="relative">
                  <Icon size={22} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                  {limited && (
                    <Lock size={11} className="absolute -right-2 -bottom-1 text-warn bg-bg rounded-full p-px" aria-label="Limited while driving" />
                  )}
                  {badge && <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-ok animate-pulse" aria-label="Incoming call" />}
                </span>
                <span className="text-[0.6875rem] font-medium leading-none">{t(key)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <MicButton />
    </nav>
  );
}
