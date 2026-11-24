import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { useActions, useAppState } from './AppStore';
import { beep, loadFaceLandmarker, openCamera, runFrameLoop, stopStream } from '../services/vision';
import { DrowsinessTracker, INITIAL_METRICS, type DrowsinessLevel, type DrowsinessMetrics } from '../services/drowsiness';

type Status = 'off' | 'loading' | 'on' | 'error';

interface DriverMonitor {
  status: Status;
  error: string | null;
  metrics: DrowsinessMetrics;
  /** Live camera stream, for on-screen previews. */
  stream: MediaStream | null;
  /** Latest face landmarks (normalised), read by the preview overlay each frame. */
  landmarks: React.RefObject<NormalizedLandmark[] | null>;
  start: () => Promise<void>;
  stop: () => void;
}

const Ctx = createContext<DriverMonitor | null>(null);

const TOASTS: Partial<Record<DrowsinessLevel, string>> = {
  asleep: 'Wake up! Your eyes have been closed — pull over safely',
  drowsy: 'Drowsiness detected — take a break at the next safe stop',
  noFace: 'Driver not visible — keep your eyes on the road',
};

/**
 * Camera-based driver drowsiness monitor. Lives above the pages so it keeps
 * watching (and alerting) while the driver uses navigation, media and so on.
 */
export function DriverMonitorProvider({ children }: { children: ReactNode }) {
  const actions = useActions();
  const { vehicle } = useAppState();
  const [status, setStatus] = useState<Status>('off');
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DrowsinessMetrics>(INITIAL_METRICS);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const landmarks = useRef<NormalizedLandmark[] | null>(null);
  const session = useRef<{ stream: MediaStream; cancel: () => void } | null>(null);
  const runId = useRef(0);

  const stop = useCallback(() => {
    runId.current++;
    session.current?.cancel();
    stopStream(session.current?.stream ?? null);
    session.current = null;
    landmarks.current = null;
    setStream(null);
    setMetrics(INITIAL_METRICS);
    setStatus('off');
  }, []);

  const start = useCallback(async () => {
    if (session.current) return;
    const id = ++runId.current;
    setError(null);
    setStatus('loading');
    let cam: MediaStream | null = null;
    try {
      cam = await openCamera('user');
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = cam;
      await video.play();
      const model = await loadFaceLandmarker();
      if (id !== runId.current) return stopStream(cam); // stopped while loading

      const tracker = new DrowsinessTracker();
      let lastLevel: DrowsinessLevel = 'alert';
      let lastPublish = 0;
      let lastBeep = 0;
      const cancel = runFrameLoop(video, (now) => {
        const res = model.detectForVideo(video, now);
        const face = res.faceLandmarks[0] ?? null;
        const shapes = res.faceBlendshapes[0]?.categories ?? [];
        const score = (name: string) => shapes.find((c) => c.categoryName === name)?.score ?? 0;
        landmarks.current = face;
        const m = tracker.update({
          t: now,
          face: !!face,
          eyeClosed: (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2,
          jawOpen: score('jawOpen'),
        });

        // Audible alarm: continuous while asleep, periodic while drowsy.
        const beepEvery = m.level === 'asleep' ? 450 : m.level === 'drowsy' ? 4000 : 0;
        if (beepEvery && now - lastBeep > beepEvery) {
          beep(m.level === 'asleep' ? 1050 : 660, 280, m.level === 'asleep' ? 0.35 : 0.25);
          lastBeep = now;
        }

        if (m.level !== lastLevel) {
          const text = TOASTS[m.level];
          if (text) actions.ui.toast(text, 'warning');
          lastLevel = m.level;
        }
        if (now - lastPublish > 150 || m.level === 'asleep') {
          lastPublish = now;
          setMetrics(m);
        }
      });
      session.current = { stream: cam, cancel };
      setStream(cam);
      setStatus('on');
    } catch (e) {
      stopStream(cam);
      if (id !== runId.current) return;
      setError(e instanceof Error ? e.message : 'Could not start the driver camera.');
      setStatus('error');
    }
  }, [actions]);

  // Turning the driver attention monitor off in Vehicle settings stops the camera.
  useEffect(() => {
    if (!vehicle.adas.driverMonitoring) stop();
  }, [vehicle.adas.driverMonitoring, stop]);

  useEffect(() => stop, [stop]);

  const value = useMemo(() => ({ status, error, metrics, stream, landmarks, start, stop }), [status, error, metrics, stream, start, stop]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDriverMonitor(): DriverMonitor {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDriverMonitor must be used inside DriverMonitorProvider');
  return v;
}
