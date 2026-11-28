# "Okay Myra" wake word

The car runs openWakeWord's frozen speech features plus a small Myra model trained here, and Silero VAD for
end-of-speech (`app/src/main/java/com/myra/car/HandsFree.kt`). `features.py` is the reference for the car's
streaming math and trim; `HandsFree.kt` mirrors it.

Retrain (RTX 4050, Python env `C:\m\llmenv\.venv` with kokoro, torch CUDA, onnxruntime, scipy;
set `VIRTUAL_ENV=C:\m\llmenv\.venv` once so Kokoro can install its spaCy model):

1. Download from openWakeWord v0.5.1 releases `melspectrogram.onnx`, `embedding_model.onnx`, and from the Hugging
   Face dataset `davidscripka/openwakeword_features` `validation_set_features.npy` and (any leading part of)
   `openwakeword_features_ACAV100M_2000_hrs_16bit.npy`, into `C:\m\oww`.
2. `python tools/wake_word/gen_clips.py --out C:\m\wake` (synthetic voices; ~20 min)
3. `python tools/wake_word/train_wake.py --clips C:\m\wake\clips.npz --oww C:\m\oww --acav C:\m\oww\acav_part.npy --out C:\m\wake\model`
4. Copy `myra_wake.onnx` and `wake_calibration.json` from the out folder to `models/wake/`.

`wake_calibration.json` holds the threshold and how many chunks in a row must pass it (`consecutive`: 2; lone
one-chunk spikes were most false wakes). The threshold is the highest one within 1 point of the best recall among
those meeting <= 0.5 false wakes per hour on openWakeWord's validation audio, <= 5% on sound-alike phrases and
>= 90% recall; `meets_target` is false (and the log says so) when none does. It also holds where "Myra" ends
relative to the firing chunk (`end_before_fire_min_ms` < 0 means it can still be ending, so the car waits for that
audio before trimming) and the trim's measured accuracy on voices never trained on (`trim.cuts_command` must stay ~0).

`train_wake.py --eval-only` re-evaluates and re-exports a saved `myra_wake.pt` (e.g. after changing the trim in
`features.py`; keep `WakeTrim` in `HandsFree.kt` identical). After a new model: `device_cases.py`, then
`gradlew connectedDebugAndroidTest -Pabis=x86_64` on an emulator (`HandsFreeDeviceTest`: same wake chunk and trim
sample as the PC; `logsTheCostOfOneStep` logs the per-step CPU cost under tag `HandsFreeCost`).

If the targets are missed, in order: more hard-negative mining, more ACAV100M features (same HF file, range
request after the first 6000000128 bytes; float16 (N,16,96) after a 128-byte header), more sound-alike phrases in
`gen_clips.py` (then delete `train_features.npz`). The label windows (`POS_AFTER`, `NEG_BEFORE`, `NEG_AFTER`) trade
recall against how predictably the model fires: 0-160 ms positives gave 87% recall; 0-240 ms gives 90%.
