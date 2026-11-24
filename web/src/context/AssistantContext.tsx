import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from './AppStore';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { expandCustomCommands, parseIntents, type Intent } from '../services/intentParser';
import { respond, type AssistantReply } from '../services/assistantBrain';
import { hasVoiceFor, speak, stopSpeaking } from '../services/speech';
import { api, ApiError, micErrorMessage, recordAudio, recordingSupported, type Entitlement, type Recording } from '../services/api';
import { fromCloudCommands, fromNlu } from '../services/backendIntents';
import { describeCommands, inCarApp, understandOnDevice } from '../services/carModel';
import type { AppState, VoiceLanguage } from '../types';

export type AssistantStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface ChatMessage {
  id: number;
  role: 'user' | 'myra';
  text: string;
  note?: string;
}

/** What the BhashaDrive backend offers this browser (null fields until the first check). */
export interface VoiceBackend {
  online: boolean;
  /** Premium cloud voice (Sarvam ASR + cloud LLM) is active and configured on the server. */
  premium: boolean;
  entitlement: Entitlement | null;
  asrEngine: string | null;
  nlu: string | null;
}

interface AssistantValue {
  status: AssistantStatus;
  messages: ChatMessage[];
  interim: string;
  error: string | null;
  quickReplies: string[];
  awaitingConfirmation: boolean;
  recognitionSupported: boolean;
  backend: VoiceBackend;
  refreshBackend: () => Promise<void>;
  open: () => void;
  close: () => void;
  listen: () => void;
  stopListening: () => void;
  submit: (text: string) => void;
}

const AssistantContext = createContext<AssistantValue | null>(null);

const speechLang = (lang: VoiceLanguage) => (lang === 'hi' ? 'hi-IN' : 'en-IN');
const DEVANAGARI = /[ऀ-ॿ]/;
const OFFLINE: VoiceBackend = { online: false, premium: false, entitlement: null, asrEngine: null, nlu: null };
let msgSeq = 0;

/** Small cockpit snapshot so the cloud assistant can resolve "thoda aur" (size-capped by the server). */
const snapshot = (s: AppState) => ({
  page: s.page,
  temperature: s.climate.driver.temp,
  ac: s.climate.ac,
  fan: s.climate.fan,
  volume: s.media.volume,
  muted: s.media.muted,
  playing: s.media.playing,
  destination: s.nav.destinationId,
});

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { state, actions } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;

  const [status, setStatus] = useState<AssistantStatus>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const pendingRef = useRef<Intent | null>(null);
  const [awaitingConfirmation, setAwaiting] = useState(false);
  const thinkTimer = useRef<number | undefined>(undefined);
  const [backend, setBackend] = useState<VoiceBackend>(OFFLINE);
  const backendRef = useRef(backend);
  backendRef.current = backend;
  const recordingRef = useRef<Recording | null>(null);
  const lastAsrRef = useRef<string | null>(null); // engine that transcribed the pending utterance (car log)
  const [voiceInterim, setVoiceInterim] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const recognition = useSpeechRecognition(speechLang(state.settings.voiceLanguage));
  const clearRecognitionError = recognition.clearError;

  const addMessage = (m: Omit<ChatMessage, 'id'>) =>
    setMessages((prev) => [...prev.slice(-11), { ...m, id: ++msgSeq }]);

  const refreshBackend = useCallback(async () => {
    try {
      const [health, ent] = await Promise.all([api.health(), api.entitlement().catch(() => null)]);
      setBackend({ online: true, premium: !!ent?.premium_available, entitlement: ent, asrEngine: health.asr_ready ? health.asr : null, nlu: health.nlu });
    } catch {
      setBackend(OFFLINE);
    }
  }, []);

  useEffect(() => {
    void refreshBackend();
  }, [refreshBackend]);

  /** Shows (and speaks) one reply. */
  const deliver = useCallback(
    (reply: AssistantReply) => {
      const current = stateRef.current;
      pendingRef.current = reply.pending ?? null;
      setQuickReplies(reply.quickReplies ?? []);
      const canSpeakLang = reply.lang !== 'hi' || hasVoiceFor('hi-IN');
      const note =
        reply.note ??
        (reply.lang === 'hi' && current.settings.speakResponses && !canSpeakLang
          ? 'No Hindi voice is installed in this browser, so this reply is shown as text only.'
          : undefined);
      addMessage({ role: 'myra', text: reply.text, note });
      if (reply.page) actions.ui.go(reply.page);

      if (current.settings.speakResponses && canSpeakLang) {
        const started = speak(reply.text, speechLang(reply.lang), current.settings.voiceRate, () => setStatus('idle'));
        setStatus(started ? 'speaking' : 'idle');
      } else {
        setStatus('idle');
      }
    },
    [actions],
  );

  /** MYRA's local parser, then the backend's offline NLU for sentences the local parser cannot read. */
  const understandLocally = useCallback(
    async (text: string, current: AppState): Promise<AssistantReply> => {
      const expanded = expandCustomCommands(text, current.settings.customCommands);
      let intents = parseIntents(expanded);
      if (backendRef.current.online && intents.every((i) => i.type === 'unknown')) {
        try {
          const nlu = fromNlu(await api.text(expanded));
          if (nlu.length) intents = nlu;
        } catch {
          /* offline NLU unavailable: keep the local result */
        }
      }
      const reply = respond(intents, current, actions, pendingRef.current);
      setAwaiting(!!reply.pending);
      return reply;
    },
    [actions],
  );

  /**
   * Understanding, in order: in the car app, the on-device model (Gemma 3 1B); otherwise the premium cloud assistant (when the server grants it), then MYRA's local parser,
   * then the backend's offline NLU for sentences the local parser cannot read. Every action runs through
   * `respond`, MYRA's own executor.
   */
  const understand = useCallback(
    async (text: string, current: AppState): Promise<AssistantReply> => {
      const be = backendRef.current;
      if (inCarApp()) {
        // Car app: the transcript is understood on the device; every result also goes to the server's car log.
        const asr = lastAsrRef.current;
        lastAsrRef.current = null;
        try {
          const r = await understandOnDevice(text);
          const { intents, unsupported } = fromCloudCommands(r.commands);
          const reply = intents.length
            ? respond(intents, current, actions, null)
            : unsupported.length
              ? { text: 'I understood that, but this simulator can’t do it.', lang: current.settings.voiceLanguage }
              : await understandLocally(text, current); // yes/no answers and small talk
          if (intents.length || unsupported.length) setAwaiting(!!reply.pending);
          void api.carLog({ transcript: text, commands: r.commands, model: r.model, latency_ms: r.latency_ms, asr_engine: asr, reply: reply.text })
            .catch(() => undefined);
          const understood = `Car understood on-device (${r.model}, ${r.latency_ms} ms): ${describeCommands(r.commands)}.`;
          return { ...reply, note: [understood, reply.note].filter(Boolean).join(' ') };
        } catch (e) {
          const reply = await understandLocally(text, current);
          return { ...reply, note: `On-device model unavailable (${(e as Error).message}). MYRA’s built-in parser answered.` };
        }
      }
      if (be.premium) {
        try {
          const r = await api.cloudInterpret(text, snapshot(current));
          const lang: VoiceLanguage = DEVANAGARI.test(r.spoken_response) ? 'hi' : current.settings.voiceLanguage;
          const { intents, unsupported } = fromCloudCommands(r.actions);
          const done = intents.length ? respond(intents, current, actions, null) : null;
          setAwaiting(r.status === 'confirm');
          return {
            text: r.spoken_response || done?.text || 'Okay.',
            lang,
            page: done?.page,
            quickReplies: r.status === 'confirm' ? ['Haan', 'Nahi'] : done?.quickReplies,
            note: unsupported.length
              ? `Not available in this simulator: ${unsupported.join(', ')}.`
              : done?.note,
          };
        } catch (e) {
          // 503 = cloud LLM unavailable: fall through to on-device understanding (nothing was executed).
          if (!(e instanceof ApiError) || e.status === 403) void refreshBackend();
        }
      }

      return understandLocally(text, current);
    },
    [actions, refreshBackend, understandLocally],
  );

  const submit = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const s = stateRef.current;
      actions.ui.setAssistantOpen(true);
      clearRecognitionError();
      setVoiceError(null);
      addMessage({ role: 'user', text });
      setQuickReplies([]);
      setStatus('thinking');
      window.clearTimeout(thinkTimer.current);

      // A short, natural pause before replying; skipped when reduced motion is on.
      const delay = s.settings.reduceMotion ? 0 : 450;
      thinkTimer.current = window.setTimeout(async () => {
        const current = stateRef.current;
        if (!current.booted) {
          const intents = parseIntents(text);
          if (intents.some((i) => i.type === 'system.start')) {
            actions.ui.boot();
            addMessage({ role: 'myra', text: 'Namaste! MYRA is starting up.' });
          } else {
            addMessage({ role: 'myra', text: 'Say “Gaadi start karo” or tap Start to wake MYRA.' });
          }
          setStatus('idle');
          return;
        }
        deliver(await understand(text, current));
      }, delay);
    },
    [actions, clearRecognitionError, deliver, understand],
  );

  /** Records with MediaRecorder and transcribes on the backend (cloud for premium, on-device otherwise). */
  const listenWithBackend = useCallback(async () => {
    setVoiceError(null);
    setVoiceInterim('');
    let rec: Recording;
    try {
      rec = await recordAudio();
    } catch (e) {
      setVoiceError(micErrorMessage(e));
      return;
    }
    recordingRef.current = rec;
    setStatus('listening');
    const audio = await rec.done;
    recordingRef.current = null;
    if (audio.size < 1000) {
      setStatus('idle');
      setVoiceError('I didn’t hear anything. Tap the mic and try again.');
      return;
    }
    setStatus('thinking');
    setVoiceInterim('Recognising…');
    try {
      const premium = backendRef.current.premium;
      const t = premium ? await api.cloudTranscribe(audio) : await api.transcribe(audio);
      setVoiceInterim('');
      // Driver recognised from the voice: apply that profile (enrolled voiceprints only).
      lastAsrRef.current = t.engine;
      const who = t.speaker?.profile;
      const s = stateRef.current;
      if (who && who !== s.activeProfileId && s.profiles.some((p) => p.id === who)) actions.profiles.switchTo(who);
      if (t.text.trim()) submit(t.text);
      else {
        setStatus('idle');
        setVoiceError(t.error ?? 'I didn’t hear anything. Tap the mic and try again.');
      }
    } catch (e) {
      setVoiceInterim('');
      setStatus('idle');
      setVoiceError(e instanceof ApiError && e.status === 503
        ? 'Speech recognition isn’t available on the server. You can type your request.'
        : 'Couldn’t reach MYRA’s speech service. You can type your request.');
      void refreshBackend();
    }
  }, [actions, refreshBackend, submit]);

  const listen = useCallback(() => {
    stopSpeaking();
    actions.ui.setAssistantOpen(true);
    if (backendRef.current.online && recordingSupported()) void listenWithBackend();
    else recognition.start((finalText) => submit(finalText));
  }, [actions, listenWithBackend, recognition, submit]);

  const stopListening = useCallback(() => {
    if (recordingRef.current) void recordingRef.current.stop();
    else recognition.stop();
  }, [recognition]);

  useEffect(() => {
    if (recognition.listening) setStatus('listening');
    else setStatus((s) => (s === 'listening' && !recordingRef.current ? 'idle' : s));
  }, [recognition.listening]);

  useEffect(() => () => window.clearTimeout(thinkTimer.current), []);

  const close = useCallback(() => {
    stopListening();
    stopSpeaking();
    setStatus('idle');
    actions.ui.setAssistantOpen(false);
  }, [actions, stopListening]);

  const value = useMemo<AssistantValue>(
    () => ({
      status,
      messages,
      interim: recognition.interim || voiceInterim,
      error: recognition.error ?? voiceError,
      quickReplies,
      awaitingConfirmation,
      recognitionSupported: recognition.supported || (backend.online && recordingSupported()),
      backend,
      refreshBackend,
      open: () => actions.ui.setAssistantOpen(true),
      close,
      listen,
      stopListening,
      submit,
    }),
    [status, messages, recognition.interim, recognition.error, recognition.supported, voiceInterim, voiceError, quickReplies, awaitingConfirmation, backend, refreshBackend, actions, close, listen, stopListening, submit],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistant must be used inside <AssistantProvider>');
  return ctx;
}
