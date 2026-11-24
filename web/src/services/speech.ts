/**
 * Thin wrappers around the browser Web Speech API. Recognition and synthesis are
 * optional browser features, so every call degrades gracefully when unsupported.
 */

export interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

export function getRecognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const recognitionSupported = () => typeof window !== 'undefined' && getRecognitionCtor() !== null;
export const synthesisSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function recognitionErrorMessage(code: string): string | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'no-speech':
      return 'I didn’t hear anything. Tap the mic and try again.';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. You can type your request instead.';
    case 'network':
      return 'Speech recognition needs a network connection in this browser. Type your request instead.';
    case 'audio-capture':
      return 'No microphone was found. You can type your request instead.';
    default:
      return 'Speech recognition stopped unexpectedly. Please try again.';
  }
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split('-')[0];
  return (
    voices.find((v) => v.lang === lang && /female|neerja|swara|heera|kalpana|google/i.test(v.name)) ??
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => v.lang.startsWith(base))
  );
}

export function speak(text: string, lang: string, rate = 1, onEnd?: () => void): boolean {
  if (!synthesisSupported() || !text) return false;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;
    u.pitch = 1.05;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  if (synthesisSupported()) window.speechSynthesis.cancel();
}

/** True when the browser has a voice for the language (Hindi voices vary by OS). */
export function hasVoiceFor(lang: string): boolean {
  if (!synthesisSupported()) return false;
  const base = lang.split('-')[0];
  return window.speechSynthesis.getVoices().some((v) => v.lang.startsWith(base));
}
