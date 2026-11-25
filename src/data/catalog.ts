// The in-memory catalog: every product sold in the shopper's chosen stores, with what each
// store charges for it. A handful of stores is a few tens of thousands of products, so plain
// arrays and linear scans are fast enough and far simpler than an on-disk index.

import { normalize, normalizeCode, tokens, wordForms } from '../lib/text';
import type { Product, StoreData, StoreInfo } from '../types';

export interface Catalog {
  products: Map<string, Product>;
  list: Product[];
  storeIds: string[];
}

export const EMPTY_CATALOG: Catalog = { products: new Map(), list: [], storeIds: [] };

/**
 * Which rows are the same product. The id depends only on the row itself, never on which other
 * stores happen to be loaded, so a saved list keeps pointing at the same thing.
 *
 * - Real barcodes identify a product everywhere.
 * - Short codes, and the 7290000000000-7290000009999 block, are a chain's own numbering for
 *   produce, bakery and deli items: the same number means different things in different chains.
 * - A product sold by weight in one chain and by the unit in another is two products.
 */
export function productId(code: string, chainId: string, weighted: boolean): string {
  const base = code.length >= 8 && !/^729000000\d{4}$/.test(code) ? code : `${chainId}:${code}`;
  return weighted ? `${base}~kg` : base;
}

export function buildCatalog(datasets: StoreData[], stores: StoreInfo[]): Catalog {
  const chainOf = new Map(stores.map((s) => [s.id, s.chainId]));
  const products = new Map<string, Product>();

  for (const data of datasets) {
    const chainId = chainOf.get(data.id);
    if (!chainId) continue;
    for (const row of data.items) {
      const [code, name, manufacturer, price, qty, unit, weighted, promos] = row;
      const pid = productId(code, chainId, weighted === 1);
      let p = products.get(pid);
      if (!p) {
        p = { pid, code, name, manufacturer, qty, unit, weighted: weighted === 1, norm: '', offers: new Map() };
        products.set(pid, p);
      } else {
        // Chains describe the same barcode differently; keep the most informative version.
        if (name.length > p.name.length) p.name = name;
        if (!p.manufacturer && manufacturer) p.manufacturer = manufacturer;
        if (!p.unit && unit) {
          p.unit = unit;
          p.qty = qty;
        }
      }
      p.offers.set(data.id, {
        price,
        promos: promos
          ? promos.map(([minQty, pr, club, end, desc, maxQty]) => ({
              minQty,
              price: pr,
              club: club === 1,
              end,
              desc,
              ...(maxQty ? { maxQty } : {}),
            }))
          : [],
      });
    }
  }

  const list = [...products.values()];
  for (const p of list) p.norm = normalize(`${p.name} ${p.manufacturer}`);
  // Lists saved before ids carried the chain or the weight still find their product.
  for (const p of list) if (p.pid !== p.code && !products.has(p.code)) products.set(p.code, p);
  return { products, list, storeIds: datasets.map((d) => d.id) };
}

export function findByBarcode(catalog: Catalog, raw: string): Product | null {
  const code = normalizeCode(raw);
  if (!code) return null;
  const direct = catalog.products.get(code);
  if (direct) return direct;
  // Chain-scoped codes ("shufersal:1502") and barcodes stored with a different prefix length.
  for (const p of catalog.list) if (p.code === code) return p;
  return null;
}

export interface SearchOptions {
  limit?: number;
  /** Only products this store sells. */
  storeId?: string;
}

/**
 * Words that say how or where from something is sold, not what it is: "עגבניה במשקל" and
 * "בננות ישראל" are just a tomato and bananas.
 */
const SOLD_AS = new Set(
  'במשקל ארוז ארוזה ארוזים טרי טריה טריים שקיל בתפזורת לקג ישראל ישראלי ישראלית מובחר מובחרת מובחרים איכותי איכותית'
    .split(' ')
    .map(normalize),
);
/** One spelling for singular and plural, so "בננות" in one chain is "בננה" in another. */
const singular = (w: string) => wordForms(w)[0] ?? w;
const nameWords = (p: Product) =>
  normalize(p.name)
    .split(' ')
    .map((w) => w.replace(/\.+$/, ''))
    .filter((w) => w && !SOLD_AS.has(w))
    .map(singular);

interface SameName {
  stores: Set<string>;
  pids: string[];
}

/**
 * Items each chain names and numbers its own way: in-house codes (produce, bakery, deli) and
 * anything sold by weight, which some chains publish under a barcode of their own.
 */
const chainOwn = (p: Product) => p.weighted || p.pid.includes(':');
const sameNameCache = new WeakMap<Catalog, Map<string, SameName>>();

/**
 * Produce and deli items carry each chain's own code, so a tomato is a different product in every
 * chain. Group those by name and by how they are sold (by weight or by the unit), so "עגבניה" in
 * one chain can stand for "עגבניה" in another.
 */
function sameNameGroup(catalog: Catalog, pid: string): SameName | undefined {
  let byPid = sameNameCache.get(catalog);
  if (!byPid) {
    const groups = new Map<string, SameName>();
    byPid = new Map();
    for (const item of catalog.list) {
      if (!chainOwn(item)) continue;
      const words = nameWords(item).join(' ');
      if (!words) continue;
      const key = `${item.weighted ? 'w' : 'u'}|${words}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { stores: new Set(), pids: [] }));
      for (const id of item.offers.keys()) g.stores.add(id);
      g.pids.push(item.pid);
      byPid.set(item.pid, g);
    }
    sameNameCache.set(catalog, byPid);
  }
  return byPid.get(pid);
}

/** How many of the chosen stores sell a product (or, for produce, the same thing by name), for ranking. */
function reach(catalog: Catalog, p: Product): number {
  if (!chainOwn(p)) return p.offers.size;
  return Math.max(sameNameGroup(catalog, p.pid)?.stores.size ?? 0, p.offers.size);
}

/**
 * The same produce or deli item in the other chains: same name, sold the same way, a similar
 * package. Empty for products with a real barcode, which are the same product everywhere.
 */
export function sameProductElsewhere(catalog: Catalog, pid: string): Product[] {
  const product = catalog.products.get(pid);
  const group = product && sameNameGroup(catalog, product.pid);
  if (!product || !group) return [];
  const out: Product[] = [];
  for (const other of group.pids) {
    if (other === product.pid) continue;
    const p = catalog.products.get(other);
    if (!p) continue;
    if (!product.weighted && product.qty > 0 && p.qty > 0) {
      if (product.unit !== p.unit) continue;
      const ratio = p.qty / product.qty;
      if (ratio < 0.8 || ratio > 1.25) continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * Every query word must appear in the product name; best matches first. A plural also finds the
 * singular as a whole word ("עגבניות" finds "עגבניה"), and a product whose whole name is what the
 * shopper wrote ranks above longer names that merely contain it.
 */
export function searchProducts(catalog: Catalog, query: string, opts: SearchOptions = {}): Product[] {
  const { limit = 60, storeId } = opts;
  const q = tokens(query);
  if (!q.length) return [];

  if (q.length === 1 && /^\d{7,14}$/.test(q[0])) {
    const hit = findByBarcode(catalog, q[0]);
    if (hit && (!storeId || hit.offers.has(storeId))) return [hit];
  }

  const forms = q.map((t) => [t, ...wordForms(t)]);
  const allForms = new Set(forms.flat().map(singular));
  const scored: Array<{ p: Product; score: number }> = [];
  for (const p of catalog.list) {
    if (storeId && !p.offers.has(storeId)) continue;
    const norm = p.norm;
    let score = 0;
    let matched = true;
    for (let i = 0; i < q.length; i++) {
      let best = -1;
      forms[i].forEach((form, k) => {
        const at = norm.indexOf(form);
        if (at < 0) return;
        const startsWord = at === 0 || norm[at - 1] === ' ';
        const end = at + form.length;
        const endsWord = end === norm.length || norm[end] === ' ';
        // Another form of the word counts only as a whole word: "ביצ" must not find "ביצועים".
        if (k > 0 && !(startsWord && endsWord)) return;
        let s = startsWord ? (endsWord ? (k > 0 ? 5.5 : 6) : 3) : 0;
        if (at === 0 && i === 0) s += 5;
        best = Math.max(best, s);
      });
      if (best < 0) {
        matched = false;
        break;
      }
      score += best;
    }
    if (!matched) continue;
    const words = nameWords(p);
    if (words.length > 0 && words.every((w) => allForms.has(w))) score += 4;
    // Products stocked by more of the chosen stores are more useful to compare.
    score += Math.min(reach(catalog, p), 6) * 1.5;
    score -= Math.min(norm.length, 60) / 30;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, 'he'));
  return scored.slice(0, limit).map((s) => s.p);
}

const NOISE = new Set(['גרם', 'גר', 'ג', 'מל', 'ליטר', 'ל', 'קג', 'יח', 'יחידות', 'של', 'עם', 'ב', 'מארז', 'בטעם']);
const FROZEN = /(?:^| )קפוא/;
const ORGANIC = /(?:^| )אורגני/;
const nameTokenList = (p: Product) => tokens(p.name).filter((t) => t.length > 1 && !NOISE.has(t) && !/^[\d.%]+$/.test(t));
const nameTokens = (p: Product) => new Set(nameTokenList(p));

/**
 * Products in `storeId` that could stand in for `product` there: same kind of package, similar
 * name. Used when a store does not carry the exact barcode (store brands, produce).
 */
export function suggestSubstitutes(catalog: Catalog, product: Product, storeId: string, limit = 3): Product[] {
  const want = nameTokens(product);
  if (!want.size) return [];
  // The first word names what the thing is ("חזה עוף", "כנפיים עוף"); a stand-in must share it.
  const kind = nameTokenList(product)[0];
  const scored: Array<{ p: Product; score: number }> = [];
  for (const p of catalog.list) {
    if (p.pid === product.pid || !p.offers.has(storeId)) continue;
    if (p.weighted !== product.weighted) continue;
    // Frozen does not stand in for fresh, nor organic for regular (or the other way round).
    if (FROZEN.test(p.norm) !== FROZEN.test(product.norm)) continue;
    if (ORGANIC.test(p.norm) !== ORGANIC.test(product.norm)) continue;
    if (product.unit && p.unit && p.unit !== product.unit) continue;
    if (product.qty > 0 && p.qty > 0 && !product.weighted) {
      const ratio = p.qty / product.qty;
      if (ratio < 0.8 || ratio > 1.25) continue;
    }
    const have = nameTokens(p);
    if (!have.has(kind)) continue;
    let shared = 0;
    for (const t of want) if (have.has(t)) shared++;
    if (!shared) continue;
    const score = shared / (want.size + have.size - shared);
    if (score >= 0.34) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.p);
}
