import { useEffect, useState } from 'react';
import { Mic, Power } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { useAssistant } from '../../context/AssistantContext';
import { useClock } from '../../hooks/useClock';
import { formatClock } from '../../services/format';
import { MyraMark } from './MyraMark';

/**
 * Recreates the Verna's original standby display (clock, VERNA, start prompt)
 * and plays a short MYRA wake-up sequence before the home screen.
 */
export function StandbyScreen() {
  const { settings } = useAppState();
  const actions = useActions();
  const assistant = useAssistant();
  const now = useClock();
  const [booting, setBooting] = useState(false);

  useEffect(() => {
    if (!booting) return;
    const id = window.setTimeout(actions.ui.boot, settings.reduceMotion ? 250 : 1900);
    return () => window.clearTimeout(id);
  }, [booting, actions, settings.reduceMotion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !booting) setBooting(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [booting]);

  const lastReply = [...assistant.messages].reverse().find((m) => m.role === 'myra');

  if (booting) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-black" aria-live="polite">
        <div className="anim-rise flex flex-col items-center gap-5">
          <MyraMark className="h-14 [&>span]:text-[2.5rem] [&>span]:tracking-[0.34em]" />
          <p className="text-sm tracking-[0.18em] text-[#8a98ab] uppercase">Intelligent Mobility. Naturally Connected.</p>
          <div className="mt-6 h-[2px] w-56 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-[#4d9eff] origin-left" style={{ animation: `boot-bar ${settings.reduceMotion ? 200 : 1700}ms cubic-bezier(.4,0,.2,1) forwards` }} />
          </div>
          <style>{'@keyframes boot-bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}'}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-black flex flex-col items-center justify-center text-center select-none">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,255,255,0.035),transparent_55%)]" />
      <time className="text-[5.5rem] font-light leading-none tracking-tight text-[#8996a8] tabular-nums">{formatClock(now, settings.clock24h)}</time>
      <p className="mt-4 text-sm font-medium tracking-[0.9em] pl-[0.9em] text-[#46566b]">VERNA</p>
      <p className="mt-8 text-[0.8125rem] tracking-[0.06em] text-[#9aa6b6]">PRESS ENGINE START OR SAY “GAADI START KARO”</p>

      <div className="mt-12 flex items-center gap-5">
        <button
          type="button"
          onClick={() => setBooting(true)}
          className="group relative size-24 rounded-full grid place-items-center bg-gradient-to-b from-[#1b2533] to-[#0b1119] border border-white/10 text-[#cfd8e3] shadow-[0_0_0_6px_rgba(255,255,255,0.03)] transition-transform active:scale-95"
          aria-label="Engine start — wake MYRA"
        >
          <span className="absolute inset-2 rounded-full border border-[#4d9eff]/40 group-hover:border-[#4d9eff]/80 transition-colors" aria-hidden />
          <span className="flex flex-col items-center gap-1">
            <Power size={24} aria-hidden />
            <span className="text-[0.5625rem] font-bold tracking-[0.2em]">START</span>
          </span>
        </button>
        <button
          type="button"
          onClick={assistant.status === 'listening' ? assistant.stopListening : assistant.listen}
          disabled={!assistant.recognitionSupported}
          className={`size-14 rounded-full grid place-items-center border transition-colors ${
            assistant.status === 'listening' ? 'bg-[#4d9eff] text-[#04101f] border-transparent' : 'border-white/10 text-[#9aa6b6] hover:text-white'
          }`}
          aria-label={assistant.status === 'listening' ? 'Stop listening' : 'Say “Gaadi start karo”'}
          title={assistant.recognitionSupported ? 'Voice start' : 'Voice input is not supported in this browser'}
        >
          <Mic size={22} aria-hidden />
        </button>
      </div>
      <p className="mt-6 h-5 text-sm text-[#7d8ba0]" aria-live="polite">
        {assistant.status === 'listening'
          ? assistant.interim || 'Listening…'
          : assistant.error ?? lastReply?.text ?? ''}
      </p>
    </div>
  );
}
