import { Mic } from 'lucide-react';
import { useAppState } from '../../context/AppStore';
import { useAssistant } from '../../context/AssistantContext';
import { useT } from '../../hooks/useT';

/** Persistent voice entry point in the dock. */
export function MicButton() {
  const assistant = useAssistant();
  const { assistantOpen } = useAppState();
  const t = useT();
  const listening = assistant.status === 'listening';

  const onClick = () => {
    if (listening) return assistant.stopListening();
    if (assistant.recognitionSupported) return assistant.listen();
    assistant.open();
  };

  return (
    <div className="flex flex-col items-center gap-1.5 pt-2">
      <button
        type="button"
        onClick={onClick}
        aria-label={listening ? 'Stop listening' : 'Talk to Myra'}
        aria-pressed={listening}
        aria-expanded={assistantOpen}
        className="relative size-[64px] rounded-full grid place-items-center text-white transition-transform active:scale-95"
        style={{
          background: 'radial-gradient(circle at 35% 30%, #8cc2ff 0%, #4d9eff 45%, #2363c4 100%)',
          boxShadow: '0 8px 24px -6px rgb(77 158 255 / 0.6), inset 0 1px 0 rgb(255 255 255 / 0.35)',
        }}
      >
        {listening && <span className="absolute inset-0 rounded-full border-2 border-accent" style={{ animation: 'ring 1.4s ease-out infinite' }} aria-hidden />}
        <Mic size={26} strokeWidth={2.2} aria-hidden />
      </button>
      <span className="text-[0.6875rem] font-semibold text-ink-2">{listening ? 'Listening' : t('askMyra')}</span>
    </div>
  );
}
