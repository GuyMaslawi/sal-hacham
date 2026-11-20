// What the shopper owns: the list, the chosen stores and a few preferences. Small, so it lives
// in localStorage and survives reloads and offline use.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedLine } from '../lib/text';
import type { ListItem, Product, Settings } from '../types';

export const MAX_STORES = 8;

interface AppState {
  storeIds: string[];
  items: ListItem[];
  settings: Settings;
  /** The store the shopper is standing in (in-store mode). */
  shopStoreId: string | null;
  /** The "add to home screen" hint was dismissed. */
  installHintDismissed: boolean;

  addProduct(product: Product, qty?: number): void;
  addFreeText(lines: ParsedLine[]): void;
  setQty(itemId: string, qty: number): void;
  toggleChecked(itemId: string): void;
  removeItem(itemId: string): void;
  /** Put removed lines back where they were (undo). */
  restoreItems(entries: Array<{ item: ListItem; index: number }>): void;
  clearChecked(): void;
  clearAll(): void;
  /** Attach a product to a line. `primary` replaces the line's name (first match). */
  attachProduct(itemId: string, product: Product, primary: boolean): void;
  detachProduct(itemId: string, pid: string): void;

  setStoreIds(ids: string[]): void;
  setSettings(patch: Partial<Settings>): void;
  setShopStore(id: string | null): void;
  dismissInstallHint(): void;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Weighted products are bought by the half kilo; everything else by the unit. */
export const stepFor = (weighted: boolean) => (weighted ? 0.5 : 1);

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      storeIds: [],
      items: [],
      settings: { includeClub: false, splitThreshold: 30 },
      shopStoreId: null,
      installHintDismissed: false,

      addProduct: (product, qty) =>
        set((s) => {
          const step = stepFor(product.weighted);
          const existing = s.items.find((i) => i.pids.includes(product.pid));
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.id === existing.id ? { ...i, qty: i.qty + (qty ?? step), checked: false } : i,
              ),
            };
          }
          const item: ListItem = {
            id: newId(),
            label: product.name,
            qty: qty ?? 1,
            pids: [product.pid],
            checked: false,
            addedAt: Date.now(),
          };
          return { items: [...s.items, item] };
        }),

      addFreeText: (lines) =>
        set((s) => ({
          items: [
            ...s.items,
            ...lines.map((l, n) => ({
              id: newId() + n,
              label: l.label,
              qty: l.qty,
              pids: [],
              checked: false,
              addedAt: Date.now() + n,
            })),
          ],
        })),

      setQty: (itemId, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((i) => i.id !== itemId)
              : s.items.map((i) => (i.id === itemId ? { ...i, qty: Math.min(qty, 99) } : i)),
        })),

      toggleChecked: (itemId) =>
        set((s) => ({ items: s.items.map((i) => (i.id === itemId ? { ...i, checked: !i.checked } : i)) })),

      removeItem: (itemId) => set((s) => ({ items: s.items.filter((i) => i.id !== itemId) })),

      restoreItems: (entries) =>
        set((s) => {
          const items = [...s.items];
          for (const { item, index } of [...entries].sort((a, b) => a.index - b.index)) {
            if (!items.some((i) => i.id === item.id)) items.splice(Math.min(index, items.length), 0, item);
          }
          return { items };
        }),

      clearChecked: () => set((s) => ({ items: s.items.filter((i) => !i.checked) })),

      clearAll: () => set({ items: [] }),

      attachProduct: (itemId, product, primary) =>
        set((s) => ({
          items: s.items.map((i) => {
            if (i.id !== itemId || i.pids.includes(product.pid)) return i;
            return primary
              ? { ...i, label: product.name, pids: [product.pid, ...i.pids] }
              : { ...i, pids: [...i.pids, product.pid] };
          }),
        })),

      detachProduct: (itemId, pid) =>
        set((s) => ({
          items: s.items.map((i) => (i.id === itemId ? { ...i, pids: i.pids.filter((p) => p !== pid) } : i)),
        })),

      setStoreIds: (ids) =>
        set((s) => ({
          storeIds: ids.slice(0, MAX_STORES),
          shopStoreId: s.shopStoreId && ids.includes(s.shopStoreId) ? s.shopStoreId : null,
        })),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setShopStore: (id) => set({ shopStoreId: id }),
      dismissInstallHint: () => set({ installHintDismissed: true }),
    }),
    {
      name: 'sal-hacham-v1',
      partialize: ({ storeIds, items, settings, shopStoreId, installHintDismissed }) => ({
        storeIds,
        items,
        settings,
        shopStoreId,
        installHintDismissed,
      }),
    },
  ),
);
