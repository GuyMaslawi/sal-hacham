// Which tab is showing and which overlays are stacked on top of it.

import { create } from 'zustand';

export type Tab = 'list' | 'compare' | 'shop' | 'stores';

export type SearchMode =
  /** Add products to the list. */
  | { kind: 'add' }
  /** Pick the product a free-text line refers to. */
  | { kind: 'match'; itemId: string; query: string }
  /** Pick a stand-in for a line in a store that lacks the exact product. */
  | { kind: 'substitute'; itemId: string; storeId: string; query: string };

export type Overlay =
  | { kind: 'search'; mode: SearchMode }
  | { kind: 'paste' }
  | { kind: 'scan' }
  | { kind: 'item'; itemId: string }
  | { kind: 'stores' };

interface NavState {
  tab: Tab;
  stack: Overlay[];
  go(tab: Tab): void;
  open(overlay: Overlay): void;
  close(): void;
}

export const useNav = create<NavState>()((set) => ({
  tab: 'list',
  stack: [],
  go: (tab) => {
    set({ tab, stack: [] });
    window.scrollTo({ top: 0 });
  },
  open: (overlay) => set((s) => ({ stack: [...s.stack, overlay] })),
  close: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
}));
