import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * If something unexpected breaks while drawing a screen, show a way out instead of a blank page.
 * The list itself is kept; only the screen is redrawn.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="frame flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-display text-4xl leading-none font-bold">משהו השתבש</h1>
        <p className="text-muted">הרשימה שלך שמורה. לחץ כדי לפתוח את האפליקציה מחדש.</p>
        <button
          type="button"
          className="min-h-12 rounded-xl bg-ink px-6 font-semibold text-surface"
          onClick={() => window.location.reload()}
        >
          פתח מחדש
        </button>
      </div>
    );
  }
}
