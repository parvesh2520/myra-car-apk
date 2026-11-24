import { useEffect, useState } from 'react';
import { useActions } from '../../context/AppStore';
import { useMotionSense } from '../../hooks/useMotionSense';
import { motionRuntime, motionSimulator, motionTelemetry, type DeviceMotionStatus, type Manoeuvre } from '../../services/motionSense';
import { deviceMotionAvailability, requestDeviceMotionPermission } from '../../services/motionSensors';
import { Toggle } from '../../components/controls/Toggle';
import { Segmented } from '../../components/controls/Segmented';
import { Group, Setting } from './SettingsLayout';
import type { MotionAdaptation, MotionInput, MotionIntensity, MotionSenseSettings } from '../../types';

const DEVICE_HINT: Record<DeviceMotionStatus, string> = {
  idle: 'Uses this device’s accelerometer and gyroscope while MotionSense is on',
  requesting: 'Waiting for motion sensor permission…',
  active: 'Reading this device’s accelerometer and gyroscope',
  'no-data': 'No readings from this device — most laptops have no motion sensors. Use Simulation instead.',
  denied: 'Motion sensor permission was denied — Simulation is available instead',
  unsupported: 'This browser has no motion sensor API — Simulation is available instead',
  insecure: 'Motion sensors need a secure (HTTPS) connection — Simulation is available instead',
};

const MANOEUVRES: { id: Manoeuvre; label: string }[] = [
  { id: 'accelerate', label: 'Accelerate' },
  { id: 'brake', label: 'Brake' },
  { id: 'left', label: 'Left turn' },
  { id: 'right', label: 'Right turn' },
  { id: 'bump', label: 'Bump' },
  { id: 'steady', label: 'Steady' },
];

export function MotionSenseSection() {
  const actions = useActions();
  const { ms, runtime, suppressed, live, active, input, reducedMotion } = useMotionSense();
  const set = (patch: Partial<MotionSenseSettings>) => actions.settings.patch({ motionSense: { ...ms, ...patch } });

  // Preview never outlives this screen.
  useEffect(() => () => motionRuntime.set({ preview: false }), []);

  const chooseInput = async (next: MotionInput) => {
    if (next === 'simulation') return set({ input: next });
    const availability = deviceMotionAvailability();
    if (availability !== 'ok') {
      motionRuntime.set({ device: availability });
      return actions.ui.toast(DEVICE_HINT[availability], 'warning');
    }
    motionRuntime.set({ device: 'requesting' });
    if (!(await requestDeviceMotionPermission())) {
      motionRuntime.set({ device: 'denied' });
      return actions.ui.toast(DEVICE_HINT.denied, 'warning');
    }
    motionRuntime.set({ device: 'idle' });
    set({ input: 'device' });
  };

  const showControls = runtime.preview || (live && input === 'simulation');

  return (
    <>
      <Group
        title="MYRA MotionSense"
        note={`Subtle dots at the screen edges move with acceleration, braking, turns and bumps, so what passengers see matches what they feel. A comfort aid — not a medical treatment, and it may not help everyone.${
          reducedMotion ? ' Reduce motion is on: the dots stay still and show direction by brightness instead.' : ''
        }`}
      >
        <Setting
          label="MotionSense"
          hint={suppressed && ms.enabled ? 'Paused while driving — turn on Passenger mode to show cues to a passenger' : 'Reduce motion discomfort with adaptive visual motion cues.'}
        >
          <Toggle checked={ms.enabled} onChange={(v) => set({ enabled: v })} label="MotionSense" />
        </Setting>
        <Setting label="Intensity" hint="How far and how visibly the cues move">
          <Segmented<MotionIntensity>
            label="Motion cue intensity"
            value={ms.intensity}
            onChange={(v) => set({ intensity: v })}
            options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]}
          />
        </Setting>
        <Setting
          label="Adaptation"
          hint={ms.adaptation === 'adaptive' ? 'Cue movement scales with the detected motion and fades when the ride is steady' : 'Uses the selected intensity consistently'}
        >
          <Segmented<MotionAdaptation>
            label="Adaptation"
            value={ms.adaptation}
            onChange={(v) => set({ adaptation: v })}
            options={[{ value: 'adaptive', label: 'Adaptive' }, { value: 'manual', label: 'Manual' }]}
          />
        </Setting>
        <Setting label="Passenger mode" hint="Show cues while driving for a passenger. Off keeps the driver’s primary display clear.">
          <Toggle checked={ms.passengerMode} onChange={(v) => set({ passengerMode: v })} label="Passenger mode" />
        </Setting>
        <Setting
          label="Motion source"
          hint={ms.input === 'device' || runtime.device !== 'idle' ? DEVICE_HINT[runtime.device] : 'Simulated vehicle motion — the car’s own sensors are not connected in this prototype'}
        >
          <Segmented<MotionInput>
            label="Motion source"
            value={ms.input}
            onChange={(v) => void chooseInput(v)}
            options={[{ value: 'simulation', label: 'Simulation' }, { value: 'device', label: 'Device sensors' }]}
          />
        </Setting>
      </Group>

      <Group title="Preview" note="Simulated motion runs through the same processing as real sensor input.">
        <Setting label="Preview cues" hint="See how the cues behave while stationary. Device sensors stay off during preview.">
          <button
            type="button"
            className={`btn ${runtime.preview ? '' : 'btn-primary'}`}
            onClick={() => motionRuntime.set({ preview: !runtime.preview })}
          >
            {runtime.preview ? 'Exit preview' : 'Start preview'}
          </button>
        </Setting>
        {active && <LiveReading input={input} />}
        {showControls && (
          <div className="py-4">
            <p className="text-xs text-ink-2 mb-2">Simulate a manoeuvre</p>
            <div className="flex flex-wrap gap-2">
              {MANOEUVRES.map((m) => (
                <button key={m.id} type="button" className="btn !min-h-10" onClick={() => motionSimulator.trigger(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Group>
    </>
  );
}

/** Live pipeline values — shows the audience which sensor is driving the cues. Polls; no per-frame renders. */
function LiveReading({ input }: { input: MotionInput }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 150);
    return () => window.clearInterval(id);
  }, []);
  const s = motionTelemetry.sample;
  const f = (v: number | undefined) => (v ?? 0).toFixed(1).replace('-0.0', '0.0').padStart(5);
  return (
    <Setting
      label="Live motion"
      hint={input === 'device' ? (s ? 'From this device’s accelerometer · m/s²' : 'Waiting for device sensor readings…') : 'From the motion simulator · m/s²'}
    >
      <span className="text-sm text-ink tabular-nums whitespace-pre">
        Side {f(s?.lat)}  ·  Fwd {f(s?.lon)}  ·  Up {f(s?.vert)}  ·  Cue {Math.round(motionTelemetry.cue.level * 100)}%
      </span>
    </Setting>
  );
}
