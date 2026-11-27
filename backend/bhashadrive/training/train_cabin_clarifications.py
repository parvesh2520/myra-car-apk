"""Train a small follow-up intent head on the Android shortcut encoder.

Run from the backend directory with NumPy and ONNX Runtime installed.

    python -m bhashadrive.training.train_cabin_clarifications
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import numpy as np
import onnxruntime as ort

BACKEND = Path(__file__).resolve().parents[2]
ANDROID = BACKEND.parent / "android-car"
DATA = BACKEND / "data/nlu_v2/cabin_clarifications.json"
ENCODER = ANDROID / "models/shortcut_minilm.int8.onnx"
ASSETS = ANDROID / "app/src/main/assets"
MIN_SCORE = 0.60
MIN_LEAD = 0.16


def encode(session: ort.InferenceSession, vocab: dict[str, int], text: str) -> np.ndarray:
    ids = [vocab["[CLS]"]]
    # The training data uses English ASCII, matching the app's uncased WordPiece for these phrases.
    for token in re.findall(r"[a-z0-9]+|[^a-z0-9\s]", text.lower()):
        start, pieces = 0, []
        while start < len(token):
            for end in range(len(token), start, -1):
                word = ("##" if start else "") + token[start:end]
                if word in vocab:
                    pieces.append(vocab[word])
                    start = end
                    break
            else:
                pieces = [vocab["[UNK]"]]
                break
        ids.extend(pieces)
    tokens = np.asarray([ids[:31] + [vocab["[SEP]"]]], dtype=np.int64)
    hidden = session.run(None, {
        "input_ids": tokens,
        "attention_mask": np.ones_like(tokens),
        "token_type_ids": np.zeros_like(tokens),
    })[0][0].mean(axis=0)
    return hidden / np.linalg.norm(hidden)


def probabilities(logits: np.ndarray) -> np.ndarray:
    scores = np.exp(logits - logits.max(axis=1, keepdims=True))
    return scores / scores.sum(axis=1, keepdims=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=ASSETS / "cabin_clarifications.json")
    args = parser.parse_args()
    data = json.loads(DATA.read_text(encoding="utf-8"))
    labels = list(data["train"])
    vocab = {word: index for index, word in enumerate((ASSETS / "vocab.txt").read_text(encoding="utf-8").splitlines())}
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 2
    session = ort.InferenceSession(str(ENCODER), opts, providers=["CPUExecutionProvider"])

    def features(split: str) -> tuple[np.ndarray, np.ndarray, list[str]]:
        rows = [(label, phrase) for label, phrases in data[split].items() for phrase in phrases]
        return (
            np.stack([encode(session, vocab, text) for _, text in rows]).astype(np.float64),
            np.asarray([labels.index(label) for label, _ in rows]),
            [text for _, text in rows],
        )

    train, targets, _ = features("train")
    test, expected, texts = features("test")
    if set(text.lower() for text in texts) & {text.lower() for rows in data["train"].values() for text in rows}:
        raise ValueError("A held-out phrase is also in training")
    weights = np.zeros((train.shape[1], len(labels)))
    bias = np.zeros(len(labels))
    one_hot = np.eye(len(labels))[targets]
    sample_weight = 1 / np.bincount(targets)[targets]
    sample_weight /= sample_weight.sum()
    for _ in range(2400):
        error = (probabilities(train @ weights + bias) - one_hot) * sample_weight[:, None]
        weights -= 1.5 * (train.T @ error + 0.0002 * weights)
        bias -= 1.5 * error.sum(axis=0)

    scores = probabilities(test @ weights + bias)
    top = scores.argsort(axis=1)[:, -2:][:, ::-1]
    predicted = [
        first if row[first] >= MIN_SCORE and row[first] - row[second] >= MIN_LEAD else labels.index("none")
        for row, (first, second) in zip(scores, top)
    ]
    for text, wanted, guess in zip(texts, expected, predicted):
        if wanted != guess:
            print(f"{text!r}: expected {labels[wanted]}, got {labels[guess]}")
    print(f"{len(train)} training examples; {sum(expected == predicted)}/{len(test)} held-out decisions")
    result = {
        "encoder_sha256": hashlib.sha256(ENCODER.read_bytes()).hexdigest(),
        "min_score": MIN_SCORE,
        "min_lead": MIN_LEAD,
        "labels": labels,
        "bias": bias.round(6).tolist(),
        "weights": weights.T.round(6).tolist(),
    }
    args.out.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
