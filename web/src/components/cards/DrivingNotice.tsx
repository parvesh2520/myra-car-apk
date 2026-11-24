import { Lock } from 'lucide-react';
import { useActions } from '../../context/AppStore';
import { useT } from '../../hooks/useT';

/** Shown in place of parked-only content during the Driving demo mode. */
export function DrivingNotice({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const actions = useActions();
  return (
    <div className={`flex ${compact ? 'items-center gap-3 p-4' : 'flex-col items-center justify-center text-center gap-3 p-8 h-full'} card-inset`}>
      <span className="grid place-items-center size-11 rounded-full bg-warn/15 text-warn shrink-0">
        <Lock size={20} aria-hidden />
      </span>
      <div className={compact ? 'flex-1' : ''}>
        <p className="font-semibold text-ink">{t('restricted')}</p>
        <p className={`text-sm text-ink-2 ${compact ? '' : 'max-w-md mt-1'}`}>{t('restrictedBody')}</p>
      </div>
      <button type="button" className="btn shrink-0" onClick={() => actions.ui.setDriveMode('parked')}>
        Switch demo to Parked
      </button>
    </div>
  );
}
