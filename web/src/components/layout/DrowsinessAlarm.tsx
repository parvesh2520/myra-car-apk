import { EyeOff } from 'lucide-react';
import { useDriverMonitor } from '../../context/DriverMonitorContext';

/** Full-screen alarm on every page while the driver's eyes stay closed (micro-sleep). */
export function DrowsinessAlarm() {
  const { status, metrics } = useDriverMonitor();
  if (status !== 'on' || metrics.level !== 'asleep') return null;
  return (
    <div role="alert" className="absolute inset-0 z-[90] grid place-items-center bg-danger/35 animate-pulse pointer-events-none">
      <div className="card px-10 py-8 flex flex-col items-center gap-3 !border-danger">
        <EyeOff size={48} className="text-danger" aria-hidden />
        <p className="text-4xl font-bold text-danger">WAKE UP!</p>
        <p className="text-ink-2">Eyes closed for {(metrics.closedMs / 1000).toFixed(1)} s — pull over safely and rest.</p>
      </div>
    </div>
  );
}
