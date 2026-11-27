# Myra on a low-end Android head unit

Use the 32-bit APK for the existing `armeabi-v7a` head unit. Use the 64-bit APK on an `arm64-v8a` Android phone. Open **MYRA** on the car and **Myra Phone Camera** on the phone. On a device with a camera, **Phone cam** also opens the sender from the MYRA sidebar.

The standalone **Myra Camera Sender** app goes straight to **Start phone camera** from its own launcher icon. Build it from `android-car` with `.\gradlew.bat -PcameraSender=true assembleRelease` and install `app/build/outputs/apk/release/app-release.apk` on the phone.

## Parked USB demo

1. Connect the Android phone to the car’s USB-A port with a data-capable cable. On the phone, enable **USB tethering** in Hotspot & tethering. Turn off the head unit’s Wi-Fi for this check so that the camera link uses the cable.
2. On the phone, open **Myra Phone Camera**, choose **Front camera · Drowsiness meter**, and tap **Start phone camera**. Grant camera access and keep the screen visible. The sender displays its local IP address and eight-digit camera code.
3. On the car, open **MYRA → Alertness**. Enter the phone IP and camera code and tap **Start**. Include the port if shown. Aim the front camera at your face. While parked, close your eyes for about two seconds to demonstrate the prolonged-closure alert and reopen them to check that it clears.
4. For Safe Exit, stop sharing, choose **Rear camera · Safe Exit**, then start sharing again. In **MYRA → Safe Exit**, enter the new code and select the left or right zone in the image. With the car parked, point the phone at the area beside the door. Move into the outlined area or walk toward it from the edge of the preview to demonstrate the warning and chime.
5. Tap **Myra** to return to the assistant. Tap **Stop sharing** on the phone to close its camera.

The car’s USB port must work as a USB host and its Android firmware must support USB tethering. If USB tethering stays disabled or the meter cannot reach the phone, start a password-protected Wi-Fi hotspot on the phone, join it from the car, and repeat with the address now shown on the phone. Use a trusted local connection. The pairing code controls access, and frames travel unencrypted on that link.

The phone sends up to 24 JPEG frames per second over one TCP connection, using a camera resolution near the size the detectors need. The car decodes each usable frame for preview and keeps only the newest frame waiting for analysis to avoid delayed warnings. The car displays **Video received**, model analysis FPS and time, and separate counts for frames replaced in the analysis backlog and unusable video frames. Each mode uses one camera stream, and switching modes releases the previous model.

After **Start**, the car distinguishes pairing from receipt of live video. If the feed stalls, MYRA clears the old result and reconnects. If pairing is rejected, enter the code from the currently open phone camera screen. For a refused connection or timeout, check the phone IP, any displayed port, and whether the car is on the hotspot or USB tether. The phone shows **Waiting for the car to pair** before a car connects and reports its sending rate once video is delivered.

Alertness runs the existing ONNX face detector, mesh, and blendshape models. It reuses input tensors and runs with XNNPACK when supported by the head unit. Safe Exit uses quantized SSD MobileNet v1 from [Google's TensorFlow Lite task library](https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/object_detection/android/lite-model_ssd_mobilenet_v1_1_metadata_2.tflite). The model is bundled as `models/safe_exit_ssd_mobilenet.tflite` (SHA-256 `cbdecd08b44c5dea3821f77c5468e2936ecfbf43cde0795a2729fdb43401e58b`). It tracks people, bicycles, motorcycles, cars, buses, and trucks. A short projection in the camera image can trigger the warning ahead of zone entry. Both modes process video locally and store no frames.

Use these camera-based estimates for parked demonstrations. The outlined door zone is in the camera image and has no physical distance calibration.

## Voice ID

**MYRA → Voice ID** recognises the driver by voice, fully on the car. Type a name and record about three samples of the shown sentence, then tap **Who is speaking?** and talk. It uses the backend's driver-recognition model unchanged (`models/campplus_sv_zh_en_16k.onnx`, 3D-Speaker CAM++, fp32) and the backend's rules: silent 30 ms frames dropped, at least 1.5 s of speech to enroll and 0.6 s to identify, cosine score ≥ 0.35 with a lead of ≥ 0.04 over the next voice, at most 6 samples per driver. `Fbank.kt` reproduces sherpa-onnx's Kaldi features (checked against sherpa's own frames: max difference 1.5e-4). Only the embeddings are stored, in the app's private `voiceprints.json`, and **Forget** deletes them. Like the meter, opening Voice ID first releases Myra AI's model and microphone. Leaving the tab closes the voice model.

The backend's sherpa-onnx build (ONNX Runtime 1.28) divides CAM++'s last, partial segment pooling window by its full length (100) instead of the frames actually present, as PyTorch does. ONNX Runtime 1.31 and later, including the app's 1.32, follow PyTorch. So app embeddings differ slightly from the backend's (cosine about 0.97 to 0.999), and voiceprints cannot be copied between them. Enroll on the car.

After saving a voice sample, open **Cabin settings** on that driver's profile in **Voice ID**. Set AC power, temperature, fan speed, ambient color, and seat height, then tap **Save**. Each profile keeps its own settings.

For the presentation, return to **Myra** and speak a full command. The first matching voice in each app session restores that driver's settings in the cockpit display. Myra announces the match, then carries out the command. Cabin changes made by voice are also saved for the active driver.

Try “set the AC to 21 and set fan speed to four,” “set my seat height to two,” or “change the ambient light to pink.” Tap **Ambient light** in Myra's cabin controls to see the palette.

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

Say “play some calm music,” “play energetic music,” “play focus music,” or “play chill music” for the four bundled tracks. Each track also works by title. For example, say “play Quiet Roads.” Once a bundled track is active, play, pause, next and previous control the bundled player. Otherwise, those commands send Android media keys to the active player, including the head unit's Bluetooth music app. Volume commands set the head unit's music volume.

To save music and lighting together, say “Whenever I say evening drive, play some calm music and change the ambient light to pink.” Then say “evening drive,” or tap **Run** in **Shortcuts**.

Shortcut phrases also match similar wording on the car. After saving “I am very tired,” try “I’m really tired” or “I feel exhausted.” Exact saved phrases take priority, and MYRA asks for the exact name when two shortcuts score too closely. The sentence similarity model is the [Apache-licensed all-MiniLM-L6-v2 quantized export](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/blob/d83dd37/onnx/model_qint8_arm64.onnx), bundled as `models/shortcut_minilm.int8.onnx`.

## Cabin follow-up questions

Say “The temperature is high.” MYRA asks “Should I lower the temperature?” Say “Yes” or tap **Yes** to lower it one degree. Say “No” to leave it as it is. “Set the temperature” asks for a value, such as “twenty one degrees.” For two close predictions, choose one of the named options. A new command replaces a pending question, which expires after 30 seconds.

MYRA uses MiniLM's top two command scores for close calls. A separate, lightweight classifier trained on the bundled sentence encoder recognizes indirect observations about temperature, fan speed, and volume. The head can be retrained from `backend` with `python -m bhashadrive.training.train_cabin_clarifications` using NumPy and ONNX Runtime.
