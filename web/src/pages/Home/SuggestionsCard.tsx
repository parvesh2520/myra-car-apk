import { Sparkles } from 'lucide-react';
import { useT } from '../../hooks/useT';
import { useSuggestions } from '../../hooks/useSuggestions';

const TONE = {
  accent: 'bg-accent-soft text-accent',
  warn: 'bg-warn/15 text-warn',
  ok: 'bg-ok/15 text-ok',
} as const;

export function SuggestionsCard() {
  const t = useT();
  const suggestions = useSuggestions(3);

  return (
    <section className="card p-4 flex flex-col gap-2.5 min-h-0" aria-label={t('forYou')}>
      <header className="flex items-center gap-2">
        <Sparkles size={14} className="text-accent" aria-hidden />
        <h2 className="label">{t('forYou')} · Myra</h2>
      </header>
      {suggestions.length === 0 && <p className="text-sm text-ink-2">You’re all set. Enjoy the drive!</p>}
      <ul className="flex flex-col gap-2 min-h-0" role="list">
        {suggestions.map((s) => (
          <li key={s.id} className="anim-fade">
            <div className="flex items-center gap-3 rounded-2xl bg-surface-2 border border-line p-2.5 pr-2.5">
              <span className={`grid place-items-center size-10 rounded-xl shrink-0 ${TONE[s.tone ?? 'accent']}`}>
                <s.icon size={18} aria-hidden />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink leading-snug truncate">{s.title}</p>
                <p className="text-xs text-ink-2 truncate">{s.detail}</p>
              </div>
              <button type="button" onClick={s.run} className="btn !min-h-10 !px-3.5 !text-sm shrink-0">
                {s.action}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
