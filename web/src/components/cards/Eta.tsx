import { useAppState } from '../../context/AppStore';
import { useClock } from '../../hooks/useClock';
import { formatClock } from '../../services/format';

/** Arrival time that stays current as the clock moves. */
export function Eta({ minutes }: { minutes: number }) {
  const now = useClock(15_000);
  const { settings } = useAppState();
  return <>{formatClock(new Date(now.getTime() + minutes * 60000), settings.clock24h)}</>;
}
