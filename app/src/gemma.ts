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
- Output only the JSON array, at most 4 commands. Leave out optional fields you don't need.
- "delta" is a relative change; negative lowers. thoda/a little = 1 step, bahut/zyada/a lot = 3 steps.
- "garmi"/"too hot" = climate.adjustTemp delta -2 feeling "hot"; "thand"/"too cold" = delta 2 feeling "cold".
- Navigation destinations are plain place names.
- Small talk, yes/no answers, or anything not in the list: output [].
Examples:
"AC 22 pe kar do" -> [{"type":"climate.setTemp","value":22}]
"gaana band karo aur volume thoda kam" -> [{"type":"media.pause"},{"type":"media.volume","delta":-2}]
"airport le chalo" -> [{"type":"nav.start","destination":"airport"}]
"haan" -> []`;

const messages = (text: string) => [
  { role: 'system', content: INSTRUCTIONS },
  { role: 'user', content: text.split(/\s+/).join(' ').slice(0, 300) },
];

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
    await ctx.completion({ messages: messages('hello'), n_predict: 1, temperature: 0 }); // caches the instructions
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
      messages: messages(text),
      response_format: { type: 'json_schema', json_schema: { strict: true, schema: spec.schema } },
      n_predict: 160,
      temperature: 0,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.text);
    } catch {
      parsed = [];
    }
    const commands = (Array.isArray(parsed) ? parsed : []).filter(
      (c): c is Command => !!c && typeof c === 'object' && typeof (c as Command).type === 'string',
    );
    return { commands, model: `${MODEL_NAME} (on-device)`, latency_ms: Date.now() - t0 };
  });
  queue = run.catch(() => undefined);
  return run;
}
