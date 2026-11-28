"""openWakeWord features exactly as the car streams them (HandsFree.kt mirrors this file), and the trim.

Per 80 ms chunk (1280 samples): melspectrogram.onnx on the last 1760 samples (480 of history; zeros at the start)
gives 8 frames, scaled x/10 + 2 and appended to a 76-frame buffer that starts as ones; embedding_model.onnx on the
last 76 frames gives one 96-value embedding. The wake model reads the last 16 embeddings.
"""
from __future__ import annotations

import numpy as np

CHUNK = 1280
HISTORY = 480


class Features:
    def __init__(self, mel_path, emb_path):
        import onnxruntime as ort
        o = ort.SessionOptions()
        o.intra_op_num_threads = 4
        self.mel = ort.InferenceSession(str(mel_path), o, providers=["CPUExecutionProvider"])
        self.emb = ort.InferenceSession(str(emb_path), o, providers=["CPUExecutionProvider"])

    def stream_embeddings(self, audio: np.ndarray) -> np.ndarray:
        """Embedding after each whole chunk of int16 [audio]: shape (len // 1280, 96)."""
        k = len(audio) // CHUNK
        x = np.concatenate([np.zeros(HISTORY, np.float32), audio[:k * CHUNK].astype(np.float32)])
        idx = np.arange(k)[:, None] * CHUNK + np.arange(CHUNK + HISTORY)[None, :]
        mel = self.mel.run(None, {"input": x[idx]})[0][:, 0] / 10 + 2  # (k, 8, 32)
        frames = np.concatenate([np.ones((76, 32), np.float32), mel.reshape(-1, 32)])
        win = np.stack([frames[8 * (i + 1): 8 * (i + 1) + 76] for i in range(k)])[..., None].astype(np.float32)
        return np.concatenate([self.emb.run(None, {"input_1": win[i:i + 512]})[0].reshape(-1, 96)
                               for i in range(0, k, 512)])


PAUSE_DEPTH_DB = 20  # a pause is this much quieter than the loudest 10 ms frame in the search range
PAUSE_MIN_FRAMES = 12  # and lasts 120 ms: shorter dips can be consonants or a short gap inside the command


def cut_end(fire: int, end_min_ms: float) -> int:
    """The last sample cut() looks at; the car waits for it before trimming (end_min_ms < 0: "Myra" can still
    be ending when the model fires)."""
    return fire - int(end_min_ms * 16) + 960  # +60 ms: a pause can start just after the range


def cut(audio: np.ndarray, fire: int, end_min_ms: float, end_max_ms: float) -> int:
    """Where the command starts, given that the model fired at sample [fire] and "Myra" ends between end_max_ms
    before and -end_min_ms after it. If that range holds a pause (the quietest 10 ms frames, within 6 dB of the
    quietest, PAUSE_DEPTH_DB under the loudest and PAUSE_MIN_FRAMES long), its start. Otherwise the start of the
    range: the command follows "Myra" with no gap, and keeping some of "Myra" (the transcript drops it) is better
    than losing the command's first sound."""
    lo = max(0, (fire - int(end_max_ms * 16)) // 160 * 160)
    hi = min(len(audio), cut_end(fire, end_min_ms))
    if hi - lo < 160:
        return max(0, min(fire, len(audio)))
    f = audio[lo: lo + (hi - lo) // 160 * 160].astype(np.float64).reshape(-1, 160)
    e = 10 * np.log10((f ** 2).mean(1) + 1)
    a = b = int(np.argmin(e))
    while a > 0 and e[a - 1] <= e.min() + 6:
        a -= 1
    while b + 1 < len(e) and e[b + 1] <= e.min() + 6:
        b += 1
    return lo + a * 160 if e.max() - e.min() >= PAUSE_DEPTH_DB and b - a + 1 >= PAUSE_MIN_FRAMES else lo
