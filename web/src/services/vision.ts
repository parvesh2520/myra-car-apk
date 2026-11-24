import type { FaceLandmarker, ObjectDetector } from '@mediapipe/tasks-vision';
// The Wasm runtime is bundled with the app (served from our own origin, works offline).
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

/** Official MediaPipe model files, downloaded once by the browser and then cached. */
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const OBJECT_MODEL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite';

/** Road users the safe exit camera reacts to. */
export const ROAD_USERS = ['person', 'bicycle', 'motorcycle', 'car', 'bus', 'truck'];

const fileset = { wasmLoaderPath, wasmBinaryPath };
const vision = () => import('@mediapipe/tasks-vision'); // loaded only when a camera feature starts
const LOAD_TIMEOUT_MS = 60_000;

/** Rejects if `p` takes too long, so a stalled download shows an error instead of spinning forever. */
function timeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} took too long to load — check the internet connection and try again.`)), LOAD_TIMEOUT_MS))]);
}

/** Downloads a model once; the bytes are reused for the GPU attempt and the CPU fallback. */
async function fetchModel(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the AI model (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Try the GPU first; fall back to CPU where WebGL is unavailable. */
async function withDelegate<T>(create: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await create('GPU');
  } catch {
    return create('CPU');
  }
}

/** Memoises a loader; a failed load is forgotten so the user can retry. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () =>
    (p ??= load().catch((e) => {
      p = null;
      throw e;
    }));
}

export const loadFaceLandmarker = once<FaceLandmarker>(async () => {
  const [{ FaceLandmarker }, model] = await timeout(Promise.all([vision(), fetchModel(FACE_MODEL)]), 'The face model');
  return timeout(withDelegate((delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model.slice(), delegate }, // a copy: the runtime may take ownership of the buffer
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    }),
  ), 'The face model');
});

export const loadObjectDetector = once<ObjectDetector>(async () => {
  const [{ ObjectDetector }, model] = await timeout(Promise.all([vision(), fetchModel(OBJECT_MODEL)]), 'The object detection model');
  // CPU only: this int8 model returns no detections on the GPU delegate.
  return timeout(
    ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model, delegate: 'CPU' },
      runningMode: 'VIDEO',
      scoreThreshold: 0.45,
      maxResults: 8,
      categoryAllowlist: ROAD_USERS,
    }),
    'The object detection model',
  );
});

/** Opens a camera stream, with a readable error for the common failure cases. */
export async function openCamera(facingMode: 'user' | 'environment'): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access needs a secure page (https or localhost).');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError') throw new Error('Camera permission was denied. Allow it in the browser’s address bar.');
    if (name === 'NotFoundError') throw new Error('No camera was found on this device.');
    if (name === 'NotReadableError') throw new Error('The camera is in use by another app.');
    throw e;
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * Calls `onFrame` for each new video frame, at most `fps` times a second
 * (kept low for constrained hardware). Returns a cancel function.
 */
export function runFrameLoop(video: HTMLVideoElement, onFrame: (now: number) => void, fps = 15): () => void {
  let raf = 0;
  let last = -1;
  let lastTime = -1;
  const minGap = 1000 / fps;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (video.readyState < 2 || video.currentTime === lastTime || now - last < minGap) return;
    last = now;
    lastTime = video.currentTime;
    onFrame(now);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** Short alert tone through Web Audio (no sound files needed). */
let audio: AudioContext | null = null;
export function beep(freq = 880, ms = 220, volume = 0.25) {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + ms / 1000);
  } catch {
    /* audio unavailable — the visual alert still shows */
  }
}
