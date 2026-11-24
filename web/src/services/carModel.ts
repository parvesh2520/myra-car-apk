/**
 * Bridge to the MYRA car app (Expo shell, ../../app). The on-device model (Gemma 3 1B, llama.cpp) runs in the
 * native layer; this WebView asks it to understand one transcript and gets back backend-schema cockpit commands
 * (backend/bhashadrive/nlu/cockpit_commands.py), which `fromCloudCommands` maps to MYRA intents.
 */
import type { BackendCommand } from './api';

interface CarWindow extends Window {
  ReactNativeWebView?: { postMessage: (msg: string) => void };
  __myraNative?: (id: number, payload: unknown) => void;
}

export interface CarUnderstanding {
  commands: BackendCommand[];
  model: string;
  latency_ms: number;
}

const w = window as CarWindow;
const waiting = new Map<number, (payload: unknown) => void>();
let seq = 0;

/** True inside the car app's WebView (the native layer injects `ReactNativeWebView`). */
export const inCarApp = () => !!w.ReactNativeWebView;

// The native layer answers each request by calling window.__myraNative(id, payload).
w.__myraNative = (id, payload) => {
  waiting.get(id)?.(payload);
  waiting.delete(id);
};

/** Transcript -> commands, understood on the device. Rejects on model errors or after `timeoutMs`. */
export function understandOnDevice(text: string, timeoutMs = 60000): Promise<CarUnderstanding> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = window.setTimeout(() => {
      waiting.delete(id);
      reject(new Error('The on-device model took too long.'));
    }, timeoutMs);
    waiting.set(id, (payload) => {
      window.clearTimeout(timer);
      const r = payload as CarUnderstanding & { error?: string };
      if (r.error) reject(new Error(r.error));
      else resolve(r);
    });
    w.ReactNativeWebView!.postMessage(JSON.stringify({ id, type: 'understand', text }));
  });
}

/** One line for the chat: what the car understood, e.g. `climate.setTemp value=22 · media.play`. */
export const describeCommands = (cmds: BackendCommand[]) =>
  cmds.length
    ? cmds.map(({ type, ...args }) => [type, ...Object.entries(args).map(([k, v]) => `${k}=${String(v)}`)].join(' ')).join(' · ')
    : 'no command';
