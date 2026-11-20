// Shared building blocks. The price tag is the one loud element; the rest stay plain.

import { Minus, Plus, X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { create } from 'zustand';
import { formatPrice } from '../lib/pricing';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ---- Prices -------------------------------------------------------------------------------

/** A price printed like a shelf-edge label: big shekels, raised agorot, on promotion yellow. */
export function PriceTag({
  value,
  size = 'md',
  plain = false,
  label,
}: {
  value: number;
  size?: 'sm' | 'md' | 'lg';
  /** Ink-on-surface instead of the yellow tag (for prices that are not the headline). */
  plain?: boolean;
  label?: string;
}) {
  const [shekels, agorot] = value.toFixed(2).split('.');
  const scale = {
    sm: { big: 'text-[1.75rem]', small: 'text-[0.8rem]', pad: 'px-1.5 pt-0.5 pb-0' },
    md: { big: 'text-[2.6rem]', small: 'text-[1.05rem]', pad: 'px-2.5 pt-1 pb-0.5' },
    lg: { big: 'text-[4.25rem]', small: 'text-[1.6rem]', pad: 'px-3.5 pt-1.5 pb-1' },
  }[size];
  return (
    <span
      dir="ltr"
      aria-label={label ?? formatPrice(value)}
      className={cx(
        'inline-flex items-start gap-0.5 rounded-md font-display leading-[0.85] font-bold',
        scale.pad,
        plain ? 'text-ink' : 'bg-tag text-tag-ink',
      )}
    >
      <span aria-hidden className={cx(scale.big, 'tracking-[0.03em]')}>
        {Number(shekels).toLocaleString('en-US')}
      </span>
      <span aria-hidden className={cx('flex flex-col items-start pt-[0.12em]', scale.small)}>
        <span>{agorot}</span>
        <span className="font-sans text-[0.72em] leading-none font-bold">₪</span>
      </span>
    </span>
  );
}

/** A price inside running text or a table row. */
export function Price({ value, className }: { value: number; className?: string }) {
  // Semibold unless the caller sets a weight of its own.
  const weight = className?.includes('font-') ? '' : 'font-semibold';
  return <span className={cx('num whitespace-nowrap', weight, className)}>{formatPrice(value)}</span>;
}

/** How many of an item, as a small counter in front of its name. Hidden for a single unit. */
export function QtyBadge({ qty }: { qty: number }) {
  if (qty === 1) return null;
  return (
    <span className="me-1.5 inline-block min-w-6 rounded-md bg-ink px-1 text-center text-[0.85em] leading-[1.45] font-bold text-surface tabular-nums">
      {qty}
    </span>
  );
}

export function DealChip({ children, club }: { children: ReactNode; club?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-sm px-1.5 py-px text-[0.78rem] leading-5 font-semibold whitespace-nowrap',
        club ? 'bg-ink text-surface' : 'bg-tag text-tag-ink',
      )}
    >
      {children}
    </span>
  );
}

// ---- Buttons ------------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'tag' | 'quiet' | 'outline' | 'danger';

export function Button({
  variant = 'primary',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-ink text-surface active:opacity-80',
    tag: 'bg-tag text-tag-ink active:brightness-95',
    quiet: 'text-ink active:bg-sunken',
    outline: 'border-[1.5px] border-ink text-ink active:bg-sunken',
    danger: 'text-alert active:bg-sunken',
  };
  return (
    <button
      type="button"
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition-opacity disabled:opacity-40',
        styles[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink active:bg-sunken disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Stepper({
  value,
  step = 1,
  unit,
  onChange,
  size = 'md',
}: {
  value: number;
  step?: number;
  /** Shown after the number, e.g. ק"ג. */
  unit?: string;
  onChange: (next: number) => void;
  size?: 'md' | 'lg';
}) {
  const btn = size === 'lg' ? 'size-12' : 'size-9';
  const next = (delta: number) => Math.round((value + delta) * 100) / 100;
  return (
    <div className="inline-flex shrink-0 items-center rounded-full border-[1.5px] border-line bg-surface" dir="ltr">
      <button
        type="button"
        aria-label={value - step <= 0 ? 'הסר מהרשימה' : 'פחות'}
        className={cx(btn, 'inline-flex items-center justify-center rounded-full active:bg-sunken')}
        onClick={() => onChange(next(-step))}
      >
        <Minus className="size-4" strokeWidth={2.5} />
      </button>
      <span className="num min-w-7 px-0.5 text-center text-[0.95rem] font-bold" aria-live="polite">
        {value}
        {unit ? <span className="ms-0.5 font-sans text-xs font-medium text-muted">{unit}</span> : null}
      </span>
      <button
        type="button"
        aria-label="עוד"
        className={cx(btn, 'inline-flex items-center justify-center rounded-full active:bg-sunken')}
        onClick={() => onChange(next(step))}
      >
        <Plus className="size-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-8 w-14 shrink-0 rounded-full transition-colors',
        checked ? 'bg-ink' : 'bg-line',
      )}
    >
      <span
        className={cx(
          'absolute top-1 size-6 rounded-full bg-surface transition-all',
          checked ? 'start-7' : 'start-1',
        )}
      />
    </button>
  );
}

// ---- Overlays -----------------------------------------------------------------------------

function useOverlay(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
}

/** A panel that rises from the bottom edge, within thumb reach. */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useOverlay(onClose);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="סגור" className="absolute inset-0 animate-fade bg-black/45" onClick={onClose} />
      <div className="frame relative max-h-[90dvh] animate-sheet overflow-y-auto overscroll-contain rounded-t-3xl bg-surface pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="sticky top-0 z-10 flex items-start gap-2 bg-surface px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg leading-snug font-bold">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
          </div>
          <IconButton label="סגור" onClick={onClose} className="-me-2 -mt-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>
  );
}

/** A full-height screen layered over the app (search, store picker, scanner). */
export function FullScreen({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useOverlay(onClose);
  return (
    <div className="overlay flex animate-fade flex-col bg-paper" role="dialog" aria-modal="true" aria-label={label}>
      {children}
    </div>
  );
}

// ---- Feedback -----------------------------------------------------------------------------

interface ToastState {
  message: string | null;
  show(message: string): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>()((set) => ({
  message: null,
  show(message) {
    clearTimeout(toastTimer);
    set({ message });
    toastTimer = setTimeout(() => set({ message: null }), 2600);
  },
}));

export const toast = (message: string) => useToast.getState().show(message);

export function Toaster() {
  const message = useToast((s) => s.message);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-6">
      {message ? (
        <div className="animate-sheet rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-surface shadow-lg">
          {message}
        </div>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <h2 className="font-display text-4xl leading-none font-bold">{title}</h2>
      {children ? <p className="mx-auto mt-3 max-w-[22rem] text-muted">{children}</p> : null}
      {action ? <div className="mt-6 flex flex-col items-center gap-2">{action}</div> : null}
    </div>
  );
}

export { cx };
