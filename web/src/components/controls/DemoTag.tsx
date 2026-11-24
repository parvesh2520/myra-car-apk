import { FlaskConical } from 'lucide-react';

/** Marks simulated or demonstration-only content. */
export function DemoTag({ children = 'Demo', title }: { children?: string; title?: string }) {
  return (
    <span className="tag tag-demo" title={title ?? 'Simulated for this prototype — not connected to real services'}>
      <FlaskConical size={10} strokeWidth={2.5} aria-hidden />
      {children}
    </span>
  );
}
