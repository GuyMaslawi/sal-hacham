// "Which stores should I compare?" answered for the shopper: one branch of each leading chain
// in their area. The price files carry no branch coordinates, only the city, so distance is
// measured to the city and the largest branch stands in for the chain within a city. All of it
// runs on the device; the shopper's location is never sent anywhere.

import type { DataIndex, StoreInfo } from '../types';

export interface Point {
  lat: number;
  lng: number;
}

export function distanceKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Chains in the order most shoppers would want them compared: roughly by national reach. */
const CHAIN_PRIORITY = [
  'shufersal',
  'ramilevy',
  'yohananof',
  'victory',
  'osherad',
  'carrefour',
  'mahsaneihashuk',
  'hazihinam',
  'tivtaam',
  'freshmarket',
  'stopmarket',
  'keshet',
  'zolvebegadol',
  'supersapir',
  'kingstore',
  'netivhahesed',
  'maayan2000',
  'shukhair',
  'shefa',
  'politzer',
  'bareket',
  'citymarket',
  'citymarketshops',
  'hcohen',
  'ktshivuk',
  'mishnatyosef',
];
const priorityOf = (chainId: string) => {
  const i = CHAIN_PRIORITY.indexOf(chainId);
  return i < 0 ? CHAIN_PRIORITY.length : i;
};

// Pharmacies and convenience stores are not where a weekly shop happens. They stay available
// in the manual picker; they are just never suggested.
const NEVER_SUGGESTED = new Set(['superpharm', 'goodpharm', 'doralon']);

/** Small-format, online-only or wholesale branches: a last resort as a chain's representative. */
const isMinorFormat = (s: StoreInfo) =>
  /(^|\s)be(\s|$)|אקספרס|express|משלוחים|אונליין|online|אינטרנט|קליק|cash/i.test(`${s.sub} ${s.name}`) ||
  // Carrefour's neighbourhood formats.
  (s.chainId === 'carrefour' && /קרפור סיטי|^בעיר/.test(s.name));

/** Lower is better: discount formats first, where a chain has several. */
function formatRank(s: StoreInfo): number {
  if (isMinorFormat(s)) return 3;
  if (/דיל|היפר|מחסני/.test(`${s.sub} ${s.name}`)) return 0;
  if (/שלי|מרקט/.test(`${s.sub} ${s.name}`)) return 1;
  return 2;
}

export function cityPoint(index: DataIndex, city: string): Point | null {
  const c = index.geo[city];
  return c ? { lat: c[0], lng: c[1] } : null;
}

/** The city with stores closest to a point. */
export function nearestCity(index: DataIndex, point: Point): { city: string; distanceKm: number } | null {
  let best: { city: string; distanceKm: number } | null = null;
  for (const [city, [lat, lng]] of Object.entries(index.geo)) {
    const d = distanceKm(point, { lat, lng });
    if (!best || d < best.distanceKm) best = { city, distanceKm: d };
  }
  return best;
}

export interface Suggestion {
  /** The branch proposed for this chain. */
  store: StoreInfo;
  distanceKm: number;
  /** Other branches of the same chain in the area, best first. */
  alternatives: StoreInfo[];
  /** Ticked by default. */
  preselected: boolean;
}

export interface SuggestOptions {
  /** How many chains to offer. */
  max?: number;
  /** How many of them start ticked. */
  preselect?: number;
  /**
   * Only stores whose town lies within this many km of the origin, plus the origin's own town.
   * Left out: widen the area until it offers a real choice of chains.
   */
  radiusKm?: number;
  /** Only stores in these towns (a region). The origin then only decides which branch is nearer. */
  cities?: Set<string>;
  /** Distances count in steps of this size, so a bigger branch a little farther away can win. */
  stepKm?: number;
  /** How many other branches to offer per chain. */
  alternatives?: number;
}

// Widen the search until the area offers a real choice of chains.
const RADII_KM = [6, 12, 20, 35];
const ENOUGH_CHAINS = 3;

interface Located {
  store: StoreInfo;
  d: number;
}

function locateAll(index: DataIndex, origin: Point): Located[] {
  const located: Located[] = [];
  for (const store of index.stores) {
    if (NEVER_SUGGESTED.has(store.chainId)) continue;
    const p = cityPoint(index, store.city);
    if (p) located.push({ store, d: distanceKm(origin, p) });
  }
  return located;
}

const chainCount = (list: Located[]) =>
  new Set(list.filter((x) => !isMinorFormat(x.store)).map((x) => x.store.chainId)).size;

/** The smallest of the usual radii that offers a real choice of chains around a point. */
export function autoRadiusKm(index: DataIndex, origin: Point): number {
  const located = locateAll(index, origin);
  const home = nearestCity(index, origin)?.city;
  for (const radius of RADII_KM) {
    if (chainCount(located.filter((x) => x.d <= radius || x.store.city === home)) >= ENOUGH_CHAINS) return radius;
  }
  return RADII_KM[RADII_KM.length - 1];
}

/** The stores a choice of area covers (pharmacies left out, as in the suggestions). */
export function storesInArea(index: DataIndex, origin: Point, opts: Pick<SuggestOptions, 'radiusKm' | 'cities'> = {}): Located[] {
  const located = locateAll(index, origin);
  if (opts.cities) {
    const cities = opts.cities;
    return located.filter((x) => cities.has(x.store.city));
  }
  const home = nearestCity(index, origin)?.city;
  const radius = opts.radiusKm ?? autoRadiusKm(index, origin);
  // Distance is measured to the middle of each town, so the shopper's own town always counts:
  // someone at the edge of Jerusalem is still in Jerusalem.
  return located.filter((x) => x.d <= radius || x.store.city === home);
}

export function suggestStores(index: DataIndex, origin: Point, opts: SuggestOptions = {}): Suggestion[] {
  const { max = 8, preselect = 5, stepKm = 3, alternatives = 20 } = opts;
  const inArea = storesInArea(index, origin, opts);

  // Within the area: a full supermarket before a small format (express, pharmacy) whatever the
  // distance, then the nearer town (in steps, so a slightly farther big branch can win), then
  // the better format, then the wider range of products.
  const better = (a: Located, b: Located) =>
    Number(isMinorFormat(a.store)) - Number(isMinorFormat(b.store)) ||
    Math.round(a.d / stepKm) - Math.round(b.d / stepKm) ||
    formatRank(a.store) - formatRank(b.store) ||
    b.store.itemCount - a.store.itemCount;

  const byChain = new Map<string, Located[]>();
  for (const x of inArea) {
    const list = byChain.get(x.store.chainId);
    if (list) list.push(x);
    else byChain.set(x.store.chainId, [x]);
  }

  const suggestions: Suggestion[] = [];
  for (const list of byChain.values()) {
    list.sort(better);
    const [first, ...rest] = list;
    suggestions.push({
      store: first.store,
      distanceKm: first.d,
      alternatives: rest.slice(0, alternatives).map((x) => x.store),
      preselected: false,
    });
  }

  suggestions.sort(
    (a, b) =>
      Number(isMinorFormat(a.store)) - Number(isMinorFormat(b.store)) ||
      priorityOf(a.store.chainId) - priorityOf(b.store.chainId) ||
      a.distanceKm - b.distanceKm,
  );
  const top = suggestions.slice(0, max);
  top.forEach((s, i) => {
    s.preselected = i < preselect && (!isMinorFormat(s.store) || i < 2);
  });
  return top;
}
