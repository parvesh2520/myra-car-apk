import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Languages, Mic, Play, RotateCcw, Square } from 'lucide-react';
import { recordAudio } from '../../services/api';
import { bharat, play, runTurn, type BharatStatus, type Lang, type SessionState, type Speaker, type Stage, type Turn } from '../../services/bharat';

const FALLBACK_LANGS = [
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', speech: true },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', speech: true },
  { code: 'en', name: 'English', native: 'English', speech: true },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', speech: true },
];
const STATE_LABEL: Record<SessionState, string> = {
  idle: 'Ready', recording: 'Listening…', transcribing: 'Transcribing…', translating: 'Translating…',
  generating_audio: 'Generating speech…', playing_audio: 'Playing translation', error: 'Needs attention',
};
const TURN_LABEL: Record<Turn['status'], string> = {
  transcribing: 'Transcribing…', translating: 'Translating…', generating_audio: 'Generating speech…',
  playing_audio: 'Playing', done: 'Done', error: 'Failed',
};
const ROLE: Record<Speaker, string> = { driver: 'Driver', passenger: 'Passenger' };
const OTHER: Record<Speaker, Speaker> = { driver: 'passenger', passenger: 'driver' };
const secs = (ms?: number) => (ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`);

/** Two-way driver <-> passenger voice translation (continuous conversational flow & push-to-talk). Each person
 *  picks the language they hear; the language they speak is detected from the recording. */
export function BharatTranslator() {
  const [status, setStatus] = useState<BharatStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [langs, setLangs] = useState<Record<Speaker, Lang>>({ driver: 'hi', passenger: 'en' });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [rec, setRec] = useState<{ speaker: Speaker; stop: () => Promise<Blob> } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [autoConversation, setAutoConversation] = useState(true);

  const autoRef = useRef(true);
  autoRef.current = autoConversation;
  const autoTimer = useRef<number | null>(null);
  const isClosed = useRef(false);
  const activeStopRef = useRef<(() => Promise<Blob>) | null>(null);

  const nextId = useRef(1);
  const history = useRef<HTMLOListElement>(null);

  const clearAutoTimer = useCallback(() => {
    if (autoTimer.current !== null) {
      window.clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
  }, []);


  useEffect(() => {
    isClosed.current = false;
    const refresh = () => bharat.status().then((s) => { setStatus(s); setOffline(false); }).catch(() => setOffline(true));
    void refresh();
    void bharat.warmup().then(refresh); // load the speech model before the first turn
    return () => {
      isClosed.current = true;
      clearAutoTimer();
      if (activeStopRef.current) {
        void activeStopRef.current();
      }
    };
  }, [clearAutoTimer]);

  useEffect(() => { history.current?.scrollTo({ top: history.current.scrollHeight, behavior: 'smooth' }); }, [turns]);

  const upsert = useCallback((t: Turn) => setTurns((ts) => ts.map((x) => (x.id === t.id ? t : x))), []);
  // `endedAt` (end of speech) starts the latency clock; a retry starts it when it begins.
  const run = useCallback(async (t: Turn, from: Stage, endedAt?: number): Promise<boolean> => {
    setBusy(t.id);
    const success = await runTurn(t, from, endedAt ?? performance.now(), upsert);
    setBusy(null);
    return success;
  }, [upsert]);

  // Recording, or any turn in flight (including playback), locks both microphones: no overlapping
  // requests, and the system never records its own translated speech.
  const locked = rec !== null || busy !== null;
  const active = turns.find((t) => t.id === busy);
  const last = turns[turns.length - 1];
  const state: SessionState = rec ? 'recording'
    : active && active.status !== 'done' ? (active.status as SessionState)
      : last?.status === 'error' ? 'error' : 'idle';

  const talk = async (speaker: Speaker) => {
    clearAutoTimer();
    if (rec) {
      if (rec.speaker === speaker) void rec.stop();
      return;
    }
    if (busy !== null || isClosed.current) return;
    setMicError(null);
    let r: Awaited<ReturnType<typeof recordAudio>>;
    try {
      r = await recordAudio(10000, 900);
    } catch {
      setMicError('The microphone is blocked or unavailable. Allow microphone access and try again.');
      return;
    }
    if (isClosed.current) {
      void r.stop();
      return;
    }
    activeStopRef.current = r.stop;
    setRec({ speaker, stop: r.stop });
    const recording = await r.done;
    activeStopRef.current = null;
    const endedAt = performance.now();
    setRec(null);

    if (isClosed.current) return;

    const target = langs[OTHER[speaker]];
    const textOnly = (status?.languages ?? FALLBACK_LANGS).find((l) => l.code === target)?.speech === false;
    const t: Turn = { id: nextId.current++, speaker, target, textOnly, status: 'transcribing', timings: {}, recording };
    setTurns((ts) => [...ts, t]);
    const success = await run(t, 'transcribing', endedAt);

    // Continuous conversation: automatically trigger the other speaker once TTS playback ends!
    if (success && autoRef.current && !isClosed.current) {
      clearAutoTimer();
      autoTimer.current = window.setTimeout(() => {
        if (autoRef.current && !isClosed.current) {
          void talk(OTHER[speaker]);
        }
      }, 500);
    }
  };

  const retry = (t: Turn) => {
    clearAutoTimer();
    const stage = t.error?.stage;
    const from: Stage = stage === 'translating' ? 'translating' : stage === 'generating_audio' || stage === 'playing_audio' ? 'generating_audio' : 'transcribing';
    void run({ ...t, retried: true }, from).then((success) => {
      if (success && autoRef.current && !isClosed.current) {
        clearAutoTimer();
        autoTimer.current = window.setTimeout(() => {
          if (autoRef.current && !isClosed.current) {
            void talk(OTHER[t.speaker]);
          }
        }, 500);
      }
    });
  };

  const replay = (t: Turn) => {
    clearAutoTimer();
    setBusy(t.id);
    let cur = t;
    void play(t, null, (patch) => { cur = { ...cur, ...patch, timings: { ...cur.timings, ...patch.timings } }; upsert(cur); })
      .then(() => setBusy(null));
  };

  const endSession = () => {
    clearAutoTimer();
    if (activeStopRef.current) void activeStopRef.current();
    setTurns([]);
    setMicError(null);
  };

  const languages = status?.languages ?? FALLBACK_LANGS;
  const langName = (c: Lang) => languages.find((l) => l.code === c)?.name ?? c;
  const problem = offline ? 'The BharatConnect server is not reachable. Start the backend and reopen this app.'
    : status?.translation.problem ? `Translation is not set up on the server (${status.translation.problem}). See backend README → BharatConnect.`
      : micError;

  return (
    <section className="card-inset p-4 flex flex-col gap-3" aria-label="BharatConnect voice translation">
      <header className="flex items-center gap-3">
        <Languages size={22} className="text-accent shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink">Voice interpreter</p>
          <p className="text-xs text-ink-2">Driver ↔ passenger translation · spoken language is detected</p>
        </div>
        <button type="button" className={`chip ${autoConversation ? 'is-active' : ''}`} aria-pressed={autoConversation}
          onClick={() => { clearAutoTimer(); setAutoConversation((v) => !v); }}
          title={autoConversation ? 'Speakers alternate automatically' : 'Push-to-talk for each turn'}>
          Auto {autoConversation ? 'on' : 'off'}
        </button>
        <span className={`text-xs font-medium ${state === 'error' ? 'text-warn' : 'text-ink-2'}`} aria-live="polite">{STATE_LABEL[state]}</span>
        <button type="button" className="icon-btn !size-10" onClick={endSession} disabled={locked || !turns.length} aria-label="Clear the conversation">
          <RotateCcw size={16} />
        </button>
      </header>

      {problem && <p className="text-sm text-warn flex items-start gap-2" role="alert"><AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden />{problem}</p>}

      <div className="grid grid-cols-2 gap-3">
        {(['driver', 'passenger'] as Speaker[]).map((sp) => {
          const mine = rec?.speaker === sp;
          return (
            <div key={sp} className={`tile p-3 flex flex-col gap-2 ${mine ? 'is-active' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{ROLE[sp]}</span>
                <select className="input !w-40 !min-h-9 !text-sm cursor-pointer" value={langs[sp]} disabled={locked} aria-label={`${ROLE[sp]} hears`}
                  onChange={(e) => setLangs({ ...langs, [sp]: e.target.value })}>
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>{l.native === l.name ? l.name : `${l.name} · ${l.native}`}{l.speech ? '' : ' (text)'}</option>
                  ))}
                </select>
              </div>
              <button type="button" className={`btn ${mine ? '' : 'btn-primary'}`} onClick={() => void talk(sp)} disabled={locked && !mine}
                aria-label={mine ? `Stop ${ROLE[sp]} recording` : `${ROLE[sp]}: speak`}>
                {mine ? <Square size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
                {mine ? 'Stop' : 'Speak'}
              </button>
              <p className="text-xs text-ink-3">
                {mine ? 'Listening… tap to stop' : locked ? 'Wait for the translation' : `${ROLE[OTHER[sp]]} hears ${langName(langs[OTHER[sp]])}`}
              </p>
            </div>
          );
        })}
      </div>

      <ol className="flex flex-col gap-2 max-h-64 overflow-y-auto" ref={history} aria-label="Conversation">
        {!turns.length && <li className="text-sm text-ink-3">Each turn appears here: what was said, its translation, and how long it took.</li>}
        {turns.map((t) => (
          <li key={t.id} className={`rounded-xl border border-line p-3 ${t.speaker === 'driver' ? '' : 'ml-8'}`}>
            <div className="flex items-center gap-2 text-xs text-ink-2">
              <b className="text-ink">{ROLE[t.speaker]}</b>
              <span>{t.source ? langName(t.source) : 'Detecting…'} → {langName(t.target)}{t.textOnly && ' (text only)'}</span>
              <em className={`ml-auto not-italic ${t.status === 'error' ? 'text-warn' : ''}`}>{TURN_LABEL[t.status]}</em>
            </div>
            <p className="text-sm text-ink-2 mt-1">{t.original ?? (t.status === 'transcribing' ? '…' : '')}</p>
            {t.translated && <p className="text-[0.9375rem] text-ink font-medium mt-1" lang={t.target}>{t.translated}</p>}
            {t.error && (
              <p className="text-sm text-warn mt-2 flex items-center gap-2">
                <AlertTriangle size={14} aria-hidden /><span className="flex-1">{t.error.message}</span>
                {(t.error.retryable || t.error.stage !== 'transcribing') && (
                  <button type="button" className="btn !min-h-9 !text-sm" onClick={() => retry(t)} disabled={locked}><RotateCcw size={14} aria-hidden />Retry</button>
                )}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2">
              {t.speech && (t.needsPlay || t.status === 'done') && (
                <button type="button" className="btn !min-h-9 !text-sm" onClick={() => replay(t)} disabled={locked}>
                  <Play size={14} aria-hidden />{t.needsPlay ? 'Play translation' : 'Play again'}
                </button>
              )}
              {(t.timings.asr !== undefined || t.timings.total !== undefined) && (
                <span className="text-xs text-ink-3 tabular-nums" title="Measured in the browser, from the end of speech until the translation starts playing.">
                  ASR {secs(t.timings.asr)} · Translate {secs(t.timings.translate)} · Speech {secs(t.timings.tts)} · Total {secs(t.timings.total)}{t.retried && ' (retry)'}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
