// Reading the published data set (see scripts/sync) and caching it on the device.

import { del, get, set } from 'idb-keyval';
import type { DataIndex, StoreData, StoreInfo } from '../types';

/** Where the data lives. Defaults to the `data/` folder deployed next to the app. */
const DATA_URL = ((import.meta.env.VITE_DATA_URL as string | undefined) ?? `${import.meta.env.BASE_URL}data/`).replace(
  /\/?$/,
  '/',
);

interface RawIndex {
  generatedAt: string;
  chains: Array<{ id: string; name: string }>;
  stores: Array<{ id: string; c: string; n: string; sub: string; city: string; a: string; u: string; k: number; f: string; z: number }>;
  geo?: Record<string, [number, number]>;
}

/**
 * Fetch with a few patient retries. Under a burst of traffic the host now and then answers
 * 503 or drops a connection; one more try a moment later almost always succeeds, and the
 * shopper never sees an error.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  const waits = [600, 1800, 4000];
  for (let attempt = 0; ; attempt++) {
    // Retrying cannot help without a connection; say so at once.
    if (attempt > 0 && navigator.onLine === false) throw new Error('offline');
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok || (res.status < 500 && res.status !== 429) || attempt >= waits.length) return res;
    } catch (err) {
      if (attempt >= waits.length) throw err;
    }
    await new Promise((r) => setTimeout(r, waits[attempt]));
  }
}

/** The phone's browser cannot unpack the price files; updating the browser fixes it. */
export class OldBrowserError extends Error {}

async function readJson<T>(res: Response): Promise<T> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Store files are gzip archives; some hosts already unpack them in transit.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new OldBrowserError('הדפדפן בטלפון ישן מדי כדי לפתוח את קובצי המחירים. עדכן את הדפדפן (או את מערכת הטלפון) ונסה שוב.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text()) as T;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export async function fetchIndex(): Promise<DataIndex> {
  const res = await fetchWithRetry(`${DATA_URL}index.json`);
  if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
  const raw = await readJson<RawIndex>(res);
  return {
    generatedAt: raw.generatedAt,
    chains: raw.chains,
    geo: raw.geo ?? {},
    stores: raw.stores.map((s) => ({
      id: s.id,
      chainId: s.c,
      name: s.n,
      sub: s.sub,
      city: s.city,
      address: s.a,
      updatedAt: s.u,
      itemCount: s.k,
      file: s.f,
      size: s.z,
    })),
  };
}

export async function fetchStoreData(store: StoreInfo): Promise<StoreData> {
  const res = await fetchWithRetry(`${DATA_URL}${store.file}`);
  if (!res.ok) throw new Error(`${store.file}: HTTP ${res.status}`);
  const data = await readJson<StoreData>(res);
  return { id: data.id, u: data.u, items: data.items };
}

// ---- On-device cache (IndexedDB) -----------------------------------------------------------

const INDEX_KEY = 'index-v1';
const storeKey = (id: string) => `store-v1:${id}`;

export const loadCachedIndex = () => get<DataIndex>(INDEX_KEY).catch(() => undefined);
export const saveCachedIndex = (index: DataIndex) => set(INDEX_KEY, index).catch(() => undefined);
export const loadCachedStore = (id: string) => get<StoreData>(storeKey(id)).catch(() => undefined);
export const saveCachedStore = (data: StoreData) => set(storeKey(data.id), data).catch(() => undefined);
export const dropCachedStore = (id: string) => del(storeKey(id)).catch(() => undefined);
