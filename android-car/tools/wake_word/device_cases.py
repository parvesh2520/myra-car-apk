"""Writes the scenes HandsFreeDeviceTest streams on a device, with the PC reference answer for each.

For unseen-voice wake scenes and sound-alike scenes: raw 16 kHz PCM in app/src/androidTest/assets/, and
wake_cases.json with the sample where the command should start (features.cut where the car wakes: CONSECUTIVE
chunks over the threshold) or null. Scenes whose deciding scores are within 0.5 logit of the threshold are
skipped, since float rounding on another CPU may legitimately flip them.

    python tools/wake_word/device_cases.py --clips C:\\m\\wake\\clips.npz --oww C:\\m\\oww
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from features import CHUNK, Features, cut, cut_end  # noqa: E402
from train_wake import CONSECUTIVE, Scenes, over  # noqa: E402

MODELS = HERE.parent.parent / "models" / "wake"
ASSETS = HERE.parent.parent / "app" / "src" / "androidTest" / "assets"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", type=Path, required=True)
    ap.add_argument("--oww", type=Path, required=True)
    ap.add_argument("--wake", type=int, default=8)
    ap.add_argument("--near", type=int, default=4)
    args = ap.parse_args(argv)
    import onnxruntime as ort

    clips = dict(np.load(args.clips, allow_pickle=True))
    feats = Features(MODELS / "melspectrogram.onnx", MODELS / "embedding_model.onnx")
    model = ort.InferenceSession(str(MODELS / "myra_wake.onnx"))
    cal = json.loads((MODELS / "wake_calibration.json").read_text())
    thr = cal["threshold"]
    assert cal["consecutive"] == CONSECUTIVE

    def logit(x):
        x = np.clip(x, 1e-7, 1 - 1e-7)
        return np.log(x / (1 - x))
    sc = Scenes(clips, random.Random(1234))
    ASSETS.mkdir(parents=True, exist_ok=True)
    for old in ASSETS.glob("case*.pcm"):
        old.unlink()
    cases = []
    want = {"wake": args.wake, "near": args.near}
    tries = 0
    while any(want.values()) and tries < 500:
        tries += 1
        kind = "wake" if want["wake"] else "near"
        src = clips[f"{kind}_test"]
        audio, end, cmd = sc.scene(src[sc.rng.randrange(len(src))], True, "test")
        e = feats.stream_embeddings(audio)
        s = np.array([model.run(None, {"embeddings": e[k - 15:k + 1][None].astype(np.float32)})[0].item()
                      for k in range(15, len(e))])
        # how far each chunk's run of CONSECUTIVE is past the threshold, in logits
        run = logit(np.lib.stride_tricks.sliding_window_view(s, CONSECUTIVE).min(1)) - logit(thr)
        hit = over(s, thr)
        if kind == "wake":
            if not len(hit):
                continue
            k = hit[0] - (CONSECUTIVE - 1)
            fire = (hit[0] + 16) * CHUNK
            if run[k] < 0.5 or (run[:k] > -0.5).any() or fire < end - 8000 or cut_end(fire, cal["end_before_fire_min_ms"]) > len(audio):
                continue
            c = cut(audio, fire, cal["end_before_fire_min_ms"], cal["end_before_fire_max_ms"])
        else:
            if (run > -1).any():
                continue
            c = None
        name = f"case{len(cases)}.pcm"
        (ASSETS / name).write_bytes(audio.astype("<i2").tobytes())
        cases.append({"pcm": name, "cut": int(c) if c is not None else None, "myra_end": int(end),
                      "command_start": int(cmd) if cmd is not None else None})
        want[kind] -= 1
    (ASSETS / "wake_cases.json").write_text(json.dumps({"cases": cases}, indent=1))
    print(len(cases), "cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
