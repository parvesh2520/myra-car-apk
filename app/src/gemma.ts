/**
 * On-device understanding: Gemma 3 1B (Q4_K_M GGUF, llama.cpp via llama.rn) turns one transcript into cockpit
 * commands. Output is constrained by the backend's own command schema (commands.json, written by
 * backend/scripts/export_car_model_spec.py), so the model can only answer with valid commands.
 *
 * The model file (~806 MB) is downloaded once into the app's documents folder on first launch.
 */
import { initLlama, type LlamaContext } from 'llama.rn';
import { File, Paths } from 'expo-file-system';
import spec from './commands.json';

export const MODEL_NAME = 'Gemma 3 1B';
const MODEL_URL = 'https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf';
const MODEL_FILE = 'gemma-3-1b-it-Q4_K_M.gguf';
const MODEL_BYTES = 806058240;

export interface Command {
  type: string;
  [field: string]: unknown;
}

const INSTRUCTIONS = `You convert a driver's in-car voice command into a JSON array of car commands.
The driver speaks English, Hindi or Hinglish; the text may contain speech-recognition errors.
Commands (? = optional field; numbers are inclusive ranges):
${spec.capabilities}
Rules:
- Output only the JSON array, no markdown, at most 4 commands. Leave out optional fields you don't need.
- "delta" is a relative change; negative lowers. thoda/a little = 1 step, bahut/zyada/a lot = 3 steps.
- "garmi"/"too hot" = climate.adjustTemp delta -2 feeling "hot"; "thand"/"too cold" = delta 2 feeling "cold".
- Navigation destinations are plain place names; "ghar" = "home", "office" = "work".
- Yes/no answers or anything not in the list: output [{"type":"none"}].
Examples:
"AC 22 pe kar do" -> [{"type":"climate.setTemp","value":22}]
"AC band karo" -> [{"type":"climate.power","on":false}]
"fan speed badha do" -> [{"type":"climate.fan","delta":1}]
"fan kam karo" -> [{"type":"climate.fan","delta":-1}]
"volume thoda kam karo" -> [{"type":"media.volume","delta":-2}]
"koi gaana chala do" -> [{"type":"media.play"}]
"next song" -> [{"type":"media.skip","dir":1}]
"airport le chalo" -> [{"type":"nav.start","destination":"airport"}]
"mummy ko call karo" -> [{"type":"phone.call","contact":"mummy"}]
"music band karo aur AC 24" -> [{"type":"media.pause"},{"type":"climate.setTemp","value":24}]
"hello" -> [{"type":"greet"}]
"haan" -> [{"type":"none"}]`;

/** Gemma's chat format, built here: llama.rn's jinja chat path does not reliably apply the JSON grammar. */
const prompt = (text: string) =>
  `<start_of_turn>user
${INSTRUCTIONS}

Driver: ${text.split(/\s+/).join(' ').slice(0, 300)}<end_of_turn>
<start_of_turn>model
`;

// The backend's command schema, plus {"type":"none"} for "nothing to do": with at least one item required, the
// 1B model has to choose a command instead of defaulting to an empty list. `valid` drops "none".
const SCHEMA = JSON.stringify({
  ...spec.schema,
  minItems: 1,
  items: { oneOf: [...spec.schema.items.oneOf, { type: 'object', properties: { type: { const: 'none' } }, required: ['type'], additionalProperties: false }] },
});

let ready: Promise<LlamaContext> | null = null;
let queue: Promise<unknown> = Promise.resolve(); // one completion at a time per context

/** Downloads (first launch) and loads the model; status lines go to `onStatus`. Retries after a failure. */
export function loadGemma(onStatus: (s: string) => void): Promise<LlamaContext> {
  ready ??= (async () => {
    const file = new File(Paths.document, MODEL_FILE);
    if (!file.exists || file.size !== MODEL_BYTES) {
      if (file.exists) file.delete(); // partial download
      onStatus(`${MODEL_NAME}: downloading…`);
      const task = File.createDownloadTask(MODEL_URL, file, {
        onProgress: ({ bytesWritten }) => onStatus(`${MODEL_NAME}: downloading ${Math.floor((bytesWritten / MODEL_BYTES) * 100)}%`),
      });
      await task.downloadAsync();
      if (file.size !== MODEL_BYTES) throw new Error(`model download incomplete (${file.size} bytes)`);
    }
    onStatus(`${MODEL_NAME}: loading…`);
    const ctx = await initLlama({ model: file.uri, n_ctx: 2048, n_threads: 4, n_gpu_layers: 0, use_mlock: false });
    onStatus(`${MODEL_NAME}: warming up…`);
    await ctx.completion({ prompt: prompt('hello'), n_predict: 1, temperature: 0 }); // caches the instructions
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
    const r = await ctx.completion({
      prompt: prompt(text),
      json_schema: SCHEMA,
      stop: ['<end_of_turn>'],
      n_predict: 160,
      temperature: 0,
    });
    const commands = parseCommands(r.text).filter(valid);
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

/** The model's JSON array, also when it wraps it in markdown fences or adds text around it; [] if there is none. */
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
