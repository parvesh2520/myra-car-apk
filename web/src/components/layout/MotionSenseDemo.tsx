import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronLeft, ChevronRight, CircleDot, Pause, Play, RotateCcw, Waves, X } from 'lucide-react';
import { useActions } from '../../context/AppStore';
import { useMotionSense } from '../../hooks/useMotionSense';
import { motionSimulator, motionTelemetry, stopMotionDemo, type Manoeuvre } from '../../services/motionSense';
import { Segmented } from '../controls/Segmented';
import type { MotionAdaptation } from '../../types';

type Arrow = 'up' | 'down' | 'left' | 'right' | null;

interface Step {
  manoeuvre: Manoeuvre;
  label: string;
  title: string;
  body: string;
  dots: string;
  arrow: Arrow;
  /** Speed to start from when jumping straight to this step, km/h. */
  speed: number;
  /** Seconds the step stays on screen before the next one. */
  duration: number;
}

/** The caption appears first; the car moves this many seconds later. */
const LEAD_S = 0.9;

const STEPS: Step[] = [
  {
    manoeuvre: 'steady',
    label: 'Cruise',
    title: 'Cruising steadily',
    body: 'At a constant speed there is no force to feel, so the dots rest at the edges of the screen at full size.',
    dots: 'Dots rest',
    arrow: null,
    speed: 40,
    duration: 4,
  },
  {
    manoeuvre: 'accelerate',
    label: 'Accelerate',
    title: 'Accelerating',
    body: 'You are pressed back into your seat. The dots stream backward with you — new ones appear at the top and shrink away as they flow down.',
    dots: 'Dots stream down',
    arrow: 'down',
    speed: 40,
    duration: 5.4,
  },
  {
    manoeuvre: 'brake',
    label: 'Sudden brake',
    title: 'Sudden braking',
    body: 'Your body lurches forward. The dots stream up the screen, so what your eyes see matches what your inner ear feels.',
    dots: 'Dots stream up',
    arrow: 'up',
    speed: 70,
    duration: 4.6,
  },
  {
    manoeuvre: 'left',
    label: 'Left turn',
    title: 'Turning left',
    body: 'The turn pushes you toward the right, and the dots stream right with you — appearing on the left and fading away to the right.',
    dots: 'Dots stream right',
    arrow: 'right',
    speed: 40,
    duration: 5.4,
  },
  {
    manoeuvre: 'right',
    label: 'Right turn',
    title: 'Turning right',
    body: 'Now you are pushed toward the left, and the dots stream left — appearing on the right and fading away to the left.',
    dots: 'Dots stream left',
    arrow: 'left',
    speed: 40,
    duration: 5.4,
  },
  {
    manoeuvre: 'bump',
    label: 'Bump',
    title: 'Road bump',
    body: 'A quick vertical jolt from the road — the dots dip and settle with the car.',
    dots: 'Dots dip',
    arrow: 'down',
    speed: 40,
    duration: 3.4,
  },
];

const ARROWS = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight };

/**
 * Guided presentation of MotionSense: scripted manoeuvres through the real cue
 * pipeline, with the interface blurred behind highlighted dots and a live view
 * of the simulated vehicle sensors. Keyboard and presenter-clicker friendly.
 */
export function MotionSenseDemo() {
  const actions = useActions();
  const { ms } = useMotionSense();
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const elapsed = useRef(0);
  const fired = useRef(false);
  const barRef = useRef<HTMLDivElement>(null);
  const done = step >= STEPS.length;

  const goTo = useCallback((i: number, jump: boolean) => {
    const next = Math.max(0, Math.min(STEPS.length, i));
    elapsed.current = 0;
    fired.current = false;
    if (jump) {
      motionSimulator.reset(STEPS[Math.min(next, STEPS.length - 1)].speed);
      setPaused(false);
    }
    setStep(next);
  }, []);

  const setMode = useCallback(
    (adaptation: MotionAdaptation) => actions.settings.patch({ motionSense: { ...ms, adaptation } }),
    [actions, ms],
  );

  // Step timeline: caption first, then the manoeuvre, then on to the next step.
  useEffect(() => {
    motionSimulator.paused = paused;
    const bar = barRef.current;
    if (done) {
      if (bar) bar.style.transform = 'scaleX(1)';
      return;
    }
    if (paused) return;
    const s = STEPS[step];
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!fired.current && elapsed.current >= (s.manoeuvre === 'steady' ? 0 : LEAD_S)) {
        fired.current = true;
        motionSimulator.trigger(s.manoeuvre);
      }
      if (bar) bar.style.transform = `scaleX(${Math.min(1, elapsed.current / s.duration).toFixed(4)})`;
      if (elapsed.current >= s.duration) return goTo(step + 1, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, paused, done, goTo]);

  useEffect(() => () => void (motionSimulator.paused = false), []);

  // Presenter keys. Captured before the cockpit's own shortcuts (Space = talk to Myra).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.code === 'Space' ? 'Space' : e.key;
      const handlers: Record<string, () => void> = {
        Escape: stopMotionDemo,
        Space: () => (done ? goTo(0, true) : setPaused((p) => !p)),
        ArrowRight: () => goTo(step + 1, true),
        PageDown: () => goTo(step + 1, true),
        ArrowLeft: () => goTo(step - 1, true),
        PageUp: () => goTo(step - 1, true),
        m: () => setMode(ms.adaptation === 'adaptive' ? 'manual' : 'adaptive'),
        M: () => setMode(ms.adaptation === 'adaptive' ? 'manual' : 'adaptive'),
      };
      const run = handlers[k];
      if (!run || e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      (document.activeElement as HTMLElement | null)?.blur?.();
      run();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, done, goTo, setMode, ms.adaptation]);

  const s = STEPS[Math.min(step, STEPS.length - 1)];
  const DotArrow = s.arrow ? ARROWS[s.arrow] : CircleDot;

  return (
    <div className="pointer-events-auto absolute inset-0 anim-fade" role="dialog" aria-modal="true" aria-label="MotionSense demo">
      <div className="absolute inset-0 bg-bg/45 backdrop-blur-[7px]" aria-hidden />

      <div className="absolute inset-y-5 left-[140px] right-[140px] flex flex-col gap-4">
        {/* Top: title, step chips, exit */}
        <div className="flex items-center gap-3">
          <span className="chip is-active !min-h-10 font-semibold shrink-0">
            <Waves size={16} aria-hidden />
            MotionSense demo
          </span>
          <ol className="flex-1 flex items-center justify-center gap-1.5 min-w-0" aria-label="Demo steps">
            {STEPS.map((st, i) => (
              <li key={st.manoeuvre}>
                <button
                  type="button"
                  onClick={() => goTo(i, true)}
                  aria-current={i === step ? 'step' : undefined}
                  className={`chip !min-h-9 !px-3 !text-[0.8125rem] ${i === step ? 'is-active' : i < step ? '!text-ink' : ''}`}
                >
                  <span className="tabular-nums opacity-60">{i + 1}</span>
                  {st.label}
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="icon-btn !size-11 shrink-0" onClick={stopMotionDemo} aria-label="Exit demo" title="Exit demo (Esc)">
            <X size={20} aria-hidden />
          </button>
        </div>

        {/* Middle: what is happening, and what the sensors read */}
        <div className="flex-1 min-h-0 grid grid-cols-[1fr_1.05fr] gap-4">
          <section className="card p-7 flex flex-col min-h-0" aria-live="polite">
            {done ? (
              <div key="done" className="anim-rise flex flex-col h-full">
                <p className="label">Demo complete</p>
                <h2 className="text-[2.25rem] leading-tight font-semibold tracking-tight mt-2">That’s MotionSense</h2>
                <p className="text-lg text-ink-2 mt-3 leading-relaxed">
                  Motion sickness comes from a mismatch: your inner ear feels the car move while your eyes see a still screen. The dots move with the car,
                  so both senses agree.
                </p>
                <p className="text-sm text-ink-3 mt-3">
                  Automatic shows the dots only when the car is moving. Manual keeps them on screen at all times.
                </p>
                <div className="mt-auto flex gap-3">
                  <button type="button" className="btn btn-primary !min-h-12 !px-6" onClick={() => goTo(0, true)}>
                    <RotateCcw size={18} aria-hidden /> Replay demo
                  </button>
                  <button type="button" className="btn !min-h-12 !px-6" onClick={stopMotionDemo}>
                    Exit demo
                  </button>
                </div>
              </div>
            ) : (
              <div key={step} className="anim-rise flex flex-col h-full">
                <p className="label">
                  Step {step + 1} of {STEPS.length}
                </p>
                <h2 className="text-[2.5rem] leading-tight font-semibold tracking-tight mt-2">{s.title}</h2>
                <p className="text-lg text-ink-2 mt-3 leading-relaxed">
                  {s.body}
                  {s.manoeuvre === 'steady' && ms.adaptation === 'adaptive' && ' In Automatic mode they also shrink out of the way.'}
                </p>
                <div className="mt-auto flex items-center gap-4 rounded-2xl bg-accent-soft border border-accent/30 px-5 py-4">
                  <span className="grid place-items-center size-14 rounded-full bg-accent text-on-accent shrink-0">
                    <DotArrow size={28} strokeWidth={2.5} aria-hidden />
                  </span>
                  <div>
                    <p className="label !text-accent">Watch the dots</p>
                    <p className="text-xl font-semibold text-ink mt-0.5">{s.dots}</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          <SensorPanel />
        </div>

        {/* Bottom: playback, progress, Automatic / Manual */}
        <div className="card !rounded-2xl px-3 py-2.5 flex items-center gap-2">
          <button type="button" className="icon-btn !size-11" onClick={() => goTo(step - 1, true)} disabled={step === 0} aria-label="Previous step" title="Previous (←)">
            <ChevronLeft size={20} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn !size-11 !bg-accent !text-on-accent !border-transparent"
            onClick={() => (done ? goTo(0, true) : setPaused((p) => !p))}
            aria-label={done ? 'Replay demo' : paused ? 'Resume' : 'Pause'}
            title={done ? 'Replay (Space)' : paused ? 'Resume (Space)' : 'Pause — dots hold their position (Space)'}
          >
            {done ? <RotateCcw size={20} aria-hidden /> : paused ? <Play size={20} aria-hidden /> : <Pause size={20} aria-hidden />}
          </button>
          <button type="button" className="icon-btn !size-11" onClick={() => goTo(step + 1, true)} disabled={done} aria-label="Next step" title="Next (→)">
            <ChevronRight size={20} aria-hidden />
          </button>
          <div className="flex-1 mx-3 h-1.5 rounded-full bg-surface-3 overflow-hidden" aria-hidden>
            <div ref={barRef} className="h-full w-full bg-accent origin-left" style={{ transform: 'scaleX(0)' }} />
          </div>
          {paused && !done && <span className="tag tag-demo">Paused</span>}
          <span className="text-sm text-ink-2 ml-2">Dots</span>
          <Segmented<MotionAdaptation>
            label="MotionSense mode"
            size="sm"
            value={ms.adaptation}
            onChange={setMode}
            options={[
              { value: 'adaptive', label: 'Automatic' },
              { value: 'manual', label: 'Manual' },
            ]}
          />
          <span className="text-[0.6875rem] text-ink-3 ml-2 hidden xl:inline">Space · ← → · M · Esc</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Live sensor view ---------- */

const RANGE = 6; // m/s² at full scale
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
const fmt = (v: number) => `${v >= 0.05 ? '+' : v <= -0.05 ? '−' : ' '}${Math.abs(v).toFixed(1)}`;

function readLive() {
  return { car: motionSimulator.state, s: motionTelemetry.sample ?? { lat: 0, lon: 0, vert: 0 } };
}

/** Re-renders every animation frame while the demo is open; the panel is small. */
function useLive() {
  const [live, setLive] = useState(readLive);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setLive(readLive());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return live;
}

function SensorPanel() {
  const { car, s } = useLive();
  const g = Math.hypot(s.lat, s.lon) / 9.81;
  return (
    <section className="card p-6 flex flex-col min-h-0" aria-label="Vehicle sensors">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label">Vehicle motion sensors</p>
          <p className="text-xs text-ink-3 mt-1">Accelerometer + gyroscope · simulated IMU</p>
        </div>
        <p className="text-right leading-none">
          <span className="text-[2.25rem] font-semibold tabular-nums tracking-tight">{Math.round(car.speedKmh)}</span>
          <span className="text-sm text-ink-2 ml-1">km/h</span>
        </p>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center gap-8 py-2">
        <CarTopView steerDeg={car.steerDeg} braking={car.braking} throttle={car.throttle} />
        <div className="flex flex-col items-center gap-1.5">
          <ForceBall x={clamp1(-s.lat / RANGE)} y={clamp1(s.lon / RANGE)} />
          <p className="text-xs text-ink-2">
            Felt force <span className="tabular-nums text-ink">{g.toFixed(2)} g</span> · the dots follow it
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <AxisBar label="Forward / back" value={s.lon} />
        <AxisBar label="Sideways" value={s.lat} />
        <AxisBar label="Vertical" value={s.vert} />
      </div>
    </section>
  );
}

function AxisBar({ label, value }: { label: string; value: number }) {
  const v = clamp1(value / RANGE);
  return (
    <div className="grid grid-cols-[110px_1fr_74px] items-center gap-3 text-sm">
      <span className="text-ink-2">{label}</span>
      <span className="relative h-2 rounded-full bg-surface-3 overflow-hidden" aria-hidden>
        <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        <span
          className="absolute inset-y-0 bg-accent rounded-full"
          style={v >= 0 ? { left: '50%', width: `${v * 50}%` } : { right: '50%', width: `${-v * 50}%` }}
        />
      </span>
      <span className="text-right tabular-nums text-ink whitespace-pre">
        {fmt(value)} <span className="text-ink-3 text-xs">m/s²</span>
      </span>
    </div>
  );
}

/** Friction-circle style view of the force the occupant feels (front = up, like the screen). */
function ForceBall({ x, y }: { x: number; y: number }) {
  const R = 78;
  const c = 90;
  return (
    <svg viewBox="0 0 180 180" className="size-[172px]" role="img" aria-label="Felt force direction">
      <circle cx={c} cy={c} r={R} fill="var(--color-surface-2)" stroke="var(--color-line-strong)" />
      <circle cx={c} cy={c} r={R / 2} fill="none" stroke="var(--color-line)" strokeDasharray="3 4" />
      <line x1={c - R} y1={c} x2={c + R} y2={c} stroke="var(--color-line)" />
      <line x1={c} y1={c - R} x2={c} y2={c + R} stroke="var(--color-line)" />
      <g fill="var(--color-ink-3)" fontSize="10" fontWeight="600" textAnchor="middle" letterSpacing="1">
        <text x={c} y={c - R + 14}>FRONT</text>
        <text x={c} y={c + R - 6}>REAR</text>
        <text x={c - R + 10} y={c + 4}>L</text>
        <text x={c + R - 10} y={c + 4}>R</text>
      </g>
      <line x1={c} y1={c} x2={c + x * R} y2={c + y * R} stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      <circle cx={c + x * R} cy={c + y * R} r="11" fill="var(--color-accent)" stroke="#fff" strokeWidth="2.5" />
    </svg>
  );
}

/** Top view of the car, nose up: steering front wheels, throttle glow and brake lights. */
function CarTopView({ steerDeg, braking, throttle }: { steerDeg: number; braking: boolean; throttle: boolean }) {
  const steer = Math.max(-28, Math.min(28, steerDeg * 3)); // exaggerated so it reads at a distance
  const wheel = (x: number, y: number, angle = 0) => (
    <rect x={x - 6} y={y - 13} width="12" height="26" rx="4" fill="var(--color-ink-2)" transform={`rotate(${angle} ${x} ${y})`} />
  );
  return (
    <svg viewBox="0 0 100 190" className="h-[188px] w-auto" role="img" aria-label={`Car${braking ? ', braking' : throttle ? ', accelerating' : ''}`}>
      {wheel(12, 46, steer)}
      {wheel(88, 46, steer)}
      {wheel(12, 146)}
      {wheel(88, 146)}
      <rect x="16" y="8" width="68" height="174" rx="28" fill="var(--color-surface-3)" stroke="var(--color-line-strong)" strokeWidth="1.5" />
      <path d="M26 62 Q50 50 74 62 L70 84 Q50 78 30 84 Z" fill="var(--color-surface-2)" stroke="var(--color-line-strong)" />
      <rect x="30" y="88" width="40" height="46" rx="8" fill="var(--color-surface-2)" opacity="0.7" />
      <path d="M30 138 Q50 142 70 138 L73 154 Q50 160 27 154 Z" fill="var(--color-surface-2)" stroke="var(--color-line-strong)" />
      <rect x="24" y="12" width="14" height="5" rx="2.5" fill="#fff" opacity="0.85" />
      <rect x="62" y="12" width="14" height="5" rx="2.5" fill="#fff" opacity="0.85" />
      <g fill="#ff3b30" style={{ filter: braking ? 'drop-shadow(0 0 6px #ff3b30)' : undefined }} opacity={braking ? 1 : 0.3}>
        <rect x="22" y="174" width="16" height="5" rx="2.5" />
        <rect x="62" y="174" width="16" height="5" rx="2.5" />
      </g>
      {throttle && (
        <path d="M50 36 l-9 12 h6 v10 h6 v-10 h6 z" fill="var(--color-accent)" opacity="0.9" />
      )}
    </svg>
  );
}
