// Price data for the chosen stores: loaded from the device first (works offline, instant),
// then refreshed from the network when a newer price list has been published.

import { create } from 'zustand';
import { buildCatalog, EMPTY_CATALOG, type Catalog } from '../data/catalog';
import {
  dropCachedStore,
  OldBrowserError,
  fetchIndex,
  fetchStoreData,
  loadCachedIndex,
  loadCachedStore,
  saveCachedIndex,
  saveCachedStore,
} from '../data/remote';
import type { DataIndex, StoreData, StoreInfo } from '../types';
import { MAX_STORES, useApp } from './app';

type LoadState = 'loading' | 'error';

interface DataState {
  index: DataIndex | null;
  /** Set when the store list could not be loaded and nothing is cached. */
  indexError: string | null;
  datasets: Record<string, StoreData>;
  loading: Record<string, LoadState>;
  catalog: Catalog;
  /** True once the on-device data has been read (the UI can render real content). */
  ready: boolean;
  refreshing: boolean;
  /** A problem the shopper must act on that is not about the connection. */
  problem: string | null;

  init(): Promise<void>;
  addStore(id: string): Promise<boolean>;
  removeStore(id: string): void;
  /** Re-download the store list and any price list that has a newer version. */
  refresh(): Promise<{ updated: number; failed: number; offline: boolean }>;
}

/** Resolves with `fallback` if the promise has not settled in time (a stuck storage backend). */
const within = <T>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

type RefreshResult = { updated: number; failed: number; offline: boolean };

export const useData = create<DataState>()((set, get) => {
  let initStarted = false;
  let running: Promise<RefreshResult> | null = null;

  const rebuild = () => {
    const { datasets, index } = get();
    const ids = useApp.getState().storeIds;
    const stores = index?.stores ?? [];
    set({ catalog: buildCatalog(ids.map((id) => datasets[id]).filter(Boolean), stores) });
  };

  const setLoading = (id: string, state: LoadState | null) =>
    set((s) => {
      const loading = { ...s.loading };
      if (state) loading[id] = state;
      else delete loading[id];
      return { loading };
    });

  const chosen = (id: string) => useApp.getState().storeIds.includes(id);

  const download = async (store: StoreInfo): Promise<boolean> => {
    setLoading(store.id, 'loading');
    try {
      const data: StoreData = { ...(await fetchStoreData(store)), z: store.size };
      // The shopper may have removed the store while it was downloading.
      if (!chosen(store.id)) {
        setLoading(store.id, null);
        return true;
      }
      void saveCachedStore(data);
      set((s) => ({ datasets: { ...s.datasets, [store.id]: data } }));
      setLoading(store.id, null);
      return true;
    } catch (err) {
      if (err instanceof OldBrowserError) set({ problem: err.message });
      // Keep whatever older copy we have; only flag an error when there is nothing to show,
      // and never for a store that is no longer chosen.
      setLoading(store.id, get().datasets[store.id] || !chosen(store.id) ? null : 'error');
      return false;
    }
  };

  const storeInfo = (id: string) => get().index?.stores.find((s) => s.id === id);

  return {
    index: null,
    indexError: null,
    datasets: {},
    loading: {},
    catalog: EMPTY_CATALOG,
    ready: false,
    refreshing: false,
    problem: null,

    async init() {
      if (initStarted) return;
      initStarted = true;
      const ids = useApp.getState().storeIds;
      // What is saved on the phone: applied whenever it arrives, even after the splash screen
      // gave up waiting, unless fresher data from the network got there first.
      const fromDevice = Promise.all([loadCachedIndex(), Promise.all(ids.map(loadCachedStore))]).then(
        ([cachedIndex, cached]) => {
          if (cachedIndex && !get().index) set({ index: { ...cachedIndex, geo: cachedIndex.geo ?? {} } });
          const add: Record<string, StoreData> = {};
          for (const d of cached) if (d && !get().datasets[d.id] && chosen(d.id)) add[d.id] = d;
          if (Object.keys(add).length) {
            set((s) => ({ datasets: { ...s.datasets, ...add } }));
            rebuild();
          }
          return true;
        },
      );
      // Never let a slow or blocked device cache keep the app on its splash screen.
      await within(fromDevice, 4000, false);
      set({ ready: true });
      await get().refresh();
    },

    async addStore(id) {
      const app = useApp.getState();
      if (app.storeIds.includes(id) || app.storeIds.length >= MAX_STORES) return false;
      const info = storeInfo(id);
      if (!info) return false;
      app.setStoreIds([...app.storeIds, id]);
      // Ask the browser not to evict the price lists when storage runs low.
      void navigator.storage?.persist?.();
      const ok = await download(info);
      rebuild();
      return ok;
    },

    removeStore(id) {
      const app = useApp.getState();
      app.setStoreIds(app.storeIds.filter((s) => s !== id));
      void dropCachedStore(id);
      set((s) => {
        const datasets = { ...s.datasets };
        delete datasets[id];
        const loading = { ...s.loading };
        delete loading[id];
        return { datasets, loading };
      });
      rebuild();
    },

    refresh() {
      // A second request while one is running waits for it, rather than reporting "nothing new".
      running ??= refreshNow().finally(() => {
        running = null;
      });
      return running;
    },
  };

  async function refreshNow(): Promise<RefreshResult> {
    set({ refreshing: true });
    try {
      let index: DataIndex;
      try {
        index = await fetchIndex();
      } catch (err) {
        if (!get().index) set({ indexError: err instanceof Error ? err.message : String(err) });
        return { updated: 0, failed: 0, offline: true };
      }
      // A chain's portal can be down for a day. Keep the shopper's stores from that chain
      // (with their last known prices) instead of making them vanish from the comparison.
      const previous = get().index;
      const chosen = useApp.getState().storeIds;
      const published = new Set(index.stores.map((s) => s.id));
      const kept = previous?.stores.filter((s) => chosen.includes(s.id) && !published.has(s.id)) ?? [];
      if (kept.length) {
        const chainIds = new Set(index.chains.map((c) => c.id));
        index = {
          ...index,
          stores: [...index.stores, ...kept],
          chains: [...index.chains, ...(previous?.chains.filter((c) => !chainIds.has(c.id)) ?? [])],
        };
      }
      set({ index, indexError: null });
      void saveCachedIndex(index);

      // A chosen store that no list knows any more (closed, or saved by a much older version)
      // would silently take one of the eight places; let it go.
      const known = new Set(index.stores.map((s) => s.id));
      const app = useApp.getState();
      if (app.storeIds.some((id) => !known.has(id))) app.setStoreIds(app.storeIds.filter((id) => known.has(id)));

      const byId = new Map(index.stores.map((s) => [s.id, s]));
      const stale = useApp
        .getState()
        .storeIds.map((id) => byId.get(id))
        .filter((s): s is StoreInfo => {
          if (!s) return false;
          const have = get().datasets[s.id];
          // A newer price list, or the same one rebuilt (a fix to how it is read): either way
          // the copy on the phone is out of date.
          return !have || have.u < s.updatedAt || have.z !== s.size;
        });
      const results = await Promise.all(stale.map(download));
      rebuild();
      const updated = results.filter(Boolean).length;
      return { updated, failed: results.length - updated, offline: false };
    } finally {
      set({ refreshing: false });
    }
  }
});

/** Today's date in Israel, for checking whether a deal is still valid. */
export const todayInIsrael = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
