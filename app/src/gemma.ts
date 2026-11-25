/**
 * On-device understanding: the cockpit command model, Gemma 3 270M fine-tuned on the cockpit's commands
 * (backend/bhashadrive/training/train_command_llm.py), 8-bit GGUF, run by llama.cpp via llama.rn.
 * It reads the transcript (English from Sarvam's translate mode) and answers with a JSON array of commands in the
 * backend's schema (backend/bhashadrive/nlu/cockpit_commands.py).
 *
 * The model is downloaded from Hugging Face on first launch (291 MB, once). The download can be switched off
 * and on from the app; the choice is remembered. Same decoding as the backend's CommandLLM: no grammar (8x
 * slower on Gemma's 262k-token vocabulary, same answers), every command validated against the schema afterwards.
 * Settings are sized for low-end head units: small context and batch, all 4 cores while a command is understood.
 */
import { initLlama, type LlamaContext } from 'llama.rn';
import { File, Paths } from 'expo-file-system';
import type { DownloadTask } from 'expo-file-system';
import spec from './commands.json';

export const MODEL_NAME = 'Cockpit Gemma 270M';
const MODEL_FILE = 'cockpit-gemma-270m.q8_0.gguf';
const MODEL_URL = `https://huggingface.co/Parvesh2520/myra-cockpit-gemma-270m/resolve/main/${MODEL_FILE}`;
const MODEL_BYTES = 291543776;
const MAX_COMMANDS = 4;

export interface Command {
  type: string;
  [field: string]: unknown;
}

/** The training prompt (cockpit_commands.prompt): the sentence alone; llama.cpp adds <bos>. */
const prompt = (text: string) =>
  `<start_of_turn>user\n${text.split(/\s+/).join(' ').slice(0, 300)}<end_of_turn>\n<start_of_turn>model\n`;

/* ---------- download switch (remembered in app storage) ---------- */

const settingsFile = new File(Paths.document, 'myra-settings.json');
const modelFile = () => new File(Paths.document, MODEL_FILE);
export const modelInstalled = () => modelFile().exists && modelFile().size === MODEL_BYTES;

export function downloadEnabled(): boolean {
  try {
    return settingsFile.exists ? JSON.parse(settingsFile.textSync()).download !== false : true;
  } catch {
    return true;
  }
}

function saveDownloadEnabled(on: boolean) {
  if (!settingsFile.exists) settingsFile.create();
  settingsFile.write(JSON.stringify({ download: on }));
}

let task: DownloadTask | null = null;
let downloading: Promise<void> | null = null;

/** Downloads the model unless it is installed or the switch is off; resumes a paused download. */
function download(onStatus: (s: string) => void): Promise<void> {
  if (modelInstalled()) return Promise.resolve();
  downloading ??= (async () => {
    try {
      let done: File | null;
      if (task?.state === 'paused') {
        done = await task.resumeAsync();
      } else {
        const file = modelFile();
        if (file.exists) file.delete(); // partial download from an earlier run
        task = File.createDownloadTask(MODEL_URL, file, {
          onProgress: ({ bytesWritten }) => onStatus(`${MODEL_NAME}: downloading ${Math.floor((bytesWritten / MODEL_BYTES) * 100)}% · tap to pause`),
        });
        done = await task.downloadAsync();
      }
      if (done === null) return onStatus(`${MODEL_NAME}: download paused · tap to resume`);
      task = null;
      if (!modelInstalled()) throw new Error(`download incomplete (${modelFile().size} bytes)`);
    } finally {
      downloading = null;
    }
  })();
  return downloading;
}

/** Turns the cloud download on (starts or resumes it) or off (pauses it). Returns the new state. */
export async function setDownloadEnabled(on: boolean, onStatus: (s: string) => void): Promise<boolean> {
  saveDownloadEnabled(on);
  if (on) {
    loadGemma(onStatus).catch(() => undefined);
  } else if (task?.state === 'active') {
    await task.pauseAsync();
  } else if (!modelInstalled()) {
    onStatus(`${MODEL_NAME}: download off · tap to download`);
  }
  return on;
}

/* ---------- model ---------- */

let ready: Promise<LlamaContext> | null = null;
let queue: Promise<unknown> = Promise.resolve(); // one completion at a time per context

/** Downloads (if needed and allowed) and loads the model; status lines go to `onStatus`. Retries after a failure. */
export function loadGemma(onStatus: (s: string) => void): Promise<LlamaContext> {
  ready ??= (async () => {
    if (!modelInstalled()) {
      if (!downloadEnabled()) throw new Error('download off · tap to download');
      await download(onStatus);
      if (!modelInstalled()) throw new Error('download paused · tap to resume');
    }
    onStatus(`${MODEL_NAME}: loading…`);
    const ctx = await initLlama({ model: modelFile().uri, n_ctx: 256, n_batch: 64, n_threads: 4, n_gpu_layers: 0, use_mlock: false });
    // Warm-up: pages the weights into RAM now, so the first spoken command does not pay for it.
    onStatus(`${MODEL_NAME}: warming up…`);
    await ctx.completion({ prompt: prompt('AC 22'), n_predict: 12, temperature: 0, stop: ['<end_of_turn>'] });
    onStatus(`${MODEL_NAME} · on-device · ready`);
    return ctx;
  })().catch((e: unknown) => {
    ready = null;
    onStatus(`${MODEL_NAME}: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  });
  return ready;
}

/** One transcript -> commands, understood on this device. */
export function understand(text: string, onStatus: (s: string) => void): Promise<{ commands: Command[]; model: string; latency_ms: number }> {
  const run = queue.then(async () => {
    const ctx = await loadGemma(onStatus);
    const t0 = Date.now();
    // 96 tokens fit MAX_COMMANDS short commands; a longer answer would be cut off and discarded anyway.
    const r = await ctx.completion({ prompt: prompt(text), n_predict: 96, temperature: 0, stop: ['<end_of_turn>'] });
    const commands = parseCommands(r.text).filter(valid).slice(0, MAX_COMMANDS);
    return { commands, model: `${MODEL_NAME} (on-device)`, latency_ms: Date.now() - t0 };
  });
  queue = run.catch(() => undefined);
  return run;
}

type FieldSchema = { type?: string; const?: unknown; enum?: unknown[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number };
const VARIANTS = new Map(
  (spec.schema.items.oneOf as unknown as { properties: Record<string, FieldSchema>; required: string[] }[]).map((v) => [v.properties.type.const as string, v]),
);

/** A known command with its required fields, no unknown field, and values inside the schema's limits. */
export function valid(c: unknown): c is Command {
  if (!c || typeof c !== 'object') return false;
  const v = VARIANTS.get((c as Command).type);
  if (!v || v.required.some((f) => !(f in c))) return false;
  return Object.entries(c).every(([f, val]) => {
    const s = v.properties[f];
    if (!s) return false;
    if (f === 'type') return true;
    if (s.enum) return s.enum.includes(val);
    if (s.type === 'boolean') return typeof val === 'boolean';
    if (s.type === 'integer' || s.type === 'number')
      return typeof val === 'number' && val >= s.minimum! && val <= s.maximum! && (s.type === 'number' || Number.isInteger(val));
    if (s.type === 'string') return typeof val === 'string' && val.length >= (s.minLength ?? 0) && val.length <= (s.maxLength ?? 60);
    return false;
  });
}

/** The model's JSON array; [] when the answer is not one (malformed or cut off), as in the backend. */
export function parseCommands(text: string): unknown[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
