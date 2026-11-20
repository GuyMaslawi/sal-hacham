import { useApp } from '../state/app';
import type { TextSize } from '../types';
import { cx } from './ui';

const OPTIONS: Array<{ id: TextSize; label: string; sample: string }> = [
  { id: 'normal', label: 'רגיל', sample: 'text-base' },
  { id: 'large', label: 'גדול', sample: 'text-xl' },
  { id: 'xl', label: 'גדול מאוד', sample: 'text-2xl' },
];

/** Three plain choices, each drawn at the size it gives, so the effect is visible before tapping. */
export function TextSizeChoice() {
  const textSize = useApp((s) => s.settings.textSize);
  const setSettings = useApp((s) => s.setSettings);
  return (
    <div role="radiogroup" aria-label="גודל הטקסט" className="mt-2 grid grid-cols-3 gap-2">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={textSize === o.id}
          onClick={() => setSettings({ textSize: o.id })}
          className={cx(
            'flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-1 font-semibold',
            textSize === o.id ? 'border-ink bg-ink text-surface' : 'border-line bg-surface',
          )}
        >
          <span className={cx('leading-none font-bold', o.sample)}>א</span>
          <span className="text-sm">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
