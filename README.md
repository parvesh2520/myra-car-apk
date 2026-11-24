# MYRA car app (Android APK)

MYRA running inside the car's Android head unit. The screen is the MYRA UI. The car's language model (Gemma 3 1B)
runs on the head unit itself. Speech recognition runs in the cloud (Sarvam, through the Render backend).

```
 Car head unit (APK: app/)
 ├─ WebView: MYRA UI (web/, bundled into the APK)
 │    mic → POST {Render}/api/assistant/transcribe ──► Render backend ──► Sarvam Saaras (cloud ASR)
 │    transcript ──► native layer
 ├─ Gemma 3 1B, Q4_K_M GGUF, llama.cpp (llama.rn), on-device
 │    transcript → cockpit commands (JSON constrained to the backend's command schema)
 │    commands ──► MYRA UI: runs them and shows "Car understood on-device (…): …"
 └─ POST {Render}/api/device/log  ──► printed in the Render log as  [CAR] heard '…' -> [...]
                                     and listed at GET {Render}/api/device/log
```

| Folder | What it is |
| --- | --- |
| `web/` | Copy of `Myra UI/MYRA-Infotainment-Simulator/frontend`. Changed files: `src/services/carModel.ts` (new), `src/context/AssistantContext.tsx` and `src/services/api.ts` (on-device path and car log), `vite.config.ts`, `package.json`, `.env.car` (car build) |
| `backend/` | Copy of `Hyundai-COE-Project/backend`, without `.env`, virtual environments or the 6 GB of local models (Render runs cloud mode). Additions: `bhashadrive/device/` (car log), `scripts/export_car_model_spec.py`, `tests/test_device.py` |
| `app/` | Expo (SDK 58) Android app: `App.tsx` (WebView + bridge), `src/gemma.ts` (on-device model), `src/commands.json` (generated command schema), `plugins/withMyraWebUI.js` (puts `web-dist/` into the APK) |
| `render.yaml` | Render blueprint for `backend/` |

The original folders were not changed.

## 1. Deploy the backend on Render

1. Push this folder to a GitHub repository.
2. In Render, choose **New → Blueprint**, then pick the repository. Render reads `render.yaml`.
3. Set these environment variables:
   - `SARVAM_API_KEY`: cloud speech recognition (required).
   - `GROQ_API_KEY` (or `OPENAI_API_KEY`): required. The voice tier reports "not configured" without an LLM key, even though the car app does not use the cloud LLM to understand commands.
4. After the deploy, open `https://<service>.onrender.com/api/health`. It must answer with JSON.

On the free plan, Render puts the service to sleep after 15 minutes without traffic. The first request after that takes about a minute. Open `/api/health` before you record.

## 2. Build the MYRA UI for the car

```bash
cd web
# put the Render URL in .env.car:  VITE_API_URL=https://<service>.onrender.com/api
npm install
npm run build:car        # writes app/web-dist/
```

Run this again whenever you change `web/` or `.env.car`.

## 3. Build the APK (remaining step)

```bash
cd app
npm install
npx eas-cli login
EAS_NO_VCS=1 npx eas-cli build -p android --profile car     # cloud build; downloads an .apk
```

`EAS_NO_VCS=1` is needed only when `app/` is not inside a git repository. If you build locally (Android SDK + JDK 17), run `npx expo prebuild -p android` and then `cd android && ./gradlew assembleRelease`.

Install it on the car: `adb install app-release.apk`, or copy the file to a USB stick and open it on the head unit.

## 4. First launch in the car

- Allow the microphone (and the camera, for the drowsiness and safe-exit features).
- The car must be online. On first launch the app downloads Gemma 3 1B (806 MB) into its own storage. The bottom-right badge shows the progress, then `Gemma 3 1B · on-device · ready`.
- Speak a command. The chat shows the transcript, MYRA's reply, and a note such as
  `Car understood on-device (Gemma 3 1B (on-device), 900 ms): climate.setTemp value=22.`
- The same entry appears in the Render log (Dashboard → Logs) and at `https://<service>.onrender.com/api/device/log`.

## Head unit requirements

- 64-bit ARM (`adb shell getprop ro.product.cpu.abi` must print `arm64-v8a`). The APK is built for arm64 only.
- About 1.5 GB of free RAM for the model, and 1 GB of free storage.
- Android 7 or newer, with an up-to-date Android System WebView (the MYRA UI uses modern JavaScript).

## Keeping the model's command list in sync

`app/src/commands.json` is generated from `backend/bhashadrive/nlu/cockpit_commands.py`. After you change the command list, run:

```bash
cd backend && python scripts/export_car_model_spec.py
```
