"""8-bit car classifier and its check: model.fp32.onnx -> model.int8.onnx, scored like the car app runs it.

  python -m bhashadrive.training.quantize_car_classifier --dir <dir from train_car_classifier>   # backend venv

Scores both models with onnxruntime + a BERT WordPiece tokenizer built from vocab.txt (the tokenizer the app
reimplements) on the English test sets, times one-sentence inference on 1 thread, and writes
<dir>/tokenizer_fixture.json: token ids for sample sentences, which the app's unit test compares against.
"""
from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

import numpy as np

from .train_car_classifier import LABELS, NLU, load

FIXTURE = ["Set the AC to 22 degrees.", "Turn up the volume a little!", "Don't switch the AC off",
           "Take me to Phoenix MarketCity, please.", "Play some romantic songs", "it's too hot in here",
           "Navigate to the nearest petrol pump", "café naïve résumé", "ghar le chalo", "unbelievably loud"]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", type=Path, required=True)
    args = ap.parse_args(argv)
    import onnxruntime as ort
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from tokenizers import BertWordPieceTokenizer

    meta = json.loads((args.dir / "labels.json").read_text(encoding="utf-8"))
    assert meta["labels"] == LABELS
    quantize_dynamic(str(args.dir / "model.fp32.onnx"), str(args.dir / "model.int8.onnx"), weight_type=QuantType.QInt8)
    tok = BertWordPieceTokenizer(str(args.dir / "vocab.txt"), lowercase=True)
    tok.enable_truncation(meta["max_len"])

    def encode(text: str):
        ids = np.array([tok.encode(text).ids], dtype=np.int64)
        return {"input_ids": ids, "attention_mask": np.ones_like(ids)}

    report = {}
    for name in ("model.fp32.onnx", "model.int8.onnx"):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1  # a slow head unit core
        sess = ort.InferenceSession(str(args.dir / name), opts, providers=["CPUExecutionProvider"])
        scores = {}
        for split in ("test", "heldout_unseen"):
            rows = load(NLU / f"{split}_en.jsonl")
            right = neg = 0
            for r in rows:
                probs, negp, _ = sess.run(None, encode(r["text"]))
                right += LABELS[int(probs[0].argmax())] == r["intent"]
                neg += bool(negp[0] > 0.5) == bool(r.get("negated"))
            scores[split] = {"intent_accuracy": round(right / len(rows), 4), "negation_accuracy": round(neg / len(rows), 4), "n": len(rows)}
        times = []
        for _ in range(50):
            t = time.perf_counter()
            sess.run(None, encode("please set the temperature to twenty two degrees"))
            times.append((time.perf_counter() - t) * 1000)
        report[name] = {**scores, "size_mb": round((args.dir / name).stat().st_size / 1e6, 1),
                        "latency_ms_1thread_median": round(statistics.median(times), 2)}
        print(name, report[name], flush=True)

    (args.dir / "tokenizer_fixture.json").write_text(
        json.dumps([{"text": t, "ids": tok.encode(t).ids} for t in FIXTURE], indent=1), encoding="utf-8")
    (args.dir / "quantize_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
