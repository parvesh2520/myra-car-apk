# Myra on a low-end Android head unit

Use the 32-bit APK for the existing `armeabi-v7a` head unit. Use the 64-bit APK on an `arm64-v8a` Android phone. Open **MYRA** on the car and **Myra Phone Camera** on the phone. On a phone with a front camera, MYRA also has an **Open phone camera** button in the left sidebar.

The standalone **Myra Camera Sender** app goes straight to **Start phone camera** from its own launcher icon. Build it from `android-car` with `.\gradlew.bat -PcameraSender=true assembleRelease` and install `app/build/outputs/apk/release/app-release.apk` on the phone.

## Parked USB demo

1. Connect the Android phone to the car’s USB-A port with a data-capable cable. On the phone, enable **USB tethering** in Hotspot & tethering. Turn off the head unit’s Wi-Fi for this check so that the camera link uses the cable.
2. On the phone, open **Myra Phone Camera**, tap **Start phone camera**, and grant camera access. Keep that screen visible and aim the front camera at your face. The app shows the phone’s local IPv4 address and an eight-digit camera code. If it lists several addresses, try the first one, then the others.
3. On the car, open **MYRA → Drowsiness meter**. Enter the phone IP and camera code and tap **Start meter**. Include the port if the phone shows one after the IP. When the preview appears, look at the phone camera. While parked, close your eyes for about two seconds to demonstrate the prolonged-closure alert. Reopen your eyes and check that the live readings recover.
4. Tap **Myra AI** to stop analysis and reload the assistant. Tap **Stop sharing** on the phone to close its camera and end the sharing session.

The car’s USB port must work as a USB host and its Android firmware must support USB tethering. If USB tethering stays disabled or the meter cannot reach the phone, start a password-protected Wi-Fi hotspot on the phone, join it from the car, and repeat with the address now shown on the phone. Use a trusted local connection. The pairing code controls access, and frames travel unencrypted on that link.

The phone captures its front camera at 30 fps (640×480) and pushes 24 of those frames a second (`SEND_FPS`) as JPEG over one TCP connection, about 0.8 MB/s, well within a phone hotspot or USB tethering. The car shows each frame as it arrives. Face analysis runs on its own thread on the newest frame whenever it is free, so the video never waits for it, and the drowsiness tracker uses the phone's capture times. The screen shows the received video rate and the face-analysis rate and time per frame. The head unit runs Google's MediaPipe Face Landmarker models (face detector, 478-point face mesh, blendshapes), converted to ONNX, on ONNX Runtime, the same runtime Myra AI uses. It does not use the MediaPipe library, which failed to load on the head unit. The eye-blink and jaw-open scores feed the existing Myra drowsiness tracker. The meter checks the phone feed first and displays a separate message, with the cause, if face analysis fails on the car. The monitor stores no video or images and can run without internet once the devices can reach each other. Myra AI still uses the internet for speech recognition. Selecting the meter closes the assistant’s ONNX session and microphone and cancels its network work before loading the meter. Selecting Myra AI closes the meter and its face models before loading the assistant model again.

This is a parked demonstration of camera-based estimates. The prototype has not been validated as a driving safety system.

## Voice ID

**MYRA → Voice ID** recognises the driver by voice, fully on the car. Type a name and record about three samples of the shown sentence, then tap **Who is speaking?** and talk. It uses the backend's driver-recognition model unchanged (`models/campplus_sv_zh_en_16k.onnx`, 3D-Speaker CAM++, fp32) and the backend's rules: silent 30 ms frames dropped, at least 1.5 s of speech to enroll and 0.6 s to identify, cosine score ≥ 0.35 with a lead of ≥ 0.04 over the next voice, at most 6 samples per driver. `Fbank.kt` reproduces sherpa-onnx's Kaldi features (checked against sherpa's own frames: max difference 1.5e-4). Only the embeddings are stored, in the app's private `voiceprints.json`, and **Forget** deletes them. Like the meter, opening Voice ID first releases Myra AI's model and microphone. Leaving the tab closes the voice model.

The backend's sherpa-onnx build (ONNX Runtime 1.28) divides CAM++'s last, partial segment pooling window by its full length (100) instead of the frames actually present, as PyTorch does. ONNX Runtime 1.31 and later, including the app's 1.32, follow PyTorch. So app embeddings differ slightly from the backend's (cosine about 0.97 to 0.999), and voiceprints cannot be copied between them. Enroll on the car.

## Build

`android-car/models/` holds the three face models as ONNX. They come from Google's `face_landmarker.task` (SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`), a zip of `.tflite` files, converted with `python -m tf2onnx.convert --tflite <name>.tflite --output <name>.onnx --opset 13`. The build packages the face models into the car APKs. The meter screen is native; it no longer uses a WebView.

```powershell
Set-Location web
npm ci
Set-Location ../android-car
.\gradlew.bat assembleRelease
```

Outputs are in `android-car/app/build/outputs/apk/release/`. The demo APKs use the existing Myra package ID and demo signing key.

## Music and volume

Play, pause, next and previous send Android media keys to the active player. When a phone is connected over Bluetooth, the head unit's Bluetooth music app forwards them to the phone. Volume commands set the head unit's music volume and show its volume bar.
