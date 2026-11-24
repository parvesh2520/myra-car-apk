import { useEffect } from 'react';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';

export function Toast() {
  const { toast } = useAppState();
  const actions = useActions();

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => actions.ui.dismissToast(toast.id), 3600);
    return () => window.clearTimeout(id);
  }, [toast, actions]);

  if (!toast) return null;
  const Icon = toast.tone === 'success' ? CircleCheck : toast.tone === 'warning' ? TriangleAlert : Info;
  const tone = toast.tone === 'success' ? 'text-ok' : toast.tone === 'warning' ? 'text-warn' : 'text-accent';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[68px] z-50 flex justify-center" role="status" aria-live="polite">
      <div key={toast.id} className="anim-rise pointer-events-auto card flex items-center gap-3 pl-4 pr-5 h-12 !rounded-full">
        <Icon size={18} className={tone} aria-hidden />
        <span className="text-sm text-ink">{toast.text}</span>
      </div>
    </div>
  );
}
