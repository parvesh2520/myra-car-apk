"""Trains the "Okay Myra" wake-word model on openWakeWord's frozen speech features and calibrates the trim.

Inputs (see README.md next to this file): clips.npz from gen_clips.py, openWakeWord's melspectrogram.onnx and
embedding_model.onnx, its ACAV100M negative features (any leading part of the .npy) and validation_set_features.npy.

Features are computed exactly as the car computes them while streaming (features.stream_embeddings), so the
model sees on the PC what it will see in the car. Each training example is a scene: lead-in (silence, noise or
other speech), the wake phrase, then nothing or a command; the window ending right after "Myra" is the positive,
windows ending before it are negatives, so the model fires at the end of the wake word and that instant is known.

Writes to --out: myra_wake.onnx (input [1,16,96] embeddings -> [1,1] score) and wake_calibration.json (threshold,
how far before the firing chunk the wake word ends, and the trim/accuracy measured on unseen voices).
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from features import CHUNK, Features  # noqa: E402

SR = 16000
# Positives are narrow and negatives close on both sides, so the model fires at a predictable instant after
# "Myra" and the trim's search range stays short.
POS_AFTER = 3 * CHUNK  # windows ending 0..240 ms after "Myra" are positives
NEG_BEFORE = 2 * CHUNK  # windows ending more than 160 ms before the end of "Myra" are negatives
NEG_AFTER = SR  # and windows ending more than 1 s after it (one wake per "Myra")
CONSECUTIVE = 2  # the car wakes when this many chunks in a row pass the threshold: lone spikes are false wakes


class Scenes:
    """Random scenes around clips: noise, reverb, level and microphone band, like a car cabin."""

    def __init__(self, clips: dict, rng: random.Random):
        self.c = clips
        self.rng = rng
        self.np = np.random.default_rng(rng.randrange(1 << 30))

    def noise(self, n: int) -> np.ndarray:
        r, g = self.rng, self.np
        kind = r.random()
        if kind < 0.35:  # engine: low harmonics plus rumble
            t = np.arange(n) / SR
            f0 = r.uniform(25, 70)
            x = sum(g.uniform(0.2, 1) / k * np.sin(2 * np.pi * f0 * k * t + g.uniform(0, 6.3)) for k in range(1, 9))
            x = x + np.cumsum(g.normal(0, 1, n)) * 0.02
        elif kind < 0.6:  # road / fan: coloured noise
            x = g.normal(0, 1, n)
            alpha = r.uniform(0, 0.98)
            from scipy.signal import lfilter
            x = lfilter([1], [1, -alpha], x)
        elif kind < 0.85:  # other people talking
            x = np.zeros(n)
            pos = 0
            while pos < n:
                s = self.c[r.choice(["command_train", "near_train"])]
                s = s[r.randrange(len(s))].astype(np.float64)
                m = min(len(s), n - pos)
                x[pos:pos + m] += s[:m]
                pos += m + r.randrange(0, SR // 2)
        else:
            x = g.normal(0, 1, n)
        x = x - x.mean()
        return x / (np.sqrt((x ** 2).mean()) + 1e-9)

    def finish(self, speech: np.ndarray) -> np.ndarray:
        r, g = self.rng, self.np
        x = speech.astype(np.float64)
        if r.random() < 0.5:  # small-room reverb
            rt60 = r.uniform(0.05, 0.35)
            t = np.arange(int(rt60 * SR)) / SR
            h = g.normal(0, 1, len(t)) * np.exp(-6.9 * t / rt60) * r.uniform(0.05, 0.4)
            h[0] = 1
            from scipy.signal import fftconvolve
            x = fftconvolve(x, h)[: len(x)]
        if r.random() < 0.8:
            rms = np.sqrt((speech.astype(np.float64) ** 2).mean()) + 1e-9
            x = x + self.noise(len(x)) * rms / 10 ** (r.uniform(-2, 25) / 20)
        if r.random() < 0.3:
            from scipy.signal import butter, sosfilt
            x = sosfilt(butter(4, r.uniform(3400, 7000), fs=SR, output="sos"), x)
        if r.random() < 0.3:
            from scipy.signal import butter, sosfilt
            x = sosfilt(butter(2, r.uniform(80, 300), btype="high", fs=SR, output="sos"), x)
        x = x / (np.abs(x).max() + 1e-9) * 32767 * 10 ** (r.uniform(-30, -1) / 20)
        return x.astype(np.int16)

    def scene(self, middle: np.ndarray, follow: bool, split: str):
        """lead + middle + gap + (command) + tail; returns audio and the sample where middle ends."""
        r = self.rng
        parts = []
        lead = int(r.uniform(1.4, 2.4) * SR)
        if r.random() < 0.4:  # something said before, then a pause
            s = self.c[f"{r.choice(['command', 'near'])}_{split}"]
            s = s[r.randrange(len(s))]
            pre = np.zeros(lead, np.int16)
            k = min(len(s), lead - SR // 4)
            pre[lead - SR // 4 - k: lead - SR // 4] = s[-k:]
            parts.append(pre)
        else:
            parts.append(np.zeros(lead, np.int16))
        parts.append(middle)
        end = sum(map(len, parts))
        gap = 0 if r.random() < 0.35 else int(r.uniform(0.02, 0.5) * SR)
        parts.append(np.zeros(gap, np.int16))
        cmd_start = None
        if follow:
            s = self.c[f"command_{split}"]
            cmd_start = sum(map(len, parts))
            parts.append(s[r.randrange(len(s))])
        parts.append(np.zeros(int(r.uniform(0.5, 1.0) * SR), np.int16))
        return self.finish(np.concatenate(parts)), end, cmd_start


def build(clips, feats: Features, split: str, n_pos: int, n_neg: int, seed: int):
    sc = Scenes(clips, random.Random(seed))
    X, y = [], []
    for i in range(n_pos):
        w = clips[f"wake_{split}"]
        audio, end, _ = sc.scene(w[i % len(w)], sc.rng.random() < 0.7, split)
        e = feats.stream_embeddings(audio)
        for k in range(15, len(e)):
            t = (k + 1) * CHUNK
            lab = 1 if 0 <= t - end <= POS_AFTER else 0 if (t < end - NEG_BEFORE or t > end + NEG_AFTER) else None
            if lab is not None:
                X.append(e[k - 15:k + 1]); y.append(lab)
    for i in range(n_neg):
        g = sc.rng.random()
        src = clips[f"near_{split}"] if g < 0.75 else clips[f"command_{split}"]
        mid = src[sc.rng.randrange(len(src))] if g < 0.95 else np.zeros(SR // 2, np.int16)
        audio, _, _ = sc.scene(mid, sc.rng.random() < 0.5, split)
        e = feats.stream_embeddings(audio)
        for k in range(15, len(e), 2):
            X.append(e[k - 15:k + 1]); y.append(0)
        if (i + 1) % 1000 == 0:
            print(split, "negative scenes", i + 1, flush=True)
    return np.array(X, np.float16), np.array(y, np.float32)


def net():
    import torch.nn as nn
    return nn.Sequential(nn.Flatten(), nn.Linear(16 * 96, 128), nn.LayerNorm(128), nn.ReLU(),
                         nn.Linear(128, 128), nn.LayerNorm(128), nn.ReLU(), nn.Linear(128, 1))


def scores(model, x, dev, bs=8192):
    import torch
    out = []
    with torch.no_grad():
        for i in range(0, len(x), bs):
            out.append(torch.sigmoid(model(torch.tensor(np.asarray(x[i:i + bs], np.float32), device=dev))).cpu().numpy()[:, 0])
    return np.concatenate(out)


def over(s, thr):
    """Chunks where the car wakes: the last of CONSECUTIVE chunks in a row at or over [thr]."""
    m = np.lib.stride_tricks.sliding_window_view(s, CONSECUTIVE).min(1) if len(s) >= CONSECUTIVE else s[:0]
    return np.nonzero(m >= thr)[0] + CONSECUTIVE - 1


def false_accepts_per_hour(model, val, dev, thr, s=None):
    if s is None:
        s = scores(model, np.lib.stride_tricks.sliding_window_view(val, (16, 96))[:, 0], dev)
    fires, last = 0, -10 ** 9
    for k in over(s, thr):
        if k - last > 25:  # one activation per 2 s
            fires += 1
        last = k
    return fires / (len(val) * 0.08 / 3600)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", type=Path, required=True)
    ap.add_argument("--oww", type=Path, required=True, help="folder with the openWakeWord onnx and npy files")
    ap.add_argument("--acav", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--steps", type=int, default=40000)
    ap.add_argument("--scenes", type=int, default=3, help="scenes per wake clip")
    ap.add_argument("--eval-only", action="store_true", help="re-evaluate and re-export the saved myra_wake.pt")
    args = ap.parse_args(argv)
    import torch
    if args.eval_only:
        clips = dict(np.load(args.clips, allow_pickle=True))
        feats = Features(args.oww / "melspectrogram.onnx", args.oww / "embedding_model.onnx")
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        model = net().to(dev)
        model.load_state_dict(torch.load(args.out / "myra_wake.pt", map_location=dev))
        evaluate(model.eval(), clips, feats, np.load(args.oww / "validation_set_features.npy"), dev, args.out)
        return 0

    args.out.mkdir(parents=True, exist_ok=True)
    clips = dict(np.load(args.clips, allow_pickle=True))
    feats = Features(args.oww / "melspectrogram.onnx", args.oww / "embedding_model.onnx")
    cache = args.out / "train_features.npz"
    if cache.exists():
        d = np.load(cache)
        Xtr, ytr = d["X"], d["y"]
    else:
        Xtr, ytr = build(clips, feats, "train", len(clips["wake_train"]) * args.scenes,
                         (len(clips["near_train"]) + len(clips["command_train"])) * 2, 1)
        np.savez(cache, X=Xtr, y=ytr)
    print("train windows", len(ytr), "positives", int(ytr.sum()), flush=True)

    with open(args.acav, "rb") as fh:
        ver = np.lib.format.read_magic(fh)
        shape, _, dt = (np.lib.format.read_array_header_1_0 if ver == (1, 0) else np.lib.format.read_array_header_2_0)(fh)
        off = fh.tell()
    n_acav = (args.acav.stat().st_size - off) // (16 * 96 * 2)
    acav = np.memmap(args.acav, dtype=dt, mode="r", offset=off, shape=(n_acav, 16, 96))
    val = np.load(args.oww / "validation_set_features.npy")
    print("acav windows", n_acav, "validation hours", round(len(val) * 0.08 / 3600, 1), flush=True)

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(0)
    model = net().to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-2)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 1e-3, total_steps=args.steps, pct_start=0.1)
    pos = np.nonzero(ytr == 1)[0]
    neg = np.nonzero(ytr == 0)[0]
    rng = np.random.default_rng(0)
    hard = np.empty(0, np.int64)  # ACAV windows the model scored high: shown again
    bce = torch.nn.BCEWithLogitsLoss(reduction="none")
    for step in range(args.steps):
        a_idx = np.sort(rng.integers(0, n_acav, 1024))
        if len(hard):
            a_idx = np.concatenate([a_idx[:768], rng.choice(hard, 256)])
        xb = np.concatenate([Xtr[rng.choice(pos, 256)], Xtr[rng.choice(neg, 512)], acav[a_idx]]).astype(np.float32)
        yb = np.concatenate([np.ones(256), np.zeros(512 + len(a_idx))]).astype(np.float32)
        # negatives weigh more as training goes on: first learn the word, then stop false alarms
        wneg = 1 + 19 * min(1.0, step / (0.6 * args.steps))
        wb = np.where(yb == 1, 1.0, wneg).astype(np.float32)
        x = torch.tensor(xb, device=dev)
        loss = (bce(model(x)[:, 0], torch.tensor(yb, device=dev)) * torch.tensor(wb, device=dev)).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
        if (step + 1) % 2000 == 0:
            model.eval()
            probe = np.sort(rng.integers(0, n_acav, 500_000))
            s = scores(model, acav[probe], dev)
            hard = np.unique(np.concatenate([hard, probe[s > 0.05]]))[-50_000:]
            fa = false_accepts_per_hour(model, val, dev, 0.5)
            print(f"step {step + 1} loss {loss.item():.4f} wneg {wneg:.1f} hard {len(hard)} FA/h@0.5 {fa:.2f}", flush=True)
            model.train()
    model.eval()
    torch.save(model.state_dict(), args.out / "myra_wake.pt")
    evaluate(model, clips, feats, val, dev, args.out)
    return 0


def evaluate(model, clips, feats, val, dev, out: Path):
    """Unseen voices: how often it wakes, how often near-sounding phrases wake it, when it fires vs the true end."""
    import torch
    sc = Scenes(clips, random.Random(99))
    runs = []
    for i in range(len(clips["wake_test"]) * 2):
        w = clips["wake_test"][i % len(clips["wake_test"])]
        audio, end, cmd = sc.scene(w, True, "test")
        e = feats.stream_embeddings(audio)
        win = np.stack([e[k - 15:k + 1] for k in range(15, len(e))])
        runs.append((audio, end, cmd, scores(model, win, dev)))
    near = []
    for i in range(len(clips["near_test"])):
        audio, _, _ = sc.scene(clips["near_test"][i], sc.rng.random() < 0.5, "test")
        e = feats.stream_embeddings(audio)
        near.append(scores(model, np.stack([e[k - 15:k + 1] for k in range(15, len(e))]), dev))
    vs = scores(model, np.lib.stride_tricks.sliding_window_view(val, (16, 96))[:, 0], dev)
    report = {}
    for thr in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99):
        lat = [f - end for _, end, _, s in runs if (f := wake_fire(s, thr, end)) is not None]
        report[thr] = {"recall": len(lat) / len(runs), "near_false": float(np.mean([len(over(s, thr)) > 0 for s in near])),
                       "fa_per_hour": false_accepts_per_hour(model, val, dev, thr, vs),
                       "latency_ms_p1_p50_p99": [float(np.percentile(lat, p)) / 16 for p in (1, 50, 99)] if lat else None}
        print(thr, report[thr], flush=True)
    ok = [t for t in report if report[t]["fa_per_hour"] <= 0.5 and report[t]["near_false"] <= 0.05
          and report[t]["recall"] >= 0.9]
    if not ok:
        print("NO THRESHOLD MEETS fa_per_hour <= 0.5, near_false <= 0.05, recall >= 0.9; using the one with fewest false wakes")
    # the highest threshold within 1 point of the best recall: fewer false wakes for almost no missed ones
    best = max((report[t]["recall"] for t in ok), default=0)
    thr = max(t for t in ok if report[t]["recall"] >= best - 0.01) if ok else \
        min(report, key=lambda t: (report[t]["fa_per_hour"] + 10 * report[t]["near_false"], -report[t]["recall"]))
    lat = np.array([f - end for _, end, _, s in runs if (f := wake_fire(s, thr, end)) is not None])
    cal = {"threshold": thr, "consecutive": CONSECUTIVE, "meets_target": bool(ok),
           "end_before_fire_min_ms": float(np.percentile(lat, 0.5)) / 16,
           "end_before_fire_max_ms": float(np.percentile(lat, 99.5)) / 16, "report": report}
    cal["trim"] = trim_check(runs, thr, cal)
    print(json.dumps(cal["trim"]), flush=True)
    (out / "wake_calibration.json").write_text(json.dumps(cal, indent=1))
    torch.onnx.export(torch.nn.Sequential(model.cpu(), torch.nn.Sigmoid()), torch.zeros(1, 16, 96), out / "myra_wake.onnx",
                      input_names=["embeddings"], output_names=["score"], opset_version=13, dynamo=False)


def wake_fire(s, thr, end):
    """Sample where the car wakes in a wake scene: the first wake near "Myra" (earlier ones are false wakes on
    the lead-in, counted by fa_per_hour), or None."""
    ks = [(k + 16) * CHUNK for k in over(s, thr)]
    ks = [f for f in ks if f > end - SR // 2]
    return ks[0] if ks else None


def trim_check(runs, thr, cal):
    """Applies the car's trim (features.cut) to unseen-voice scenes and counts how often it cuts the command."""
    from features import cut
    cuts_cmd = tail = ok = 0
    errs = []
    for audio, end, cmd, s in runs:
        fire = wake_fire(s, thr, end)
        if fire is None:
            continue
        c = cut(audio, fire, cal["end_before_fire_min_ms"], cal["end_before_fire_max_ms"])
        errs.append((c - end) / 16)
        if cmd is not None and c > cmd + 160:  # more than 10 ms of the command lost
            cuts_cmd += 1
        elif c < end - 1600:  # more than 100 ms of "Myra" kept
            tail += 1
        else:
            ok += 1
    n = cuts_cmd + tail + ok
    return {"scenes": n, "clean": ok / n, "cuts_command": cuts_cmd / n, "keeps_myra_tail": tail / n,
            "cut_minus_myra_end_ms_p1_p50_p99": [float(np.percentile(errs, p)) for p in (1, 50, 99)]}


if __name__ == "__main__":
    raise SystemExit(main())
