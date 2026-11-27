"""On-device intent classifier for the car app: English MiniLM-L6 fine-tuned on the V2 NLU taxonomy.

In the car, Sarvam translates the driver's speech to English, so an English encoder is enough: MiniLM-L6
(6 layers, 30k-word vocabulary, ~22M parameters) instead of the multilingual MiniLM-L12 (250k words, 118 MB at
int8). One encoder, two heads: the intent (18 classes, V2 taxonomy) and negation ("don't turn the AC off").

Data: data/nlu_v2/*_en.jsonl (translate_nlu_data.py) plus the single-command rows of the command-LLM training
set already translated to English (data/command_llm/en_cache.jsonl, train split only), mapped to V2 intents.

  python -m bhashadrive.training.train_car_classifier --out <dir>      # GPU env: torch + transformers
Writes <dir>/model.fp32.onnx (inputs input_ids, attention_mask; outputs intent_probs, negation_prob),
<dir>/vocab.txt, <dir>/labels.json and <dir>/training.json. quantize_car_classifier.py makes model.int8.onnx.
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NLU = ROOT / "data" / "nlu_v2"
CMD = ROOT / "data" / "command_llm"
BASE = "sentence-transformers/all-MiniLM-L6-v2"
MAX_LEN = 32
LABELS = ["climate_temperature_up", "climate_temperature_down", "climate_temperature_set", "climate_fan_speed_up",
          "climate_fan_speed_down", "climate_on", "climate_off", "volume_up", "volume_down", "media_play",
          "media_pause", "media_next", "media_previous", "navigation_destination_request", "dialog_confirm",
          "dialog_cancel", "unsupported", "ambiguous"]


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
    if t in {"climate.fan", "media.volume", "media.play"}:
        return None  # a value/mute/radio variant the V2 taxonomy has no intent for
    return "unsupported"  # a car function the demo cannot perform


def dataset() -> dict[str, list[tuple[str, int, int]]]:
    """(text, intent index, negated 0/1) per split."""
    out = {s: [(r["text"], LABELS.index(r["intent"]), int(bool(r.get("negated")))) for r in load(NLU / f"{s}_en.jsonl")]
           for s in ("train", "val", "test", "heldout_unseen")}
    cache = {}
    if (CMD / "en_cache.jsonl").is_file():
        for c in load(CMD / "en_cache.jsonl"):
            cache[c["text"]] = c["en"]
    extra = 0
    for r in load(CMD / "train.jsonl"):
        intent = v2_intent(r["intents"])
        if intent and r["text"] in cache:
            out["train"].append((cache[r["text"]], LABELS.index(intent), 0))
            extra += 1
    print(f"train {len(out['train'])} rows ({extra} from the command-LLM set), val {len(out['val'])}, "
          f"test {len(out['test'])}, heldout {len(out['heldout_unseen'])}", flush=True)
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

        def forward(self, input_ids, attention_mask):
            hidden = self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
            m = attention_mask.unsqueeze(-1).to(hidden.dtype)
            pooled = self.drop((hidden * m).sum(1) / m.sum(1).clamp(min=1e-6))  # mean pooling, as MiniLM was trained
            return self.intent(pooled), self.negation(pooled).squeeze(-1)

    model = Classifier().to(device)

    def batch(rows):
        enc = tok([r[0] for r in rows], padding=True, truncation=True, max_length=MAX_LEN, return_tensors="pt")
        return (enc.input_ids.to(device), enc.attention_mask.to(device),
                torch.tensor([r[1] for r in rows], device=device), torch.tensor([r[2] for r in rows], device=device).float())

    def evaluate(rows) -> dict:
        model.eval()
        right = neg_right = 0
        with torch.no_grad():
            for i in range(0, len(rows), 128):
                ids, mask, y, n = batch(rows[i:i + 128])
                li, ln = model(ids, mask)
                right += (li.argmax(-1) == y).sum().item()
                neg_right += ((ln > 0).float() == n).sum().item()
        return {"intent_accuracy": round(right / len(rows), 4), "negation_accuracy": round(neg_right / len(rows), 4), "n": len(rows)}

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
            ids, mask, y, n = batch(train[i:i + args.batch])
            li, ln = model(ids, mask)
            loss = torch.nn.functional.cross_entropy(li, y, label_smoothing=0.05) + \
                torch.nn.functional.binary_cross_entropy_with_logits(ln, n)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
        val = evaluate(data["val"])
        log.append({"epoch": ep, **val, "elapsed_s": round(time.time() - t0, 1)})
        print(log[-1], flush=True)
        if val["intent_accuracy"] > best:
            best = val["intent_accuracy"]
            torch.save(model.state_dict(), ckpt)

    model.load_state_dict(torch.load(ckpt, map_location=device))
    results = {s: evaluate(data[s]) for s in ("val", "test", "heldout_unseen")}
    print("best:", results, flush=True)

    class Export(torch.nn.Module):  # probabilities out, so the app does no math beyond argmax
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, input_ids, attention_mask):
            li, ln = self.m(input_ids, attention_mask)
            return torch.softmax(li, -1), torch.sigmoid(ln)

    model.eval().to("cpu")
    ex = tok(["set the ac to 22"], return_tensors="pt")
    torch.onnx.export(Export(model), (ex.input_ids, ex.attention_mask), str(args.out / "model.fp32.onnx"),
                      input_names=["input_ids", "attention_mask"], output_names=["intent_probs", "negation_prob"],
                      dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"},
                                    "intent_probs": {0: "batch"}, "negation_prob": {0: "batch"}},
                      opset_version=17, dynamo=False)
    from huggingface_hub import hf_hub_download

    shutil.copy(hf_hub_download(BASE, "vocab.txt"), args.out / "vocab.txt")
    (args.out / "labels.json").write_text(json.dumps({"labels": LABELS, "max_len": MAX_LEN, "lowercase": True}, indent=1), encoding="utf-8")
    if log:  # an --export-only run keeps the training run's record
        (args.out / "training.json").write_text(json.dumps({"base": BASE, "epochs": log, "results": results,
                                                            "train_rows": len(data["train"])}, indent=1), encoding="utf-8")
    ckpt.unlink()
    print("wrote", args.out, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
