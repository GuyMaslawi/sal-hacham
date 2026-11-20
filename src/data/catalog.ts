// The in-memory catalog: every product sold in the shopper's chosen stores, with what each
// store charges for it. A handful of stores is a few tens of thousands of products, so plain
// arrays and linear scans are fast enough and far simpler than an on-disk index.

import { normalize, normalizeCode, tokens } from '../lib/text';
import type { Product, StoreData, StoreInfo } from '../types';

export interface Catalog {
  products: Map<string, Product>;
  list: Product[];
  storeIds: string[];
}

export const EMPTY_CATALOG: Catalog = { products: new Map(), list: [], storeIds: [] };

/**
 * Real barcodes (8+ digits) identify the same product everywhere. Shorter codes are a chain's
 * own numbering for produce, bakery and deli items, so they only match inside that chain.
 */
export const productId = (code: string, chainId: string) => (code.length >= 8 ? code : `${chainId}:${code}`);

export function buildCatalog(datasets: StoreData[], stores: StoreInfo[]): Catalog {
  const chainOf = new Map(stores.map((s) => [s.id, s.chainId]));
  const products = new Map<string, Product>();

  for (const data of datasets) {
    const chainId = chainOf.get(data.id);
    if (!chainId) continue;
    for (const row of data.items) {
      const [code, name, manufacturer, price, qty, unit, weighted, promos] = row;
      const pid = productId(code, chainId);
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
        promos: promos ? promos.map(([minQty, pr, club, end, desc]) => ({ minQty, price: pr, club: club === 1, end, desc })) : [],
      });
    }
  }

  const list = [...products.values()];
  for (const p of list) p.norm = normalize(`${p.name} ${p.manufacturer}`);
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

/** Every query word must appear in the product name; best matches first. */
export function searchProducts(catalog: Catalog, query: string, opts: SearchOptions = {}): Product[] {
  const { limit = 60, storeId } = opts;
  const q = tokens(query);
  if (!q.length) return [];

  if (q.length === 1 && /^\d{7,14}$/.test(q[0])) {
    const hit = findByBarcode(catalog, q[0]);
    if (hit && (!storeId || hit.offers.has(storeId))) return [hit];
  }

  const scored: Array<{ p: Product; score: number }> = [];
  for (const p of catalog.list) {
    if (storeId && !p.offers.has(storeId)) continue;
    const norm = p.norm;
    let score = 0;
    let matched = true;
    for (let i = 0; i < q.length; i++) {
      const t = q[i];
      const at = norm.indexOf(t);
      if (at < 0) {
        matched = false;
        break;
      }
      const startsWord = at === 0 || norm[at - 1] === ' ';
      const end = at + t.length;
      const endsWord = end === norm.length || norm[end] === ' ';
      if (startsWord) score += endsWord ? 6 : 3;
      if (at === 0 && i === 0) score += 5;
    }
    if (!matched) continue;
    // Products stocked by more of the chosen stores are more useful to compare.
    score += Math.min(p.offers.size, 6) * 1.5;
    score -= Math.min(norm.length, 60) / 30;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, 'he'));
  return scored.slice(0, limit).map((s) => s.p);
}

const NOISE = new Set(['גרם', 'גר', 'ג', 'מל', 'ליטר', 'ל', 'קג', 'יח', 'יחידות', 'של', 'עם', 'ב', 'מארז', 'בטעם']);
const nameTokens = (p: Product) =>
  new Set(tokens(p.name).filter((t) => t.length > 1 && !NOISE.has(t) && !/^[\d.%]+$/.test(t)));

/**
 * Products in `storeId` that could stand in for `product` there: same kind of package, similar
 * name. Used when a store does not carry the exact barcode (store brands, produce).
 */
export function suggestSubstitutes(catalog: Catalog, product: Product, storeId: string, limit = 3): Product[] {
  const want = nameTokens(product);
  if (!want.size) return [];
  const scored: Array<{ p: Product; score: number }> = [];
  for (const p of catalog.list) {
    if (p.pid === product.pid || !p.offers.has(storeId)) continue;
    if (p.weighted !== product.weighted) continue;
    if (product.unit && p.unit && p.unit !== product.unit) continue;
    if (product.qty > 0 && p.qty > 0 && !product.weighted) {
      const ratio = p.qty / product.qty;
      if (ratio < 0.8 || ratio > 1.25) continue;
    }
    const have = nameTokens(p);
    let shared = 0;
    for (const t of want) if (have.has(t)) shared++;
    if (!shared) continue;
    const score = shared / (want.size + have.size - shared);
    if (score >= 0.34) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.p);
}
