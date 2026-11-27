"""Fine-tune SmolLM2-135M-Instruct into the car app's on-device command LLM and export it as GGUF for llama.cpp.

In the car, Sarvam translates speech to English, so the model reads English: the command-LLM rows whose English
translation exists (data/command_llm/en_cache.jsonl, nlu_v2/*_en.jsonl) plus synthetic shortcut sentences
("whenever I say chill mode, set the AC to 20 and play music"). Answer: the compact JSON action list.

  <gpu python> bhashadrive/training/train_car_llm.py --convert-script <llama.cpp>/convert_hf_to_gguf.py
Standalone (no bhashadrive imports), so it runs in a plain torch + transformers + gguf env.
Output: models/llm/myra-smollm2-135m/ (Hugging Face) and models/llm/myra-smollm2-135m.q8_0.gguf.
The car app builds the same prompt as PROMPT below (LlmCommands.kt); keep them in sync.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = ROOT / "models" / "llm"
BASE = "HuggingFaceTB/SmolLM2-135M-Instruct"
NAME = "myra-smollm2-135m"
PROMPT = "<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
END = "<|im_end|>"

TRIGGERS = [
    "chill mode", "party mode", "party time", "movie night", "road trip", "i'm sleepy", "i am cold", "i'm feeling hot",
    "relax mode", "focus mode", "date night", "office mode", "going home", "rainy day", "summer mode", "winter mode",
    "night drive", "morning mode", "highway mode", "city mode", "boost", "silence please", "quiet time", "lets go",
    "beast mode", "cool down", "warm up", "music time", "family mode", "kids mode", "cozy mode", "fresh air",
    "gym mode", "monsoon", "long drive", "traffic mode", "sunday mode", "lazy mode", "study time", "weekend vibes",
    "hot hot hot", "freeze", "zen", "turbo", "goodnight", "good morning", "dance mode", "temple mode", "airport run",
    "mumbai mode", "evening drive", "my mode", "comfort mode", "sleep mode", "mood one", "scene two", "jam session",
    "hello myra", "back home", "coffee break",
]
DEFINE = [
    "whenever i say {t}, {a}", "when i say {t}, {a}", "every time i say {t}, {a}", "if i say {t} then {a}",
    "from now on when i say {t}, {a}", "whenever i say {t} then {a}", "when i say {t} i want you to {a}",
    "create a shortcut called {t} that will {a}", "save a shortcut {t}: {a}", "make a shortcut named {t} to {a}",
    "remember that {t} means {a}", "add a shortcut {t} which does {a}",
    "whenever i tell you {t}, {a}", "when i say the words {t}, {a}", "{t} should {a}", "if i ever say {t}, {a}",
    "teach yourself that {t} means {a}", "create shortcut {t} to {a}", "new shortcut {t}: {a}",
]
DELETE = ["delete the shortcut {t}", "remove the {t} shortcut", "forget {t}", "delete shortcut {t}",
          "remove shortcut {t}", "forget the shortcut called {t}", "i don't want the {t} shortcut anymore"]
JOIN = [" and ", ", ", " and then ", ", then ", " and also "]


def load(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def english_rows(split: str) -> list[dict]:
    """Command-LLM rows of a split with their English translation as the text."""
    en = {r["text"]: r["en"] for r in load(DATA / "command_llm" / "en_cache.jsonl")}
    for s in ("train", "val", "test"):
        for r in load(DATA / "nlu_v2" / f"{s}_en.jsonl"):
            if r.get("source_text"):
                en.setdefault(r["source_text"], r["text"])
    return [{"text": en[r["text"]], "intents": r["intents"]} for r in load(DATA / "command_llm" / f"{split}.jsonl")
            if r["text"] in en]


def clause(text: str) -> str:
    """'Hey, set the AC to 22 please.' -> 'set the ac to 22' (an action as it sounds inside a shortcut)."""
    t = text.lower().strip().rstrip(".!?")
    t = re.sub(r"^(hey|okay|ok|listen|please|buddy|myra)[, ]+", "", t)
    return re.sub(r"[, ]+(please|now|buddy|quickly)$", "", t).strip(" ,")


def shortcut_rows(singles: list[dict], triggers: list[str], n: int, rng: random.Random) -> list[dict]:
    # Shortcuts only store car actions, never questions.
    acts = [r for r in singles if len(r["intents"]) == 1 and r["intents"][0]["type"] not in ("query", "greet", "thanks", "help")
            and "?" not in r["text"] and len(r["text"]) < 70]
    out = []
    for _ in range(n):
        t = rng.choice(triggers)
        if rng.random() < 0.08:
            out.append({"text": rng.choice(DELETE).format(t=t), "intents": [{"type": "shortcut.delete", "name": t}]})
            continue
        picked = rng.sample(acts, rng.choice([1, 2, 2, 3]))
        joined = clause(picked[0]["text"])
        for p in picked[1:]:
            joined += rng.choice(JOIN) + clause(p["text"])
        text = rng.choice(DEFINE).format(t=t, a=joined)
        if rng.random() < 0.5:
            text = text[0].upper() + text[1:]
        if rng.random() < 0.3:
            text = text.replace(t, f'"{t}"', 1)
        if rng.random() < 0.6:
            text += "."
        out.append({"text": text, "intents": [{"type": "shortcut.save", "name": t, "do": [p["intents"][0] for p in picked]}]})
    return out


def dataset(seed: int) -> tuple[list[dict], list[dict]]:
    rng = random.Random(seed)
    train, val = english_rows("train"), english_rows("val")
    trig = TRIGGERS[:]
    rng.shuffle(trig)
    held, seen = trig[:8], trig[8:]  # validation shortcuts use names never seen in training
    return train + shortcut_rows(train, seen, 1800, rng), val + shortcut_rows(val, held, 200, rng)


def answer(intents: list[dict]) -> str:
    return json.dumps(intents, ensure_ascii=False, separators=(",", ":")) + END


def encode(tok, rows: list[dict]) -> list[tuple[list[int], int]]:
    out = []
    for r in rows:
        p = tok(PROMPT.format(" ".join(r["text"].split())[:300]), add_special_tokens=False).input_ids
        a = tok(answer(r["intents"]), add_special_tokens=False).input_ids
        out.append((p + a, len(p)))
    return out


def batches(items, size: int, shuffle: bool, rng: random.Random):
    order = sorted(range(len(items)), key=lambda i: len(items[i][0]) + (rng.random() if shuffle else 0))
    groups = [order[i:i + size] for i in range(0, len(order), size)]
    if shuffle:
        rng.shuffle(groups)
    return groups


def run_batch(model, torch, items, idx, pad_id, device):
    """Loss and per-row exact match on the answer tokens only. Teacher-forced exact match = greedy exact match."""
    seqs = [items[i] for i in idx]
    T = max(len(s) for s, _ in seqs)
    ids = torch.full((len(seqs), T), pad_id, dtype=torch.long)
    mask = torch.zeros((len(seqs), T), dtype=torch.long)
    target = torch.full((len(seqs), T), -100, dtype=torch.long)
    for b, (s, start) in enumerate(seqs):
        ids[b, :len(s)] = torch.tensor(s)
        mask[b, :len(s)] = 1
        target[b, start - 1:len(s) - 1] = torch.tensor(s[start:])
    ids, mask, target = ids.to(device), mask.to(device), target.to(device)
    with torch.autocast("cuda", dtype=torch.bfloat16, enabled=device == "cuda"):
        hidden = model.model(input_ids=ids, attention_mask=mask).last_hidden_state
        sel = target != -100
        logits = model.lm_head(hidden[sel]).float()
    gold = target[sel]
    loss = torch.nn.functional.cross_entropy(logits, gold)
    right = (logits.argmax(-1) == gold).long()
    wrong = torch.zeros(len(seqs), dtype=torch.long, device=device).index_add_(0, sel.nonzero()[:, 0], 1 - right)
    return loss, (wrong == 0).sum().item()


def train(epochs: int, lr: float, batch: int, seed: int) -> dict:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    torch.manual_seed(seed)
    rng = random.Random(seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.float32).to(device)
    tr_rows, va_rows = dataset(seed)
    tr, va = encode(tok, tr_rows), encode(tok, va_rows)
    print(f"train {len(tr)} rows, val {len(va)} rows", flush=True)
    pad = tok.pad_token_id if tok.pad_token_id is not None else 0
    steps = epochs * math.ceil(len(tr) / batch)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.0)
    warm = max(1, steps // 30)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / steps))))
    best, dst, log = -1.0, OUT / NAME, []
    t0 = time.time()
    for ep in range(1, epochs + 1):
        model.train()
        for k, idx in enumerate(batches(tr, batch, True, rng)):
            loss, _ = run_batch(model, torch, tr, idx, pad, device)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
            if k % 100 == 0:
                print(f"epoch {ep} step {k} loss {loss.item():.4f}", flush=True)
        model.eval()
        exact = 0
        with torch.no_grad():
            for idx in batches(va, batch, False, rng):
                exact += run_batch(model, torch, va, idx, pad, device)[1]
        em = exact / len(va)
        log.append({"epoch": ep, "val_exact_match": round(em, 4), "elapsed_s": round(time.time() - t0, 1)})
        print(log[-1], flush=True)
        if em > best:
            best = em
            dst.mkdir(parents=True, exist_ok=True)
            model.save_pretrained(dst)
            tok.save_pretrained(dst)
    info = {"base": BASE, "epochs": log, "best_val_exact_match": round(best, 4), "train_rows": len(tr),
            "val_rows": len(va), "lr": lr, "batch": batch, "prompt": PROMPT}
    (dst / "training.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    return info


def smoke(sentences: list[str]) -> None:
    """Greedy decoding on a few sentences with the saved checkpoint (what the car will do)."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(OUT / NAME)
    model = AutoModelForCausalLM.from_pretrained(OUT / NAME).eval()
    for s in sentences:
        ids = tok(PROMPT.format(s), return_tensors="pt", add_special_tokens=False).input_ids
        with torch.no_grad():
            out = model.generate(ids, max_new_tokens=96, do_sample=False, eos_token_id=tok.convert_tokens_to_ids(END))
        print(s, "->", tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True), flush=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--convert-script", type=Path, required=True, help="llama.cpp convert_hf_to_gguf.py")
    ap.add_argument("--skip-train", action="store_true")
    ap.add_argument("--upload", metavar="USER/REPO", help="after export, upload the GGUF to this Hugging Face repo")
    args = ap.parse_args(argv)
    if not args.skip_train:
        print(json.dumps(train(args.epochs, args.lr, args.batch, args.seed), indent=2), flush=True)
    smoke(["Set the AC to 22 degrees and play some music.", "Whenever I say chill mode, set the temperature to 20 and play music.",
           "When I say movie night, turn off the cabin lights and lower the volume.", "Delete the shortcut chill mode.",
           "It's too hot in here.", "Take me to the airport."])
    out = OUT / f"{NAME}.q8_0.gguf"
    subprocess.run([sys.executable, str(args.convert_script), str(OUT / NAME), "--outtype", "q8_0", "--outfile", str(out)],
                   check=True)
    print("wrote", out, out.stat().st_size // 1024 // 1024, "MB")
    if args.upload:
        upload(out, args.upload)
    return 0


def upload(gguf: Path, repo: str) -> None:
    """Puts the GGUF on a public Hugging Face model repo (the car downloads it without a token) and prints the
    SIZE / SHA256 / URL constants for Llm.kt."""
    import hashlib
    from huggingface_hub import HfApi

    api = HfApi()
    api.create_repo(repo, repo_type="model", private=False, exist_ok=True)
    api.upload_file(path_or_fileobj=str(gguf), path_in_repo=gguf.name, repo_id=repo,
                    commit_message="MYRA car command model")
    info = OUT / NAME / "training.json"
    if info.exists():
        api.upload_file(path_or_fileobj=str(info), path_in_repo="training.json", repo_id=repo)
    h = hashlib.sha256()
    with gguf.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    print(f'URL = "https://huggingface.co/{repo}/resolve/main/{gguf.name}"')
    print(f"SIZE = {gguf.stat().st_size}L")
    print(f'SHA256 = "{h.hexdigest()}"')


if __name__ == "__main__":
    raise SystemExit(main())
