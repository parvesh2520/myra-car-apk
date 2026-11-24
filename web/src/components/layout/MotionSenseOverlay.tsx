import { useEffect, useRef } from 'react';
import { useMotionSense } from '../../hooks/useMotionSense';
import { MotionProcessor, cueVisual, motionRuntime, motionSimulator, motionTelemetry, type MotionProvider } from '../../services/motionSense';
import { DeviceMotionProvider } from '../../services/motionSensors';
import type { MotionAdaptation, MotionInput, MotionIntensity } from '../../types';

const EDGES = [
  { id: 'top', className: 'top-2.5 inset-x-16 flex justify-between', dots: 9 },
  { id: 'bottom', className: 'bottom-2.5 inset-x-16 flex justify-between', dots: 9 },
  { id: 'left', className: 'left-2.5 inset-y-16 flex flex-col justify-between', dots: 5 },
  { id: 'right', className: 'right-2.5 inset-y-16 flex flex-col justify-between', dots: 5 },
] as const;

/**
 * Peripheral motion cues. Only the dots move — the interface underneath never does.
 * Renders nothing while MotionSense is inactive and never receives pointer events.
 */
export function MotionSenseOverlay() {
  const { active, ms, input, reducedMotion } = useMotionSense();
  if (!active) return null;
  return <CueLayer input={input} intensity={ms.intensity} adaptation={ms.adaptation} reduced={reducedMotion} />;
}

function CueLayer({ input, intensity, adaptation, reduced }: { input: MotionInput; intensity: MotionIntensity; adaptation: MotionAdaptation; reduced: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const edgeRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let provider: MotionProvider = motionSimulator;
    let device: DeviceMotionProvider | null = null;
    if (input === 'device') {
      device = new DeviceMotionProvider((status) => motionRuntime.set({ device: status }));
      device.start();
      provider = device;
    }

    const layer = layerRef.current!;
    const edges = edgeRefs.current;
    const processor = new MotionProcessor();
    let last = performance.now();
    let prev = '';
    let raf = 0;

    const frame = (now: number) => {
      const sample = provider.sample(now);
      const cue = processor.step(sample, (now - last) / 1000);
      motionTelemetry.sample = sample;
      motionTelemetry.cue = cue;
      last = now;
      const { dx, dy, opacity } = cueVisual(cue, intensity, adaptation);
      // Write to the DOM only when the visible result changes — no React renders per frame.
      const key = reduced ? `${cue.x.toFixed(2)}|${cue.y.toFixed(2)}|${opacity.toFixed(2)}` : `${dx.toFixed(1)}|${dy.toFixed(1)}|${opacity.toFixed(2)}`;
      if (key !== prev) {
        prev = key;
        if (reduced) {
          // Reduced motion: dots stay still; the edges the cue leans toward brighten instead.
          const lean = [-cue.y, cue.y, -cue.x, cue.x];
          edges.forEach((el, i) => el && (el.style.opacity = String(Math.min(0.75, opacity * (0.6 + 2 * Math.max(0, lean[i]))))));
        } else {
          layer.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
          layer.style.opacity = opacity.toFixed(2);
        }
      }
      raf = requestAnimationFrame(frame);
    };

    layer.style.transform = '';
    layer.style.opacity = reduced ? '1' : '0';
    edges.forEach((el) => el && (el.style.opacity = reduced ? '0' : ''));
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      device?.stop();
      motionTelemetry.sample = null;
    };
  }, [input, intensity, adaptation, reduced]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[80] overflow-hidden" aria-hidden data-motionsense>
      <div ref={layerRef} className="absolute inset-0 will-change-transform">
        {EDGES.map((edge, i) => (
          <div key={edge.id} ref={(el) => void (edgeRefs.current[i] = el)} className={`absolute ${edge.className}`}>
            {Array.from({ length: edge.dots }, (_, d) => (
              <span key={d} className="block size-1.5 rounded-full bg-ink" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
