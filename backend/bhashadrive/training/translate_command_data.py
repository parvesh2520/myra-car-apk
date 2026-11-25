"""English copies of the command-LLM dataset, for the car app's speech path.

In the car, Sarvam Saaras runs in `translate` mode, so the on-device command model reads English whatever the
driver spoke. This writes data/command_llm/{split}_en.jsonl: every row's text translated to English (same
intents), translated by Groq the way a speech translator would. Results are cached in
data/command_llm/en_cache.jsonl, so an interrupted run resumes where it stopped.

  python -m bhashadrive.training.translate_command_data          # needs GROQ_API_KEY
"""
from __future__ import annotations

import json
import os
import queue
import random
import re
import threading
import time
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parents[2] / "data" / "command_llm"
CACHE = DATA / "en_cache.jsonl"
# Rows translated per split: Groq's free tier allows ~8k tokens/min and a daily cap per model, too little for
# all ~13k rows in a day. A fixed random sample (rows already cached first) keeps every kind of command.
SAMPLE = {"train": 4000, "val": 600, "test": 800}
SPLITS = list(SAMPLE)
# Each Groq model has its own tokens-per-minute budget: one worker per model multiplies throughput.
# gpt-oss-20b is left out: in a spot check it flipped meanings ("thand kam karo" -> "make it cooler").
MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]
BATCH = 25
URL = "https://api.groq.com/openai/v1/chat/completions"

INSTRUCTIONS = """You are the speech translator of an Indian car's voice assistant. Each input is one driver \
utterance in English, Hindi, Hinglish, Tamil, Bengali or a mix, in any script, with the car commands it is known \
to mean. Translate each utterance into natural, plain English, as a speech-to-English translator would output it, \
so that the English still means exactly those commands. The commands are the ground truth: "thand kam karo" with \
climate.adjustTemp delta 2 means "make it less cold" (warmer), not "lower the temperature". Never mention the \
commands, their names or their JSON in the translation.
Keep the meaning exactly: every request, negations ("don't", "not"), amounts ("a little", "a lot", numbers), \
directions (up/down, warmer/cooler, next/previous), place names, contact names and genres. Do not add, drop or \
merge requests. Keep fillers short ("hey", "please") or drop them. If it is already English, return it as is.
Answer with JSON only: {"translations": ["...", ...]} with exactly one string per input, in order."""


def load_cache() -> dict[str, str]:
    if not CACHE.is_file():
        return {}
    out = {}
    for line in CACHE.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            out[r["text"]] = r["en"]
    return out


def translate(client: httpx.Client, model: str, items: list[dict]) -> list[str] | None:
    """English for each row's text (rows carry their intents), or None when the answer is unusable (the batch is then retried smaller)."""
    body = {"model": model, "temperature": 0, "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": INSTRUCTIONS},
                         {"role": "user", "content": json.dumps([{"utterance": i["text"], "commands": i["intents"]} for i in items], ensure_ascii=False)}]}
    if model.startswith("openai/"):
        body["reasoning_effort"] = "low"
    while True:
        try:
            r = client.post(URL, json=body)
        except httpx.HTTPError as e:  # network hiccup: retry instead of losing this worker
            print(f"[{model}] {type(e).__name__}, retrying", flush=True)
            time.sleep(5)
            continue
        if r.status_code == 429:  # per-model token budget: wait for it to refill
            wait = r.headers.get("retry-after")
            secs = float(wait) if wait and re.fullmatch(r"[\d.]+", wait) else 10
            if secs > 60:
                print(f"[{model}] rate limited for {secs:.0f}s", flush=True)
            time.sleep(secs)
            continue
        if r.status_code >= 500:
            time.sleep(5)
            continue
        if r.status_code != 200:
            print(f"[{model}] HTTP {r.status_code}: {r.text[:200]}", flush=True)
            return None
        try:
            out = json.loads(r.json()["choices"][0]["message"]["content"])["translations"]
        except (KeyError, ValueError, TypeError):
            return None
        ok = isinstance(out, list) and len(out) == len(items) and all(isinstance(t, str) and t.strip() for t in out)
        return [t.strip() for t in out] if ok else None


def main() -> None:
    key = os.environ.get("GROQ_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key or not key.startswith("gsk_"):
        raise SystemExit("Set GROQ_API_KEY (a gsk_ key).")
    cache = load_cache()
    rng = random.Random(7)
    rows = {}
    for s, n in SAMPLE.items():
        rs = [json.loads(l) for l in (DATA / f"{s}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
        rng.shuffle(rs)
        rs.sort(key=lambda r: r["text"] not in cache)  # stable: cached rows first, the rest in shuffled order
        rows[s] = rs[:n]
    by_text = {r["text"]: r for rs in rows.values() for r in rs}
    todo = [by_text[t] for t in sorted(set(by_text) - set(cache))]
    print(f"{len(cache)} cached, {len(todo)} to translate", flush=True)

    work: queue.Queue[list[dict]] = queue.Queue()
    for i in range(0, len(todo), BATCH):
        work.put(todo[i:i + BATCH])
    lock = threading.Lock()
    done = [len(cache)]
    total = len(cache) + len(todo)

    def worker(model: str) -> None:
        with httpx.Client(headers={"Authorization": f"Bearer {key}"}, timeout=120) as client:
            while True:
                try:
                    batch = work.get_nowait()
                except queue.Empty:
                    return
                out = translate(client, model, batch)
                if out is None:
                    if len(batch) > 1:  # split and retry: one odd sentence should not lose the rest
                        work.put(batch[: len(batch) // 2])
                        work.put(batch[len(batch) // 2:])
                    else:
                        print(f"[{model}] skipped: {batch[0]['text']!r}", flush=True)
                    continue
                with lock:
                    with CACHE.open("a", encoding="utf-8") as f:
                        for item, en in zip(batch, out):
                            cache[item["text"]] = en
                            f.write(json.dumps({"text": item["text"], "en": en}, ensure_ascii=False) + "\n")
                    done[0] += len(batch)
                    if done[0] // 500 != (done[0] - len(batch)) // 500:
                        print(f"{done[0]}/{total}", flush=True)

    threads = [threading.Thread(target=worker, args=(m,)) for m in MODELS]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    for s, rs in rows.items():
        out = [{**r, "text": cache[r["text"]], "source": f"en:{r.get('source', '')}"} for r in rs if r["text"] in cache]
        (DATA / f"{s}_en.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
        print(f"{s}_en.jsonl: {len(out)}/{len(rs)} rows", flush=True)


if __name__ == "__main__":
    main()
