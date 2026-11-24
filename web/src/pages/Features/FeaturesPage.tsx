import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ObjectDetector } from '@mediapipe/tasks-vision';
import { Camera, CameraOff, DoorOpen, Landmark, Loader, Lock, ScanEye, type LucideIcon } from 'lucide-react';
import { useActions, useAppState } from '../../context/AppStore';
import { useDriverMonitor } from '../../context/DriverMonitorContext';
import { LivePreview } from '../../components/camera/LivePreview';
import { DrivingNotice } from '../../components/cards/DrivingNotice';
import { BharatDetail } from '../Apps/AppsPage';
import { MICROSLEEP_MS, type DrowsinessLevel } from '../../services/drowsiness';
import { CLEAR, DANGER_M, SafeExitTracker, TTC_DANGER_S, type Box, type Risk, type Side, type SideStatus } from '../../services/safeExit';
import { beep, loadObjectDetector, openCamera, runFrameLoop, stopStream } from '../../services/vision';

type Tab = 'drowsiness' | 'safeExit' | 'bharat';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'drowsiness', label: 'Drowsiness meter', icon: ScanEye },
  { id: 'safeExit', label: 'Safe exit assist', icon: DoorOpen },
  { id: 'bharat', label: 'BharatConnect', icon: Landmark },
];

/** MYRA AI hub: camera-based drowsiness meter, safe exit assist and BharatConnect. */
export function FeaturesPage() {
  const { pageSection } = useAppState();
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t.id === pageSection)?.id ?? 'drowsiness');
  const monitor = useDriverMonitor();

  return (
    <div className="h-full p-5 grid grid-cols-[240px_minmax(0,1fr)] gap-4">
      <nav className="card p-2 flex flex-col gap-1 self-start" aria-label="MYRA AI features">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex items-center gap-3 h-14 px-4 rounded-xl text-left transition-colors ${tab === id ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}
          >
            <Icon size={19} aria-hidden />
            <span className="flex-1 font-medium">{label}</span>
            {id === 'drowsiness' && monitor.status === 'on' && <span className="size-2 rounded-full bg-ok" aria-label="Monitoring" />}
          </button>
        ))}
        <p className="px-4 py-3 text-xs text-ink-3">Camera video is analysed on this device and never uploaded.</p>
      </nav>
      <div key={tab} className="anim-fade min-h-0">
        {tab === 'drowsiness' ? <DrowsinessView /> : tab === 'safeExit' ? <SafeExitView /> : <BharatView />}
      </div>
    </div>
  );
}

function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card p-5 h-full flex flex-col gap-4 min-h-0" aria-label={title}>
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function CameraButton({ status, onStart, onStop }: { status: 'off' | 'loading' | 'on' | 'error'; onStart: () => void; onStop: () => void }) {
  if (status === 'on') return <button type="button" className="btn !min-h-10 !text-sm" onClick={onStop}><CameraOff size={16} aria-hidden /> Stop camera</button>;
  if (status === 'loading') return <button type="button" className="btn !min-h-10 !text-sm" disabled><Loader size={16} className="animate-spin" aria-hidden /> Starting…</button>;
  return <button type="button" className="btn btn-primary !min-h-10 !text-sm" onClick={onStart}><Camera size={16} aria-hidden /> Start camera</button>;
}

function Placeholder({ status, error, text }: { status: string; error: string | null; text: string }) {
  return (
    <div className="w-full aspect-[4/3] rounded-2xl card-inset grid place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-2 max-w-sm">
        {status === 'loading' ? <Loader size={28} className="animate-spin text-accent" aria-hidden /> : <Camera size={28} className="text-ink-3" aria-hidden />}
        <p className={`text-sm ${error ? 'text-danger' : 'text-ink-2'}`}>{error ?? (status === 'loading' ? 'Opening camera and loading the AI model…' : text)}</p>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="card-inset p-3">
      <p className="label">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${warn ? 'text-danger' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

/* ---------- Drowsiness meter ---------- */

const LEVELS: Record<DrowsinessLevel, { text: string; colour: string }> = {
  alert: { text: 'Alert', colour: 'var(--color-ok)' },
  tiring: { text: 'Getting tired', colour: 'var(--color-warn)' },
  drowsy: { text: 'Drowsy — take a break', colour: 'var(--color-danger)' },
  asleep: { text: 'WAKE UP!', colour: 'var(--color-danger)' },
  noFace: { text: 'Face not visible', colour: 'var(--color-warn)' },
};
const EYES = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const MOUTH = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];

function DrowsinessView() {
  const { vehicle } = useAppState();
  const actions = useActions();
  const { status, error, metrics: m, stream, landmarks, start, stop } = useDriverMonitor();
  const level = LEVELS[m.level];
  const live = status === 'on';

  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const pts = landmarks.current;
    if (!pts) return;
    const dot = (i: number, colour: string) => {
      const p = pts[i];
      if (!p) return;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc((1 - p.x) * w, p.y * h, 2.2, 0, Math.PI * 2);
      ctx.fill();
    };
    EYES.forEach((i) => dot(i, '#56C69B'));
    MOUTH.forEach((i) => dot(i, '#4D9EFF'));
  }, [landmarks]);

  if (!vehicle.adas.driverMonitoring) {
    return (
      <Panel title="Drowsiness meter">
        <div className="card-inset p-5 flex items-center gap-4">
          <p className="flex-1 text-ink-2">The driver attention monitor is turned off.</p>
          <button type="button" className="btn" onClick={() => actions.vehicle.setAdas('driverMonitoring', true)}>Turn on</button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Drowsiness meter" action={<CameraButton status={status} onStart={start} onStop={stop} />}>
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 min-h-0">
        <div className="flex flex-col gap-2">
          {live && stream ? <LivePreview stream={stream} draw={draw} label="Driver camera" /> : (
            <Placeholder status={status} error={error} text="Point the camera at the driver’s face. MYRA watches eye closure, blinking and yawning in real time." />
          )}
          <p className="text-xs text-ink-3">Monitoring keeps running on other pages; an alarm sounds if your eyes stay closed for {MICROSLEEP_MS / 1000} s.</p>
        </div>
        <div className="flex flex-col gap-3 min-h-0">
          <div className={`card-inset p-4 flex items-center gap-4 ${m.level === 'asleep' ? 'animate-pulse !border-danger' : ''}`}>
            <Gauge value={live ? m.alertness : 0} colour={level.colour} />
            <div className="min-w-0">
              <p className="label">Alertness</p>
              <p className="text-xl font-semibold" style={{ color: live ? level.colour : undefined }}>{live ? level.text : 'Camera off'}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Eye openness" value={live ? `${m.eyeOpenness}%` : '—'} />
            <Stat label="Eyes closed for" value={live ? `${(m.closedMs / 1000).toFixed(1)} s` : '—'} warn={m.closedMs >= MICROSLEEP_MS} />
            <Stat label="PERCLOS (30 s)" value={live ? `${m.perclos}%` : '—'} warn={m.perclos >= 15} />
            <Stat label="Blinks / min" value={live ? String(m.blinksPerMin) : '—'} />
            <Stat label="Yawns (3 min)" value={live ? String(m.yawns) : '—'} warn={m.yawns >= 2} />
            <Stat label="Mouth open" value={live ? `${m.mouthOpen}%` : '—'} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Gauge({ value, colour }: { value: number; colour: string }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 80 80" className="size-20 shrink-0" role="img" aria-label={`Alertness ${value} percent`}>
      <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth="8" />
      <circle cx="40" cy="40" r={r} fill="none" stroke={colour} strokeWidth="8" strokeLinecap="round" transform="rotate(-90 40 40)"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - value / 100)} style={{ transition: 'stroke-dashoffset 0.3s, stroke 0.3s' }} />
      <text x="40" y="46" textAnchor="middle" fill="var(--color-ink)" fontSize="18" fontWeight="600">{value}</text>
    </svg>
  );
}

/* ---------- Safe exit assist ---------- */

const RISK_COLOUR: Record<Risk, string> = { clear: '#56C69B', caution: '#E8B65E', danger: '#EF6F6C' };
const DOORS: { id: string; label: string; side: Side }[] = [
  { id: 'fl', label: 'Front left', side: 'left' },
  { id: 'fr', label: 'Front right', side: 'right' },
  { id: 'rl', label: 'Rear left', side: 'left' },
  { id: 'rr', label: 'Rear right', side: 'right' },
];

function SafeExitView() {
  const { vehicle, driveMode } = useAppState();
  const actions = useActions();
  const [status, setStatus] = useState<'off' | 'loading' | 'on' | 'error'>('off');
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [detector, setDetector] = useState<ObjectDetector | null>(null);
  const [sides, setSides] = useState<Record<Side, SideStatus>>({ left: CLEAR, right: CLEAR });
  const video = useRef<HTMLVideoElement | null>(null);
  const boxes = useRef<Box[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    boxes.current = [];
    setStream(null);
    setSides({ left: CLEAR, right: CLEAR });
    setStatus('off');
  }, []);

  const start = async () => {
    setError(null);
    setStatus('loading');
    try {
      const cam = await openCamera('environment');
      streamRef.current = cam;
      setStream(cam);
      setDetector(await loadObjectDetector());
      setStatus('on');
    } catch (e) {
      stop();
      setError(e instanceof Error ? e.message : 'Could not start the camera.');
      setStatus('error');
    }
  };

  useEffect(() => stop, [stop]); // release the camera when leaving the page

  // Real-time detection loop on the preview video.
  useEffect(() => {
    const v = video.current;
    if (status !== 'on' || !detector || !v) return;
    const tracker = new SafeExitTracker();
    let lastPublish = 0;
    const lastRisk: Record<Side, Risk> = { left: 'clear', right: 'clear' };
    return runFrameLoop(v, (now) => {
      const res = detector.detectForVideo(v, now);
      const out = tracker.update(res.detections, v.videoWidth, v.videoHeight, now);
      boxes.current = out.boxes;
      for (const side of ['left', 'right'] as Side[]) {
        if (out.sides[side].risk === 'danger' && lastRisk[side] !== 'danger') beep(940, 350, 0.3);
        lastRisk[side] = out.sides[side].risk;
      }
      if (now - lastPublish > 150) {
        lastPublish = now;
        setSides(out.sides);
      }
    }, 12);
  }, [status, detector]);

  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 13px system-ui, sans-serif';
    for (const b of boxes.current) {
      const colour = b.distanceM < DANGER_M ? RISK_COLOUR.danger : b.distanceM < 10 ? RISK_COLOUR.caution : RISK_COLOUR.clear;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 3;
      ctx.strokeRect(b.x * w, b.y * h, b.w * w, b.h * h);
      const text = `${b.label} · ${b.distanceM.toFixed(1)} m`;
      const tw = ctx.measureText(text).width + 10;
      ctx.fillStyle = colour;
      ctx.fillRect(b.x * w, Math.max(0, b.y * h - 20), tw, 20);
      ctx.fillStyle = '#0B0F17';
      ctx.fillText(text, b.x * w + 5, Math.max(14, b.y * h - 6));
    }
  }, []);

  const open = (door: (typeof DOORS)[number]) => {
    if (driveMode === 'driving') return actions.ui.toast('Doors stay locked while driving', 'warning');
    const s = sides[door.side];
    if (status === 'on' && s.risk === 'danger') {
      beep(940, 500, 0.35);
      return actions.ui.toast(`Safe exit: ${door.label} door held — ${s.label} approaching`, 'warning');
    }
    actions.ui.toast(`${door.label} door unlocked`, 'success');
  };

  if (!vehicle.adas.safeExit) {
    return (
      <Panel title="Safe exit assist">
        <div className="card-inset p-5 flex items-center gap-4">
          <p className="flex-1 text-ink-2">Safe exit assist is turned off.</p>
          <button type="button" className="btn" onClick={() => actions.vehicle.setAdas('safeExit', true)}>Turn on</button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Safe exit assist" action={<CameraButton status={status} onStart={start} onStop={stop} />}>
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-4 min-h-0">
        <div className="flex flex-col gap-2">
          {stream ? <LivePreview stream={stream} draw={draw} videoRef={video} label="Rear camera" /> : (
            <Placeholder status={status} error={error} text="Point the camera behind the car. MYRA detects pedestrians, cyclists and vehicles and estimates how close and how fast they are coming." />
          )}
          <p className="text-xs text-ink-3">Shown as in a mirror: the left half of the picture is the car’s left side.</p>
        </div>
        <div className="flex flex-col gap-3 min-h-0">
          {(['left', 'right'] as Side[]).map((side) => <SideCard key={side} side={side} s={sides[side]} live={status === 'on'} />)}
          <div className="grid grid-cols-2 gap-2">
            {DOORS.map((d) => {
              const held = driveMode === 'driving' || (status === 'on' && sides[d.side].risk === 'danger');
              return (
                <button key={d.id} type="button" className={`btn !min-h-11 !text-sm ${held ? 'btn-danger' : ''}`} onClick={() => open(d)}>
                  {held ? <Lock size={15} aria-hidden /> : <DoorOpen size={15} aria-hidden />} {d.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink-3">Doors are held when something is within {DANGER_M} m or will arrive in under {TTC_DANGER_S} s.</p>
        </div>
      </div>
    </Panel>
  );
}

function SideCard({ side, s, live }: { side: Side; s: SideStatus; live: boolean }) {
  const colour = RISK_COLOUR[s.risk];
  return (
    <div className="card-inset p-3 flex items-center gap-3" style={s.risk !== 'clear' ? { borderColor: colour } : undefined} aria-live="polite">
      <span className="size-3 rounded-full shrink-0" style={{ background: live ? colour : 'var(--color-ink-3)' }} aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-ink capitalize">{side} side · {live ? (s.risk === 'clear' && !s.label ? 'Clear' : s.risk) : 'camera off'}</p>
        {live && s.label && s.distanceM !== null && (
          <p className="text-sm text-ink-2 tabular-nums">
            {s.label} at {s.distanceM.toFixed(1)} m
            {s.closingMps > 0.3 ? ` · closing ${(s.closingMps * 3.6).toFixed(0)} km/h` : ''}
            {s.ttcS !== null ? ` · ${s.ttcS.toFixed(1)} s away` : ''}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- BharatConnect ---------- */

function BharatView() {
  const { driveMode } = useAppState();
  return (
    <Panel title="BharatConnect">
      <div className="flex-1 min-h-0 scroll-y flex flex-col gap-3">{driveMode === 'driving' ? <DrivingNotice /> : <BharatDetail />}</div>
    </Panel>
  );
}
