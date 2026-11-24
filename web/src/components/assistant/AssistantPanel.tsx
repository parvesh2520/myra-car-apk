import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Info, Keyboard, Mic, Send, Square, X } from 'lucide-react';
import { useAppState } from '../../context/AppStore';
import { activeProfile } from '../../context/actions';
import { useAssistant } from '../../context/AssistantContext';
import { VoiceOrb } from './VoiceOrb';

export const EXAMPLE_COMMANDS = [
  'AC 20 pe kar do',
  'Garmi lag rahi hai',
  'Romantic gaane chalao',
  'Ghar le chalo',
  'Fan speed badhao',
  'Volume badhao',
  'Gaane band karo',
  'Show navigation',
  'Hindi mein baat karo',
];

const STATUS_TEXT = {
  idle: 'Tap the mic or type',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking',
} as const;

export function AssistantPanel() {
  const state = useAppState();
  const assistant = useAssistant();
  const [draft, setDraft] = useState('');
  const [hovering, setHovering] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const driving = state.driveMode === 'driving';
  const profile = activeProfile(state);
  const { messages, status } = assistant;
  const canType = !driving || !assistant.recognitionSupported;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: state.settings.reduceMotion ? 'auto' : 'smooth' });
  }, [messages, assistant.interim, state.settings.reduceMotion]);

  // Tuck the panel away after a completed exchange so it never lingers over the screen.
  const last = messages[messages.length - 1];
  useEffect(() => {
    if (status !== 'idle' || assistant.awaitingConfirmation || hovering || draft || last?.role !== 'myra') return;
    const id = window.setTimeout(assistant.close, 9000);
    return () => window.clearTimeout(id);
  }, [status, assistant.awaitingConfirmation, hovering, draft, last, assistant.close]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    assistant.submit(draft);
    setDraft('');
  };

  const chips = assistant.quickReplies.length
    ? assistant.quickReplies
    : messages.length === 0 && state.settings.showVoiceChips
      ? EXAMPLE_COMMANDS
      : [];

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex justify-center px-6 pb-5 pt-16 pointer-events-none bg-gradient-to-t from-bg via-bg/70 to-transparent"
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      <section
        role="dialog"
        aria-label="Myra voice assistant"
        className="anim-rise pointer-events-auto w-full max-w-[1040px] card !rounded-[28px] !bg-surface/95 backdrop-blur-xl p-5 flex gap-5"
        style={{ boxShadow: '0 30px 60px -20px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(77 158 255 / 0.12)' }}
      >
        <div className="flex flex-col items-center justify-center gap-2 w-[120px] shrink-0">
          <VoiceOrb status={status} size={92} />
          <p className="text-xs font-medium text-ink-2 text-center" aria-live="polite">
            {STATUS_TEXT[status]}
          </p>
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div ref={logRef} className="scroll-y max-h-[150px] min-h-[64px] flex flex-col gap-2 pr-1" aria-live="polite">
            {messages.length === 0 && status !== 'listening' && (
              <p className="text-lg text-ink">
                Hi {profile.name}, I’m <span className="text-accent font-semibold">Myra</span>. Speak naturally — English, Hindi or Hinglish.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[0.9375rem] leading-snug ${
                    m.role === 'user' ? 'bg-accent text-on-accent rounded-br-md' : 'bg-surface-2 text-ink rounded-bl-md border border-line'
                  }`}
                >
                  {m.text}
                  {m.note && (
                    <span className="mt-1.5 flex items-center gap-1.5 text-[0.6875rem] text-ink-3">
                      <Info size={11} aria-hidden /> {m.note}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {status === 'listening' && (
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-[0.9375rem] border border-dashed border-accent/50 text-ink-2 italic">
                  {assistant.interim || 'Listening…'}
                </div>
              </div>
            )}
            {status === 'thinking' && (
              <div className="flex gap-1 px-2 py-2" aria-label="Myra is thinking">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-2 rounded-full bg-ink-3" style={{ animation: `breathe 1s ${i * 0.18}s infinite` }} />
                ))}
              </div>
            )}
          </div>

          {assistant.error && (
            <p className="text-sm text-warn flex items-center gap-2" role="alert">
              <Info size={15} aria-hidden /> {assistant.error}
            </p>
          )}

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Suggestions">
              {chips.map((c) => (
                <button key={c} type="button" className="chip" onClick={() => assistant.submit(c)}>
                  “{c}”
                </button>
              ))}
            </div>
          )}

          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <button
              type="button"
              onClick={status === 'listening' ? assistant.stopListening : assistant.listen}
              disabled={!assistant.recognitionSupported}
              className={`icon-btn !rounded-full shrink-0 ${status === 'listening' ? '!bg-accent !text-on-accent !border-transparent' : ''}`}
              aria-label={status === 'listening' ? 'Stop listening' : 'Start voice input'}
              title={assistant.recognitionSupported ? undefined : 'Voice input is not supported in this browser — please type'}
            >
              {status === 'listening' ? <Square size={16} fill="currentColor" /> : <Mic size={20} />}
            </button>
            {canType ? (
              <>
                <label className="sr-only" htmlFor="myra-input">
                  Type a request for Myra
                </label>
                <input
                  id="myra-input"
                  ref={inputRef}
                  className="input !rounded-full"
                  placeholder='Bolo ya likho… “AC 20 pe kar do”'
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoComplete="off"
                />
                <button type="submit" className="icon-btn !rounded-full shrink-0" disabled={!draft.trim()} aria-label="Send">
                  <Send size={18} />
                </button>
              </>
            ) : (
              <p className="flex-1 flex items-center gap-2 text-sm text-ink-3">
                <Keyboard size={16} aria-hidden /> Typing is paused while driving — tap the mic or a suggestion.
              </p>
            )}
            {!assistant.recognitionSupported && (
              <span className="text-[0.6875rem] text-ink-3 whitespace-nowrap">Voice not supported here</span>
            )}
          </form>
        </div>

        <button type="button" onClick={assistant.close} className="icon-btn !size-10 !rounded-full self-start shrink-0" aria-label="Close assistant">
          <X size={18} />
        </button>
      </section>
    </div>
  );
}
