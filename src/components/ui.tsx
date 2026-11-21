// Shared building blocks. The price tag is the one loud element; the rest stay plain.

import { ArrowRight, CircleHelp, Minus, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { create } from 'zustand';
import { formatPrice } from '../lib/pricing';
import { useNav } from '../state/nav';

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
      {/* What screen readers say instead of the drawn digits. */}
      <span className="sr-only">{label ?? formatPrice(value)}</span>
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
        'inline-flex items-center rounded-sm px-1.5 py-px text-[0.85rem] leading-5 font-semibold whitespace-nowrap',
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
  const btn = size === 'lg' ? 'size-12' : 'size-11';
  const next = (delta: number) => Math.round((value + delta) * 100) / 100;
  const removes = value - step <= 0;
  return (
    <div className="inline-flex shrink-0 items-center rounded-full border-[1.5px] border-line bg-surface" dir="ltr">
      <button
        type="button"
        aria-label={removes ? 'הסר מהרשימה' : 'פחות'}
        className={cx(btn, 'inline-flex items-center justify-center rounded-full active:bg-sunken', removes && 'text-alert')}
        onClick={() => onChange(next(-step))}
      >
        {/* At one unit, "minus" removes the line; say so with the icon. */}
        {removes ? <Trash2 className="size-[1.1rem]" strokeWidth={2.25} /> : <Minus className="size-5" strokeWidth={2.5} />}
      </button>
      <span className="num min-w-7 px-0.5 text-center text-[1.05rem] font-bold" aria-live="polite">
        {value}
        {unit ? <span className="ms-0.5 font-sans text-xs font-medium text-muted">{unit}</span> : null}
      </span>
      <button
        type="button"
        aria-label="עוד"
        className={cx(btn, 'inline-flex items-center justify-center rounded-full active:bg-sunken')}
        onClick={() => onChange(next(step))}
      >
        <Plus className="size-5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

/** The way back from a full screen: an arrow and the word, so nobody has to guess. */
export function BackButton({ onClick, label = 'חזרה' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full ps-1.5 pe-3 font-semibold text-ink active:bg-sunken"
    >
      <ArrowRight className="size-6" />
      {label}
    </button>
  );
}

/** An icon with its name written under it, for actions an icon alone would not explain. */
export function LabeledIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-12 min-w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 text-[0.75rem] leading-tight font-semibold text-ink active:bg-sunken"
    >
      {children}
      {label}
    </button>
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
        'relative h-11 w-[4.5rem] shrink-0 rounded-full transition-colors',
        checked ? 'bg-ink' : 'bg-line',
      )}
    >
      <span
        className={cx(
          'absolute top-1.5 size-8 rounded-full bg-surface transition-all',
          checked ? 'start-[2.25rem]' : 'start-1.5',
        )}
      />
    </button>
  );
}

// ---- Overlays -----------------------------------------------------------------------------

function useOverlay(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
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
  // Move focus into the panel when it opens, unless a field inside already took it, and give it
  // back to where it was when the panel closes, so screen readers and keyboards follow along.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => {
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}

/** A panel that rises from the bottom edge, within thumb reach. */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** The way onward, kept in view at the bottom of the panel. */
  footer?: ReactNode;
}) {
  const ref = useOverlay(onClose);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="fixed inset-0 z-40 flex items-end justify-center outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button type="button" aria-label="סגור" className="absolute inset-0 animate-fade bg-black/45" onClick={onClose} />
      <div className="frame relative max-h-[90dvh] animate-sheet overflow-y-auto overscroll-contain rounded-t-3xl bg-surface pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="sticky top-0 z-10 flex items-start gap-2 bg-surface px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg leading-snug font-bold">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-me-2 -mt-1.5 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 font-semibold active:bg-sunken"
          >
            <X className="size-5" />
            סגור
          </button>
        </div>
        <div className="px-5">{children}</div>
        {footer ? (
          <div className="sticky bottom-0 mt-4 border-t-[1.5px] border-line bg-surface px-5 pt-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/** A full-height screen layered over the app (search, store picker, scanner). */
export function FullScreen({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  const ref = useOverlay(onClose);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="overlay flex animate-page flex-col bg-paper outline-none"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {children}
    </div>
  );
}

// ---- Feedback -----------------------------------------------------------------------------

interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastState {
  message: string | null;
  action: ToastAction | null;
  show(message: string, action?: ToastAction): void;
  dismiss(): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>()((set) => ({
  message: null,
  action: null,
  show(message, action) {
    clearTimeout(toastTimer);
    set({ message, action: action ?? null });
    // A message that offers an undo stays long enough to be acted on.
    // Long enough to read without hurry; a message that offers an undo stays longer still.
    toastTimer = setTimeout(() => set({ message: null, action: null }), action ? 8000 : 4000);
  },
  dismiss() {
    clearTimeout(toastTimer);
    set({ message: null, action: null });
  },
}));

export const toast = (message: string, action?: ToastAction) => useToast.getState().show(message, action);

export function Toaster() {
  const message = useToast((s) => s.message);
  const action = useToast((s) => s.action);
  const dismiss = useToast((s) => s.dismiss);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-6">
      {message ? (
        <div
          className={cx(
            'flex max-w-full animate-sheet items-center gap-3 rounded-2xl bg-ink py-2.5 text-base font-semibold text-surface shadow-lg',
            action ? 'ps-5 pe-2' : 'px-5',
          )}
        >
          <span className="py-1">{message}</span>
          {action ? (
            <button
              type="button"
              className="pointer-events-auto min-h-11 shrink-0 rounded-xl bg-tag px-4 text-tag-ink"
              onClick={() => {
                action.run();
                dismiss();
              }}
            >
              {action.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The top of each main screen: its name, one line on what it is for, and a way to help that is
 * always in the same place.
 */
export function ScreenHeader({ title, children }: { title: string; children?: ReactNode }) {
  const open = useNav((s) => s.open);
  return (
    <header className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-[2.75rem] leading-none font-bold">{title}</h1>
        <button
          type="button"
          onClick={() => open({ kind: 'help' })}
          className="-me-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-[0.95rem] font-semibold text-ink active:bg-sunken"
        >
          <CircleHelp className="size-5" />
          עזרה
        </button>
      </div>
      {children ? <p className="mt-1.5 text-muted">{children}</p> : null}
    </header>
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
