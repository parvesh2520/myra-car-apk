import { useEffect, useRef } from 'react';
import { Info, Mic, Square } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { useAssistant } from '../../context/AssistantContext';
import { PLACES } from '../../data/places';
import { EXAMPLE_COMMANDS } from '../assistant/AssistantPanel';
import { VoiceOrb } from '../assistant/VoiceOrb';

const STATUS_TEXT = {
  idle: 'Tap the mic and speak',
  listening: 'Listening… tap to stop',
  thinking: 'Understanding on the car…',
  speaking: 'Speaking',
} as const;

/**
 * The car app's only screen: the voice assistant and the car state it changes. The rest of the MYRA UI (maps,
 * media pages, camera features, simulation timers) is not loaded, so a low-end head unit keeps its RAM and CPU
 * for speech and the on-device model.
 */
export function CarScreen() {
  const state = useAppState();
  const actions = useActions();
  const assistant = useAssistant();
  const logRef = useRef<HTMLDivElement>(null);
  const { messages, status } = assistant;
  const listening = status === 'listening';
  const busy = status === 'thinking';

  useEffect(() => {
    if (!state.booted) actions.ui.boot(); // the assistant answers only once MYRA is "started"
  }, [state.booted, actions]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, assistant.interim]);

  const { climate, media, nav } = state;
  const destination = nav.destinationId ? PLACES.find((p) => p.id === nav.destinationId)?.name ?? nav.destinationId : '—';
  const car: [string, string][] = [
    ['AC', climate.ac ? 'On' : 'Off'],
    ['Temperature', `${climate.driver.temp}°C`],
    ['Fan', climate.fan ? `${climate.fan} / 7` : 'Off'],
    ['Volume', media.muted ? 'Muted' : `${media.volume} / 30`],
    ['Music', media.playing ? 'Playing' : 'Paused'],
    ['Navigation', destination],
  ];

  return (
    <div className="h-full w-full flex gap-5 p-5 bg-bg text-ink">
      <section className="w-[260px] shrink-0 flex flex-col items-center justify-center gap-4" aria-label="Voice">
        <VoiceOrb status={status} size={150} />
        <button
          type="button"
          onClick={listening ? assistant.stopListening : assistant.listen}
          disabled={busy}
          aria-label={listening ? 'Stop listening' : 'Talk to Myra'}
          className="relative size-[88px] rounded-full grid place-items-center text-white disabled:opacity-50"
          style={{ background: '#2f7fe6' }}
        >
          {listening && <span className="keep-motion absolute inset-0 rounded-full border-2 border-accent" style={{ animation: 'ring 1.4s ease-out infinite' }} aria-hidden />}
          {listening ? <Square size={30} fill="currentColor" aria-hidden /> : <Mic size={36} aria-hidden />}
        </button>
        <p className="text-sm font-medium text-ink-2 text-center" aria-live="polite">{STATUS_TEXT[status]}</p>
      </section>

      <section className="flex-1 min-w-0 flex flex-col gap-3" aria-label="Conversation">
        <h1 className="text-lg font-semibold">MYRA · on-device AI</h1>
        <div ref={logRef} className="scroll-y flex-1 min-h-0 flex flex-col gap-2 pr-1" aria-live="polite">
          {messages.length === 0 && (
            <p className="text-ink-2">Speak in any language. The car understands it with its own on-device model.</p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 leading-snug ${m.role === 'user' ? 'bg-accent text-on-accent' : 'bg-surface-2 border border-line'}`}>
                {m.text}
                {m.note && (
                  <span className="mt-1.5 flex items-start gap-1.5 text-xs text-ink-3">
                    <Info size={12} className="mt-0.5 shrink-0" aria-hidden /> {m.note}
                  </span>
                )}
              </div>
            </div>
          ))}
          {(listening || busy) && assistant.interim && <p className="text-right italic text-ink-2">{assistant.interim}</p>}
        </div>
        {assistant.error && (
          <p className="text-sm text-warn flex items-center gap-2" role="alert"><Info size={15} aria-hidden /> {assistant.error}</p>
        )}
        <div className="flex flex-wrap gap-2" aria-label="Try a command">
          {EXAMPLE_COMMANDS.slice(0, 6).map((c) => (
            <button key={c} type="button" className="chip" disabled={busy || listening} onClick={() => assistant.submit(c)}>“{c}”</button>
          ))}
        </div>
      </section>

      <section className="w-[230px] shrink-0 card p-4 flex flex-col gap-3" aria-label="Car state">
        <h2 className="text-sm font-semibold text-ink-2">Car state</h2>
        {car.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 text-[0.9375rem]">
            <span className="text-ink-3">{k}</span>
            <span className="font-semibold text-right truncate">{v}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
