"""Renders Myra's spoken lines with one local neural voice (Kokoro-82M, Apache-2.0) into app assets.

The app plays these clips instead of a speech engine, so every line uses the same natural voice and starts at once.
The line list comes from the app itself: the unit test UnderstandingTest.everySpokenLineHasAVoiceClip writes
app/build/voice-lines.txt (key<TAB>text). Then, in a Python env with `kokoro` and `soundfile` (C:\\m\\ttsenv):

    python tools/make_voice.py --lines app/build/voice-lines.txt --out app/src/main/assets/voice

Existing clips are kept (use --force to re-render); clips for lines the app no longer says are removed.
ffmpeg trims the silence at both ends and encodes 24 kHz mono Opus.
"""
from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

VOICE = "af_heart"  # Kokoro's most natural English voice
SPEED = 1.05        # a touch brisk, like a car's assistant


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)

    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    lines = dict(l.split("\t", 1) for l in args.lines.read_text(encoding="utf-8").splitlines() if "\t" in l)
    args.out.mkdir(parents=True, exist_ok=True)
    for old in args.out.glob("*.ogg"):
        if old.stem not in lines:
            old.unlink()
            print("removed", old.name)
    todo = {k: t for k, t in lines.items() if args.force or not (args.out / f"{k}.ogg").is_file()}
    if not todo:
        print("all", len(lines), "clips present")
        return 0
    pipe = KPipeline(lang_code="a")  # American English G2P
    with tempfile.TemporaryDirectory() as tmp:
        for i, (key, text) in enumerate(todo.items(), 1):
            audio = np.concatenate([a for _, _, a in pipe(text, voice=VOICE, speed=SPEED)])
            wav = Path(tmp) / f"{key}.wav"
            sf.write(wav, audio, 24000)
            trim = "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-af", trim, "-ac", "1",
                            "-c:a", "libopus", "-b:a", "32k", "-application", "voip", str(args.out / f"{key}.ogg")], check=True)
            print(f"{i}/{len(todo)}", key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
