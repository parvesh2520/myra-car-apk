/**
 * Client for the BhashaDrive V2 backend (FastAPI, ../../backend). Every route is served under `/api`.
 * The browser never sees provider keys: Sarvam, Groq/OpenAI and Google are called by the server only.
 *
 * Base URL: `VITE_API_URL` (e.g. http://127.0.0.1:8000/api) or `/api` — proxied to the backend by Vite in
 * development and served by the backend itself in production builds.
 */

const rawApi = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
export const API = rawApi ? rawApi.replace(/\/+$/, '') : '/api';

const TIMEOUT_MS = 4000;
const TRANSCRIBE_TIMEOUT_MS = 30000; // on-device CPU speech recognition takes a few seconds per utterance
const CLOUD_TRANSCRIBE_TIMEOUT_MS = 30000; // Sarvam (one retry) or the on-device fallback
const CLOUD_INTERPRET_TIMEOUT_MS = 25000; // cloud LLM (one retry)

/** A failed API call: HTTP status and the backend's error code (`detail.code`), if any. */
export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(path: string, status: number, code: string | null, message?: string) {
    super(message ?? `${path}: HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, { ...init, signal: ctrl.signal });
    } catch {
      throw new ApiError(path, 0, ctrl.signal.aborted ? 'timeout' : 'network',
        ctrl.signal.aborted ? 'The server took too long to answer.' : 'Cannot reach the MYRA backend.');
    }
    if (!res.ok) {
      const detail = (await res.json().catch(() => null))?.detail;
      const message = typeof detail === 'string' ? detail : typeof detail?.message === 'string' ? detail.message : undefined;
      throw new ApiError(path, res.status, detail?.code ?? null, message);
    }
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(t);
  }
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const audioExt = (b: Blob) => (b.type.includes('mp4') ? 'mp4' : b.type.includes('ogg') ? 'ogg' : 'webm');

function audioForm(audio: Blob, name: string): FormData {
  const fd = new FormData();
  fd.append('file', audio, `${name}.${audioExt(audio)}`);
  return fd;
}

/* ---------- response types (mirroring backend/bhashadrive/api/server.py and assistant/api.py) ---------- */

export interface BackendHealth {
  nlu: string;
  asr: string | null;
  asr_ready: boolean;
  llm: string | null;
  llm_ready: boolean;
  vehicle: string;
  /** True when the backend runs the test pipeline (trained NLU models not installed). */
  mock: boolean;
}

export interface SpeakerMatch {
  profile: string;
  score: number;
}

export interface Transcription {
  /** Recogniser output after phonetic + attention rescoring. */
  text: string;
  hypotheses?: string[];
  status: string;
  error: string | null;
  engine: string | null;
  /** Driver recognised from the voice (enrolled voiceprints), or null. */
  speaker?: SpeakerMatch | null;
}

export interface CloudTranscription extends Transcription {
  language: string | null;
  /** Why the on-device recogniser answered instead of the cloud (auth, quota, network…), or null. */
  fallback: string | null;
}

/** Voice tier for this browser, decided by the backend (subscription token or the dev switch). */
export interface Entitlement {
  tier: 'free' | 'premium';
  source: string;
  expired: boolean;
  premium_available: boolean;
  /** Names of missing server settings, never their values. */
  problems: string[];
  dev_tier_switch: boolean;
  asr_model: string;
  llm_model: string;
  configured: boolean;
}

/** One cockpit command in the backend's schema (backend/bhashadrive/nlu/cockpit_commands.py). */
export interface BackendCommand {
  type: string;
  [field: string]: unknown;
}

/** The cloud assistant's validated answer. `actions` run now; `pending_actions` wait for a spoken yes. */
export interface CloudReply {
  status: 'execute' | 'confirm' | 'clarify' | 'unsupported' | 'chat' | 'cancelled';
  actions: BackendCommand[];
  pending_actions: BackendCommand[];
  spoken_response: string;
  requires_confirmation: boolean;
  confidence: number;
}

/** Offline V2 NLU result for one sentence (backend/bhashadrive/schemas_v2.py `ResultV2`, trimmed). */
export interface NluResult {
  transcript: string;
  intent: string | null;
  decision: 'execute' | 'ask_confirmation' | 'clarify' | 'reject' | 'saved';
  reason_code: string;
  response_text: string;
  confidence: number | null;
  action: {
    intent: string;
    parameters: {
      direction?: 'warmer' | 'cooler' | null;
      amount?: 'small' | 'medium' | 'large' | null;
      target_temperature_celsius?: number | null;
      destination?: string | null;
    };
  } | null;
}

export interface SpeakerStatus {
  ready: boolean;
  enrolled: Record<string, number>;
}

export interface Connectivity {
  is_offline: boolean;
  active_engine?: string;
  [k: string]: unknown;
}

export const api = {
  health: () => call<BackendHealth>('/health'),
  entitlement: () => call<Entitlement>('/assistant/entitlement'),
  /** Development only: refused unless BD_DEV_TIER_SWITCH is on and the request is from loopback. */
  setDevTier: (tier: 'free' | 'premium') => call<Entitlement>('/assistant/dev-tier', postJson({ tier })),

  /** Premium: Sarvam Saaras transcript (on-device ASR if the cloud fails). */
  cloudTranscribe: (audio: Blob) =>
    call<CloudTranscription>('/assistant/transcribe', { method: 'POST', body: audioForm(audio, 'speech') }, CLOUD_TRANSCRIBE_TIMEOUT_MS),
  /** Premium: transcript -> allowlisted cockpit commands. 503 means "use the on-device understanding". */
  cloudInterpret: (text: string, state: object) =>
    call<CloudReply>('/assistant/interpret', postJson({ text, state }), CLOUD_INTERPRET_TIMEOUT_MS),

  /** Free tier: on-device speech recognition (sherpa-onnx / faster-whisper) + speaker identification. */
  transcribe: (audio: Blob) =>
    call<Transcription>('/transcribe', { method: 'POST', body: audioForm(audio, 'speech') }, TRANSCRIBE_TIMEOUT_MS),
  /** Offline NLU (ONNX encoder + trained heads) for one sentence. */
  text: (text: string) => call<NluResult>('/text', postJson({ text })),
  reset: () => call<{ ok: boolean }>('/reset', { method: 'POST' }),

  connectivity: () => call<Connectivity>('/connectivity'),
  setOffline: (offline: boolean) => call<Connectivity>('/connectivity', postJson({ offline })),

  speakers: () => call<SpeakerStatus>('/speaker'),
  /** Adds one spoken sentence to a profile's voiceprint (the backend keeps only the embedding). */
  enroll: (profile: string, audio: Blob) =>
    call<{ profile: string; samples: number }>(`/speaker/${encodeURIComponent(profile)}`, { method: 'POST', body: audioForm(audio, 'voice') }, TRANSCRIBE_TIMEOUT_MS),
  forget: (profile: string) => call<{ samples: number }>(`/speaker/${encodeURIComponent(profile)}`, { method: 'DELETE' }),

  /** Car app: records what the on-device model understood (printed in the server log, listed at GET /device/log). */
  carLog: (entry: { transcript: string; commands: BackendCommand[]; model: string; latency_ms: number; asr_engine: string | null; reply: string }) =>
    call<{ ok: boolean }>('/device/log', postJson(entry)),
};

/* ---------- microphone ---------- */

export const recordingSupported = () =>
  typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

/** Maps a getUserMedia failure to a message the driver can act on. */
export function micErrorMessage(e: unknown): string {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access is blocked. Allow it in the browser, or type your request.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. You can type your request instead.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  return 'Couldn’t start the microphone. Please try again.';
}

export interface Recording {
  /** Ends the recording now; resolves with the audio. */
  stop: () => Promise<Blob>;
  /** Resolves when the recording ends (silence after speech, `maxMs`, or `stop`). */
  done: Promise<Blob>;
}

// The microphone and its analyser stay open between commands: opening them takes seconds on a slow head unit.
let mic: { stream: MediaStream; ctx: AudioContext; analyser: AnalyserNode } | null = null;

async function openMic() {
  if (mic && mic.stream.getAudioTracks().some((t) => t.readyState === 'live')) return mic;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
  });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  mic = { stream, ctx, analyser };
  return mic;
}

/**
 * Records one utterance. It ends on `stop()`, after `silenceMs` of quiet once speech was heard, or at `maxMs`.
 * Throws (getUserMedia errors) when the microphone cannot be opened — use `micErrorMessage`.
 */
export async function recordAudio(maxMs = 6000, silenceMs = 700): Promise<Recording> {
  const { stream, ctx, analyser } = await openMic();
  if (ctx.state === 'suspended') await ctx.resume();
  // Speech needs little bandwidth: a small upload is a faster upload from the car.
  const rec = new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  // Energy-based end of speech. The noise floor follows the quietest level (falls at once, rises slowly), so a
  // constantly noisy cabin still has a floor and speech is anything clearly above it.
  const buf = new Float32Array(analyser.fftSize);
  let heard = false;
  let floor = Infinity;
  let quietSince = performance.now();
  const vad = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const level = Math.sqrt(sum / buf.length);
    floor = level < floor ? level : floor + (level - floor) * 0.02;
    const loud = level > Math.max(0.01, floor * 2.5);
    const now = performance.now();
    if (loud) {
      heard = true;
      quietSince = now;
    } else if (heard && now - quietSince > silenceMs) void stop();
  }, 100);

  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      window.clearInterval(vad);
      resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
    };
  });
  const timer = window.setTimeout(() => void stop(), maxMs);
  function stop() {
    window.clearTimeout(timer);
    if (rec.state !== 'inactive') rec.stop();
    return done;
  }
  rec.start();
  return { stop, done };
}
