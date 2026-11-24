import { useEffect, useState, type ReactNode } from 'react';
import type { ScreenFit } from '../../types';

/** Logical design height. Width follows the viewport (Fill) or the Verna's ≈2.29:1 panel (Reference). */
const BASE_H = 720;
const MIN_W = 1280;
const REF_W = 1650;

function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

/**
 * Scales a fixed-height logical canvas to the browser so the interface keeps
 * automotive proportions on any landscape display without horizontal scrolling.
 */
export function ScreenScaler({ fit, children }: { fit: ScreenFit; children: ReactNode }) {
  const { w, h } = useViewport();
  let scale: number;
  let width: number;
  let height: number;
  if (fit === 'reference') {
    scale = Math.min(w / REF_W, h / BASE_H);
    width = REF_W;
    height = BASE_H;
  } else {
    scale = Math.min(h / BASE_H, w / MIN_W);
    width = w / scale;
    height = h / scale;
  }
  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div
        style={{
          position: 'absolute',
          width,
          height,
          left: (w - width * scale) / 2,
          top: (h - height * scale) / 2,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </div>
  );
}
