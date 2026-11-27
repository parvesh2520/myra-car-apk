"""English copies of the V2 NLU dataset (data/nlu_v2), for the car app's on-device classifier.

In the car, Sarvam Saaras runs in `translate` mode, so the classifier reads English whatever the driver spoke.
Rows already in English are kept; every other row is translated by Groq with its label (intent, negation,
parameters) as ground truth, so the English keeps the meaning (translate_command_data.translate). Writes
data/nlu_v2/{split}_en.jsonl; results are cached in data/nlu_v2/en_cache.jsonl, so a stopped run resumes.

  python -m bhashadrive.training.translate_nlu_data          # needs GROQ_API_KEY
"""
from __future__ import annotations

import json
import os
import queue
import threading
from pathlib import Path

import httpx

from .translate_command_data import BATCH, MODELS, translate

DATA = Path(__file__).resolve().parents[2] / "data" / "nlu_v2"
CACHE = DATA / "en_cache.jsonl"
SPLITS = ["train", "val", "test", "heldout_unseen"]


def label(r: dict) -> list[dict]:
    """The row's meaning in the shape translate() shows the translator as ground truth."""
    return [{"intent": r["intent"], "negated": r.get("negated", False), **(r.get("parameters") or {})}]


def main() -> None:
    key = os.environ.get("GROQ_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key or not key.strip().startswith("gsk_"):
        raise SystemExit("Set GROQ_API_KEY (a gsk_ key).")
    key = key.strip()
    rows = {s: [json.loads(l) for l in (DATA / f"{s}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
            for s in SPLITS}
    cache = {}
    if CACHE.is_file():
        for line in CACHE.read_text(encoding="utf-8").splitlines():
            if line.strip():
                c = json.loads(line)
                cache[c["text"]] = c["en"]
    todo = {r["text"]: {"text": r["text"], "intents": label(r)} for rs in rows.values() for r in rs
            if r.get("language_pattern") != "english" and r["text"] not in cache}
    print(f"{len(cache)} cached, {len(todo)} to translate", flush=True)

    work: queue.Queue[list[dict]] = queue.Queue()
    items = list(todo.values())
    for i in range(0, len(items), BATCH):
        work.put(items[i:i + BATCH])
    lock = threading.Lock()

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
                with lock, CACHE.open("a", encoding="utf-8") as f:
                    for item, en in zip(batch, out):
                        cache[item["text"]] = en
                        f.write(json.dumps({"text": item["text"], "en": en}, ensure_ascii=False) + "\n")
                    if len(cache) // 250 != (len(cache) - len(batch)) // 250:
                        print(f"{len(cache)} translated", flush=True)

    threads = [threading.Thread(target=worker, args=(m,)) for m in MODELS]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    for s, rs in rows.items():
        out = []
        for r in rs:
            text = r["text"] if r.get("language_pattern") == "english" else cache.get(r["text"])
            if text:
                out.append({**r, "text": text, "source_text": r["text"]})
        (DATA / f"{s}_en.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
        print(f"{s}_en.jsonl: {len(out)}/{len(rs)} rows", flush=True)


if __name__ == "__main__":
    main()
