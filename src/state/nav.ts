// Which tab is showing and which overlays are stacked on top of it.
//
// Every step away from the list (another tab, then each screen opened on top) is also an entry
// in the browser's history. That way the phone's back button and the swipe-back gesture do what
// people expect: close what is open, then return to the list. Without this, "back" leaves the
// app altogether, which is exactly the moment a less confident user gives up.

import { create } from 'zustand';

export type Tab = 'list' | 'compare' | 'shop' | 'stores';

export type SearchMode =
  /** Add products to the list, optionally starting from a typed word. */
  | { kind: 'add'; query?: string }
  /** Pick the product a free-text line refers to. */
  | { kind: 'match'; itemId: string; query: string }
  /** Pick a stand-in for a line in a store that lacks the exact product. */
  | { kind: 'substitute'; itemId: string; storeId: string; query: string };

export type Overlay =
  | { kind: 'search'; mode: SearchMode }
  | { kind: 'paste' }
  | { kind: 'scan' }
  | { kind: 'item'; itemId: string }
  /** The manual store picker. `quick` sends a chosen city on to the suggestions. */
  | { kind: 'stores'; quick?: boolean }
  /** Suggested stores near the shopper, or around a chosen city. */
  | { kind: 'nearby'; city?: string }
  | { kind: 'help' }
  /** "Done shopping?" confirmation. */
  | { kind: 'finish' };

interface NavState {
  tab: Tab;
  stack: Overlay[];
  go(tab: Tab): void;
  open(overlay: Overlay): void;
  /** Close the top overlay, the same way the phone's back button does. */
  close(): void;
}

/** How many history entries the current screen sits above the list. */
const depthOf = (tab: Tab, stack: Overlay[]) => (tab === 'list' ? 0 : 1) + stack.length;

const historyDepth = () => {
  const d = (window.history.state as { salDepth?: number } | null)?.salDepth;
  return typeof d === 'number' ? d : 0;
};

export const useNav = create<NavState>()((set, get) => ({
  tab: 'list',
  stack: [],

  go: (tab) => {
    const { tab: current, stack } = get();
    const from = depthOf(current, stack);
    const to = depthOf(tab, []);
    set({ tab, stack: [] });
    window.scrollTo({ top: 0 });
    if (to > from) window.history.pushState({ salDepth: to }, '');
    else if (to < from) window.history.go(to - from);
  },

  open: (overlay) => {
    const { tab, stack } = get();
    const next = [...stack, overlay];
    set({ stack: next });
    window.history.pushState({ salDepth: depthOf(tab, next) }, '');
  },

  close: () => {
    // A quick double tap must not step back twice and leave the app.
    if (!get().stack.length || backInFlight) return;
    backInFlight = true;
    // The popstate handler below does the actual closing.
    window.history.back();
  },
}));

let backInFlight = false;

/** Bring the screens in line with where the browser's history now stands. */
function onPopState() {
  backInFlight = false;
  const target = historyDepth();
  const { tab, stack } = useNav.getState();
  let excess = depthOf(tab, stack) - target;
  if (excess <= 0) return; // Forward navigation, or already in step.
  let nextStack = stack;
  let nextTab = tab;
  while (excess > 0 && nextStack.length) {
    nextStack = nextStack.slice(0, -1);
    excess--;
  }
  if (excess > 0 && nextTab !== 'list') {
    nextTab = 'list';
    window.scrollTo({ top: 0 });
  }
  useNav.setState({ tab: nextTab, stack: nextStack });
}

// After a reload the screens start from the list, but the browser may still hold entries for
// screens that were open before. Step back over them so "back" is not dead for a few presses.
const leftover = historyDepth();
if (leftover > 0) window.history.go(-leftover);
else window.history.replaceState({ salDepth: 0 }, '');
window.addEventListener('popstate', onPopState);
