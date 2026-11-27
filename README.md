# MYRA car app (Android APK)

For the native 32-bit head-unit build and the phone-camera drowsiness demo, see [the Android car guide](android-car/README.md).

MYRA running inside the car's Android head unit. The screen is the MYRA UI. The car's command model (a Gemma 3 270M
fine-tuned on the cockpit's commands) runs on the head unit itself. Speech recognition and translation run in the
cloud (Sarvam, through the Render backend): whatever language or mix the driver speaks, the car's model receives English.

```
 Car head unit (APK: app/)
 ├─ WebView: MYRA UI (web/, bundled into the APK)
 │    mic → POST {Render}/api/transcribe ──► Render backend ──► Sarvam Saaras, translate mode
 │    English transcript ──► native layer                      (any of 22 languages or a mix → English)
 ├─ Cockpit Gemma 270M, 8-bit GGUF (inside the APK), llama.cpp (llama.rn), on-device
 │    English transcript → cockpit commands (JSON, checked against the backend's command schema)
 │    commands ──► MYRA UI: runs them and shows "Heard by …. Car understood on-device (…): …"
 └─ POST {Render}/api/device/log  ──► printed in the Render log as  [CAR] heard '…' -> [...]
                                     and listed at GET {Render}/api/device/log
```

| Folder | What it is |
| --- | --- |
| `web/` | Copy of `Myra UI/MYRA-Infotainment-Simulator/frontend`. Changed files: `src/services/carModel.ts` (new), `src/context/AssistantContext.tsx` and `src/services/api.ts` (on-device path, translate-mode transcription, car log), `vite.config.ts`, `package.json`, `.env.car` (car build) |
| `backend/` | Copy of `Hyundai-COE-Project/backend`, without `.env`, virtual environments or the 6 GB of local models (Render runs cloud mode). Additions: `bhashadrive/device/` (car log), `bhashadrive/training/translate_command_data.py` (English training data), `--english` in `training/train_command_llm.py`, `scripts/export_car_model_spec.py`, `tests/test_device.py` |
| `app/` | Expo (SDK 58) Android app: `App.tsx` (WebView + bridge), `src/gemma.ts` (on-device model), `src/commands.json` (generated command schema), `plugins/withMyraWebUI.js` and `plugins/withCockpitModel.js` (put `web-dist/` and `models/*.gguf` into the APK) |
| `render.yaml` | Render blueprint for `backend/` |

The original folders were not changed.

## 1. Deploy the backend on Render

1. Push this folder to a GitHub repository.
2. In Render, choose **New → Blueprint**, then pick the repository. Render reads `render.yaml`.
3. Set these environment variables:
   - `SARVAM_API_KEY`: cloud speech recognition and translation (required).
   - `GROQ_API_KEY` (or `OPENAI_API_KEY`): required. The voice tier reports "not configured" without an LLM key, even though the car app does not use the cloud LLM to understand commands.
4. After the deploy, open `https://<service>.onrender.com/api/health`. It must answer with JSON.

On the free plan, Render puts the service to sleep after 15 minutes without traffic. The first request after that takes about a minute. Open `/api/health` before you record.

## 2. Command model

The car's model is `app/models/cockpit-gemma-270m-en.q8_0.gguf` (about 290 MB; not in git, too large for GitHub).
To rebuild it (NVIDIA GPU with 6 GB, the backend's training environment, and Hugging Face access to `google/gemma-3-270m-it`):

```bash
cd backend
GROQ_API_KEY=... python -m bhashadrive.training.translate_command_data     # data/command_llm/*_en.jsonl
python -m bhashadrive.training.train_command_llm --english --name cockpit-gemma-270m-en \
    --convert-script <llama.cpp>/convert_hf_to_gguf.py                       # models/llm/cockpit-gemma-270m-en.q8_0.gguf
BD_CMD_LLM_PATH=models/llm/cockpit-gemma-270m-en.q8_0.gguf python -m bhashadrive.evaluation.eval_command_llm --test test_en --report command_llm_eval_en
cp models/llm/cockpit-gemma-270m-en.q8_0.gguf ../app/models/
```

## 3. Build the MYRA UI for the car

```bash
cd web
# put the Render URL in .env.car:  VITE_API_URL=https://<service>.onrender.com/api
npm install
npm run build:car        # writes app/web-dist/
```

Run this again whenever you change `web/` or `.env.car`.

## 4. Build the APK

```bash
cd app
npm install
npx expo prebuild -p android
cd android && ./gradlew assembleRelease     # android/app/build/outputs/apk/release/app-release.apk
```

On Windows, build from a short path without spaces (for example a copy at `C:\m\app`), point the Android SDK at
a drive letter (`subst N: "%LOCALAPPDATA%\Android\Sdk"`, `sdk.dir=N\:\\` in `android/local.properties`) and put a real
Python (not the Microsoft Store alias) first on `PATH`: llama.rn's native build fails on long paths, spaces and the alias.

Install it on the car: `adb install app-release.apk`, or copy the file to a USB stick and open it on the head unit.

## 5. First launch in the car

- Allow the microphone (and the camera, for the drowsiness and safe-exit features).
- The model is inside the APK: on first launch the app copies it to its own storage (a few seconds). The bottom-right badge then shows `Cockpit Gemma 270M · on-device · ready`.
- The car must be online for speech recognition (Sarvam).
- Speak a command, in any language. The chat shows the English transcript, MYRA's reply, and a note such as
  `Heard by sarvam:saaras:v4:translate. Car understood on-device (Cockpit Gemma 270M (on-device), 300 ms): climate.setTemp value=22.`
- The same entry appears in the Render log (Dashboard → Logs) and at `https://<service>.onrender.com/api/device/log`.

## Head unit requirements

- 64-bit ARM (`adb shell getprop ro.product.cpu.abi` must print `arm64-v8a`). The APK is built for arm64 only.
- About 600 MB of free RAM for the app and model, and 700 MB of free storage.
- Android 7 or newer, with an up-to-date Android System WebView (the MYRA UI uses modern JavaScript).

## Keeping the command list in sync

`app/src/commands.json` is generated from `backend/bhashadrive/nlu/cockpit_commands.py`. After you change the command list, run:

```bash
cd backend && python scripts/export_car_model_spec.py
```
