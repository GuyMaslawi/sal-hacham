// Basket comparison: what the list costs in each store, and whether splitting it between two
// stores is worth the extra stop.

import type { Catalog } from '../data/catalog';
import { costFor, round2, type PricingOptions } from '../lib/pricing';
import type { ListItem, Promo } from '../types';

export interface Line {
  itemId: string;
  /** The product chosen for this line in this store (cheapest of the acceptable ones). */
  pid: string;
  total: number;
  regular: number;
  promo: Promo | null;
}

export interface StoreQuote {
  storeId: string;
  lines: Line[];
  /** Sum of the lines this store can supply. */
  total: number;
  /** Ids of matched items this store does not sell. */
  missing: string[];
  /**
   * `total` plus an estimate for the missing items (their average price elsewhere), so a store
   * does not look cheap just because it lacks half the list.
   */
  estimate: number;
  /** How much the applied deals took off the shelf prices. */
  promoSaving: number;
}

export interface SplitPlan {
  stores: Array<{ storeId: string; lines: Line[]; total: number }>;
  missing: string[];
  total: number;
  estimate: number;
  /** Saving compared with the best single store's estimate. */
  saving: number;
}

export interface Comparison {
  /** Cheapest first, by estimate. */
  quotes: StoreQuote[];
  split: SplitPlan | null;
  /** Items that have no product attached yet and so cannot be priced. */
  unmatched: ListItem[];
  /** Matched items that none of the chosen stores sells. */
  unavailable: ListItem[];
  pricedCount: number;
}

/** The cheapest acceptable product for one list line in one store, or null if none is sold. */
export function quoteLine(item: ListItem, storeId: string, catalog: Catalog, opts: PricingOptions): Line | null {
  let best: Line | null = null;
  for (const pid of item.pids) {
    const product = catalog.products.get(pid);
    const offer = product?.offers.get(storeId);
    if (!product || !offer) continue;
    const cost = costFor(offer, item.qty, product.weighted, opts);
    if (!best || cost.total < best.total) best = { itemId: item.id, pid, ...cost };
  }
  return best;
}

export function compareBasket(
  items: ListItem[],
  catalog: Catalog,
  storeIds: string[],
  opts: PricingOptions,
): Comparison {
  const unmatched = items.filter((i) => i.pids.length === 0);
  const matched = items.filter((i) => i.pids.length > 0);

  // lines[itemId][storeId]
  const lines = new Map<string, Map<string, Line>>();
  for (const item of matched) {
    const perStore = new Map<string, Line>();
    for (const storeId of storeIds) {
      const line = quoteLine(item, storeId, catalog, opts);
      if (line) perStore.set(storeId, line);
    }
    lines.set(item.id, perStore);
  }

  const unavailable = matched.filter((i) => lines.get(i.id)!.size === 0);
  const priced = matched.filter((i) => lines.get(i.id)!.size > 0);

  // What a missing item is assumed to cost: its average across the stores that do sell it.
  const typical = new Map<string, number>();
  for (const item of priced) {
    const totals = [...lines.get(item.id)!.values()].map((l) => l.total);
    typical.set(item.id, totals.reduce((a, b) => a + b, 0) / totals.length);
  }

  const quotes: StoreQuote[] = storeIds.map((storeId) => {
    const storeLines: Line[] = [];
    const missing: string[] = [];
    let total = 0;
    let penalty = 0;
    let promoSaving = 0;
    for (const item of priced) {
      const line = lines.get(item.id)!.get(storeId);
      if (line) {
        storeLines.push(line);
        total += line.total;
        promoSaving += line.regular - line.total;
      } else {
        missing.push(item.id);
        penalty += typical.get(item.id)!;
      }
    }
    return {
      storeId,
      lines: storeLines,
      total: round2(total),
      missing,
      estimate: round2(total + penalty),
      promoSaving: round2(promoSaving),
    };
  });
  quotes.sort((a, b) => a.estimate - b.estimate || a.missing.length - b.missing.length);

  return {
    quotes,
    split: priced.length >= 2 ? bestSplit(priced, lines, typical, storeIds, quotes[0]) : null,
    unmatched,
    unavailable,
    pricedCount: priced.length,
  };
}

function bestSplit(
  priced: ListItem[],
  lines: Map<string, Map<string, Line>>,
  typical: Map<string, number>,
  storeIds: string[],
  bestSingle: StoreQuote | undefined,
): SplitPlan | null {
  if (!bestSingle || storeIds.length < 2) return null;
  let best: SplitPlan | null = null;

  for (let a = 0; a < storeIds.length; a++) {
    for (let b = a + 1; b < storeIds.length; b++) {
      const A = storeIds[a];
      const B = storeIds[b];
      const linesA: Line[] = [];
      const linesB: Line[] = [];
      const missing: string[] = [];
      let penalty = 0;
      for (const item of priced) {
        const la = lines.get(item.id)!.get(A);
        const lb = lines.get(item.id)!.get(B);
        if (la && (!lb || la.total <= lb.total)) linesA.push(la);
        else if (lb) linesB.push(lb);
        else {
          missing.push(item.id);
          penalty += typical.get(item.id)!;
        }
      }
      // If everything lands in one store this is not a split at all.
      if (!linesA.length || !linesB.length) continue;
      const totalA = round2(linesA.reduce((n, l) => n + l.total, 0));
      const totalB = round2(linesB.reduce((n, l) => n + l.total, 0));
      const total = round2(totalA + totalB);
      const estimate = round2(total + penalty);
      if (!best || estimate < best.estimate) {
        best = {
          stores: [
            { storeId: A, lines: linesA, total: totalA },
            { storeId: B, lines: linesB, total: totalB },
          ],
          missing,
          total,
          estimate,
          saving: 0,
        };
      }
    }
  }

  if (!best) return null;
  best.saving = round2(bestSingle.estimate - best.estimate);
  // The store carrying most of the basket comes first.
  best.stores.sort((x, y) => y.lines.length - x.lines.length);
  return best.saving > 0.005 ? best : null;
}
