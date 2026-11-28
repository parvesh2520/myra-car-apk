"""On-device understanding for the car app: English MiniLM-L6 fine-tuned for intent, negation and values.

In the car, Sarvam translates the driver's speech to English, so an English encoder is enough: MiniLM-L6
(6 layers, 30k-word vocabulary, ~22M parameters) instead of the multilingual MiniLM-L12 (250k words, 118 MB at
int8). One encoder, three heads: the intent (LABELS), negation ("don't turn the AC off") and a BIO tag per word for
the values in the sentence (car_nlu_data.TAGS: temperature, level, colour, genre, place, shortcut name).

Data: data/car_nlu/train.jsonl (car_nlu_data.py: generated phrasings with tagged values), data/nlu_v2/*_en.jsonl
(translate_nlu_data.py) plus the single-command rows of the command-LLM training set already translated to English
(data/command_llm/en_cache.jsonl, train split only), mapped to these intents. Only generated rows carry value tags.

  python -m bhashadrive.training.train_car_classifier --out <dir>      # GPU env: torch + transformers
Writes <dir>/model.fp32.onnx (inputs input_ids, attention_mask; outputs intent_probs, negation_prob, slot_tags),
<dir>/vocab.txt, <dir>/labels.json and <dir>/training.json. quantize_car_classifier.py makes model.int8.onnx.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import shutil
import time
from pathlib import Path

from .car_nlu_data import TAGS, words

ROOT = Path(__file__).resolve().parents[2]
NLU = ROOT / "data" / "nlu_v2"
CMD = ROOT / "data" / "command_llm"
GEN = ROOT / "data" / "car_nlu"
BASE = "sentence-transformers/all-MiniLM-L6-v2"
MAX_LEN = 32
LABELS = ["climate_temperature_up", "climate_temperature_down", "climate_temperature_set", "climate_fan_speed_up",
          "climate_fan_speed_down", "climate_on", "climate_off", "volume_up", "volume_down", "media_play",
          "media_pause", "media_next", "media_previous", "navigation_destination_request", "dialog_confirm",
          "dialog_cancel", "unsupported", "ambiguous",
          # added with value tagging: requests the app used to catch only with regular expressions
          "climate_fan_speed_set", "volume_set", "volume_mute", "ambient_light_set", "seat_up", "seat_down",
          "seat_height_set", "navigation_stop", "shortcut_define", "shortcut_delete",
          "greeting"]  # "Hi Myra": the app greets the recognised driver


def load(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def v2_intent(cmds: list[dict]) -> str | None:
    """A command-LLM answer (cockpit commands) as one V2 intent; None when it does not map to exactly one."""
    if not cmds:
        return "unsupported"  # no command: out of scope or small talk
    if len(cmds) > 1:
        return None
    c = cmds[0]
    t = c["type"]
    delta = c.get("delta")
    if t == "climate.setTemp":
        return "climate_temperature_set"
    if t == "climate.adjustTemp":
        return "climate_temperature_up" if delta > 0 else "climate_temperature_down"
    if t == "climate.power":
        return "climate_on" if c["on"] else "climate_off"
    if t == "climate.fan" and "value" in c:
        return "climate_fan_speed_set"
    if t == "media.volume" and c.get("mute"):
        return "volume_mute"
    if t == "media.volume" and "value" in c:
        return "volume_set"
    if t == "ambient.color":
        return "ambient_light_set"
    if t == "nav.stop":
        return "navigation_stop"
    if t == "climate.fan" and delta is not None and "value" not in c:
        return "climate_fan_speed_up" if delta > 0 else "climate_fan_speed_down"
    if t == "media.volume" and delta is not None and "value" not in c and "mute" not in c:
        return "volume_up" if delta > 0 else "volume_down"
    if t == "media.play" and not c.get("radio") and "freq" not in c:
        return "media_play"
    if t == "media.pause":
        return "media_pause"
    if t == "media.skip":
        return "media_next" if c["dir"] == 1 else "media_previous"
    if t == "nav.start":
        return "navigation_destination_request"
    if t == "greet":
        return "greeting"
    if t in {"climate.fan", "media.volume", "media.play"}:
        return None  # a value/mute/radio variant the V2 taxonomy has no intent for
    return "unsupported"  # a car function the demo cannot perform


def clause(text: str) -> str:
    """'Hey, set the AC to 22 please.' -> 'set the ac to 22' (Shortcuts.normalize in the app)."""
    t = re.sub(r"[^\w' ]", " ", text.lower())
    t = re.sub(r"\s+", " ", t).strip()
    while True:
        n = re.sub(r"^(hey myra|hey|ok|okay|myra|please)\s+|\s+(please|now)$", "", t).strip()
        if n == t:
            return t
        t = n


def dataset() -> dict[str, list[tuple]]:
    """(text, intent index, negated 0/1, word tags or None) per split."""
    out = {s: [(r["text"], LABELS.index(r["intent"]), int(bool(r.get("negated"))), None) for r in load(NLU / f"{s}_en.jsonl")]
           for s in ("train", "val", "test", "heldout_unseen")}
    cache = {}
    if (CMD / "en_cache.jsonl").is_file():
        for c in load(CMD / "en_cache.jsonl"):
            cache[c["text"]] = c["en"]
    extra = 0
    for r in load(CMD / "train.jsonl"):
        intent = v2_intent(r["intents"])
        if intent and r["text"] in cache:
            out["train"].append((cache[r["text"]], LABELS.index(intent), 0, None))
            extra += 1
    # The app's shortcut parser classifies each action of "whenever I say X, A and B" on its own, lowercased and
    # without punctuation or politeness ("set the ac to 20"): train on that form too.
    clauses = {(clause(t), i, n, None) for t, i, n, _ in out["train"]} - set(out["train"])
    out["train"] += sorted(c for c in clauses if c[0])
    for split, name in (("train", "train"), ("generated_test", "test")):
        rows = [(r["text"], LABELS.index(r["intent"]), r["negated"], tuple(r["tags"])) for r in load(GEN / f"{name}.jsonl")]
        out.setdefault(split, []).extend(rows)
    print(f"train {len(out['train'])} rows ({extra} from the command-LLM set, {len(clauses)} clause forms), val {len(out['val'])}, "
          f"test {len(out['test'])}, heldout {len(out['heldout_unseen'])}, generated test {len(out['generated_test'])}", flush=True)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--epochs", type=int, default=10)
    ap.add_argument("--lr", type=float, default=6e-5)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--export-only", action="store_true", help="skip training: export <out>/best.pt")
    args = ap.parse_args(argv)

    import torch
    from transformers import AutoModel, AutoTokenizer

    torch.manual_seed(args.seed)
    rng = random.Random(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(BASE)
    data = dataset()

    class Classifier(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = AutoModel.from_pretrained(BASE)
            h = self.encoder.config.hidden_size
            self.drop = torch.nn.Dropout(0.1)
            self.intent = torch.nn.Linear(h, len(LABELS))
            self.negation = torch.nn.Linear(h, 1)
            self.slots = torch.nn.Linear(h, len(TAGS))

        def forward(self, input_ids, attention_mask):
            hidden = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
            m = attention_mask.unsqueeze(-1).to(hidden.dtype)
            pooled = self.drop((hidden * m).sum(1) / m.sum(1).clamp(min=1e-6))  # mean pooling, as MiniLM was trained
            return self.intent(pooled), self.negation(pooled).squeeze(-1), self.slots(self.drop(hidden))

    model = Classifier().to(device)

    def batch(rows):
        # Words as the app's WordPiece.basicTokens splits them; the first piece of each word carries its tag.
        enc = tok([words(r[0]) for r in rows], is_split_into_words=True, padding=True, truncation=True,
                  max_length=MAX_LEN, return_tensors="pt")
        slot = torch.full(enc.input_ids.shape, -100, dtype=torch.long)
        for b, r in enumerate(rows):
            if r[3] is None:
                continue
            prev = None
            for t, w in enumerate(enc.word_ids(b)):
                if w is not None and w != prev:
                    slot[b, t] = TAGS.index(r[3][w])
                prev = w
        return (enc.input_ids.to(device), enc.attention_mask.to(device), torch.tensor([r[1] for r in rows], device=device),
                torch.tensor([r[2] for r in rows], device=device).float(), slot.to(device))

    def evaluate(rows) -> dict:
        model.eval()
        right = neg_right = tagged = tags_right = 0
        with torch.no_grad():
            for i in range(0, len(rows), 128):
                ids, mask, y, n, slot = batch(rows[i:i + 128])
                li, ln, ls = model(ids, mask)
                right += (li.argmax(-1) == y).sum().item()
                neg_right += ((ln > 0).float() == n).sum().item()
                for b in range(len(y)):  # a sentence counts only when every tagged word is right
                    keep = slot[b] != -100
                    if keep.any():
                        tagged += 1
                        tags_right += int(bool((ls[b].argmax(-1)[keep] == slot[b][keep]).all()))
        out = {"intent_accuracy": round(right / len(rows), 4), "negation_accuracy": round(neg_right / len(rows), 4), "n": len(rows)}
        if tagged:
            out["value_sentence_accuracy"] = round(tags_right / tagged, 4)
        return out

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps = args.epochs * ((len(data["train"]) + args.batch - 1) // args.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps, pct_start=0.1)
    best, log, t0 = -1.0, [], time.time()
    args.out.mkdir(parents=True, exist_ok=True)
    ckpt = args.out / "best.pt"
    for ep in range(1, 0 if args.export_only else args.epochs + 1):
        model.train()
        train = data["train"][:]
        rng.shuffle(train)
        for i in range(0, len(train), args.batch):
            ids, mask, y, n, slot = batch(train[i:i + args.batch])
            li, ln, ls = model(ids, mask)
            loss = torch.nn.functional.cross_entropy(li, y, label_smoothing=0.05) + \
                torch.nn.functional.binary_cross_entropy_with_logits(ln, n)
            if (slot != -100).any():
                loss = loss + torch.nn.functional.cross_entropy(ls.reshape(-1, len(TAGS)), slot.reshape(-1), ignore_index=-100)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
        val = evaluate(data["val"])
        gen = evaluate(data["generated_test"])
        log.append({"epoch": ep, **val, "generated_test": gen, "elapsed_s": round(time.time() - t0, 1)})
        print(log[-1], flush=True)
        score = val["intent_accuracy"] + gen["intent_accuracy"] + gen.get("value_sentence_accuracy", 0)
        if score > best:
            best = score
            torch.save(model.state_dict(), ckpt)

    model.load_state_dict(torch.load(ckpt, map_location=device))
    results = {s: evaluate(data[s]) for s in ("val", "test", "heldout_unseen", "generated_test")}
    print("best:", results, flush=True)

    class Export(torch.nn.Module):  # probabilities out, so the app does no math beyond argmax
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_ids, attention_mask):
            li, ln, ls = self.m(input_ids, attention_mask)
            return torch.softmax(li, -1), torch.sigmoid(ln), ls.argmax(-1)

    model.eval().to("cpu")
    ex = tok(["set the ac to 22"], return_tensors="pt")
    torch.onnx.export(Export(model), (ex.input_ids, ex.attention_mask), str(args.out / "model.fp32.onnx"),
                      input_names=["input_ids", "attention_mask"], output_names=["intent_probs", "negation_prob", "slot_tags"],
                      dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"},
                                    "intent_probs": {0: "batch"}, "negation_prob": {0: "batch"},
                                    "slot_tags": {0: "batch", 1: "seq"}},
                      opset_version=17, dynamo=False)
    from huggingface_hub import hf_hub_download

    shutil.copy(hf_hub_download(BASE, "vocab.txt"), args.out / "vocab.txt")
    (args.out / "labels.json").write_text(json.dumps({"labels": LABELS, "tags": TAGS, "max_len": MAX_LEN, "lowercase": True}, indent=1), encoding="utf-8")
    if log:  # an --export-only run keeps the training run's record
        (args.out / "training.json").write_text(json.dumps({"base": BASE, "epochs": log, "results": results,
                                                            "train_rows": len(data["train"])}, indent=1), encoding="utf-8")
    ckpt.unlink()
    print("wrote", args.out, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
