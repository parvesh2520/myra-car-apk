"""Synthetic speech for the "Okay Myra" wake-word model (Kokoro-82M, every English and Hindi voice plus blends).

Writes clips.npz to --out: 16 kHz int16 clips, trimmed of silence at both ends, so a wake clip ends exactly where
"Myra" ends. Groups: wake (okay/ok/hey Myra), near (sounds-like phrases that must not wake Myra), command (what a
driver says after the wake word), each split by voice into train and test (test voices are never trained on).

    C:\\m\\llmenv\\.venv\\Scripts\\python tools/wake_word/gen_clips.py --out C:\\m\\wake
"""
from __future__ import annotations

import argparse
import random
from pathlib import Path

import numpy as np

EN_VOICES = """af_alloy af_aoede af_bella af_heart af_jessica af_kore af_nicole af_nova af_river af_sarah af_sky
am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck am_santa bf_alice bf_emma bf_isabella bf_lily
bm_daniel bm_fable bm_george bm_lewis ef_dora em_alex ff_siwis if_sara im_nicola pf_dora pm_alex""".split()
HI_VOICES = ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"]
TEST_VOICES = {"af_nova", "am_eric", "bm_lewis", "if_sara", "hm_psi"}

WAKE_EN = ["Okay Myra", "Ok Myra", "Hey Myra", "Okay, Myra", "Hey, Myra", "Okay Myra!", "Hey Myra.", "Okay Myra?",
           "Hey there Myra", "Okay okay Myra"]
WAKE_HI = ["ओके मायरा", "हे मायरा", "ओके, मायरा", "हे, मायरा", "ओके मायरा!"]
NEAR_EN = ["Okay", "Hey", "Okay my", "Hey my", "Okay Meera", "Hey Meera", "Okay Mira", "Hey Maya", "Okay Maya",
           "Hey Mara", "Okay Maria", "Hey Moira", "Okay mirror", "Hey Myron", "Okay my ride", "Hey my rear seat",
           "Okay my phone is dead", "Hey, my radio is loud", "Okay, I'm ready", "Okay Mike", "Hey Mike", "Hey man",
           "Okay mama", "Hey Siri", "Okay Google", "Alexa", "Hey Jarvis", "Okay Myron", "Okay, hire a cab",
           "Okay, fire away", "Hey Ira", "Okay Kyra", "Hey Tyra", "Okay Lyra", "Hey Sara", "Okay Mehra",
           "Hey Mehar", "Okay, Mumbai", "My right mirror", "Mira Road station", "Hey, my rasta", "Okay, my rate",
           "Hey, may I", "Okay, my error", "Myra"]
NEAR_HI = ["ओके मेरा फोन", "हे मेरा नाम", "मेरा नाम मीरा है", "ओके मीरा", "हे माया", "अरे मीरा", "ओके मेरी गाड़ी",
           "हमारा घर", "तुम्हारा फोन", "ओके मायके", "हे मार", "अच्छा मेरा", "ठीक है मेरा", "मीरा रोड", "ओके माई",
           "हे मायूस", "ओके, मैं रास्ता", "मेहरा जी"]
COMMAND_EN = ["turn on the AC", "set the temperature to twenty two", "play some music", "next song",
              "I feel tired", "take me to Phoenix Mall", "turn up the volume", "change the ambient light to pink",
              "it's too hot in here", "pause the music", "call mom", "what's the weather", "set the fan to three",
              "turn off the AC", "play something calm", "chill mode", "navigate home", "lower the seat",
              "increase the fan speed", "open the sunroof", "I am very tired", "volume down", "play Arijit Singh",
              "set the AC to twenty", "make it cooler", "previous track", "stop", "find a petrol pump nearby"]
COMMAND_HI = ["एसी चालू करो", "गाना बजाओ", "तापमान बाईस करो", "आवाज़ बढ़ाओ", "अगला गाना", "मुझे घर ले चलो",
              "बहुत गर्मी है", "एसी बंद करो", "पंखा तेज़ करो", "म्यूज़िक रोको"]


def trim(x: np.ndarray) -> np.ndarray:
    """Cuts leading and trailing silence: 10 ms frames under -40 dB of the clip's loudest frame."""
    f = x[: len(x) // 160 * 160].reshape(-1, 160)
    e = 10 * np.log10((f.astype(np.float64) ** 2).mean(1) + 1e-9)
    loud = np.nonzero(e > e.max() - 40)[0]
    return x[loud[0] * 160: (loud[-1] + 1) * 160]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--wake-per-voice", type=int, default=90)
    ap.add_argument("--near-per-voice", type=int, default=70)
    ap.add_argument("--command-per-voice", type=int, default=30)
    args = ap.parse_args(argv)

    import torch
    from kokoro import KPipeline
    from scipy.signal import resample_poly

    rng = random.Random(7)
    torch.manual_seed(7)
    pipes = {"a": KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device="cuda"),
             "h": KPipeline(lang_code="h", repo_id="hexgrad/Kokoro-82M", device="cuda")}
    voices = {v: pipes["a"].load_voice(v) for v in EN_VOICES + HI_VOICES}

    def say(text: str, voice: str, lang: str) -> np.ndarray:
        pack = voices[voice]
        pool = [v for v in voices if (v in TEST_VOICES) == (voice in TEST_VOICES) and v != voice]
        if rng.random() < 0.6:  # a new speaker between two voices of the same split
            w = rng.uniform(0.1, 0.5)
            pack = (1 - w) * pack + w * voices[rng.choice(pool)]
        audio = np.concatenate([r.audio.cpu().numpy() for r in pipes[lang](text, voice=pack, speed=rng.uniform(0.8, 1.25))])
        x = resample_poly(audio, 2, 3)
        return trim((np.clip(x, -1, 1) * 32767).astype(np.int16))

    out = {}
    for group, en, hi, n in (("wake", WAKE_EN, WAKE_HI, args.wake_per_voice), ("near", NEAR_EN, NEAR_HI, args.near_per_voice),
                             ("command", COMMAND_EN, COMMAND_HI, args.command_per_voice)):
        for split in ("train", "test"):
            clips = []
            for voice in EN_VOICES + HI_VOICES:
                if (voice in TEST_VOICES) != (split == "test"):
                    continue
                for _ in range(n):
                    if voice in HI_VOICES and rng.random() < 0.6:
                        clips.append(say(rng.choice(hi), voice, "h"))
                    else:
                        clips.append(say(rng.choice(en), voice, "a"))
            out[f"{group}_{split}"] = np.array(clips, dtype=object)
            print(group, split, len(clips), flush=True)
    args.out.mkdir(parents=True, exist_ok=True)
    np.savez(args.out / "clips.npz", **out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
