// What a quantity of a product costs in one store once promotions are applied.

import type { Offer, Product, Promo } from '../types';

/** To the agora, rounding halves up the way a till does (1.005 is 1.01, not 1.00 as floating point would have it). */
export const round2 = (n: number) => Number(`${Math.round(Number(`${n}e2`))}e-2`);

export interface Cost {
  /** What the shopper pays. */
  total: number;
  /** Shelf price × quantity, before any deal. */
  regular: number;
  promo: Promo | null;
}

export interface PricingOptions {
  includeClub: boolean;
  /** YYYY-MM-DD, used to ignore deals that expired since the data was fetched. */
  today: string;
}

const usable = (p: Promo, opts: PricingOptions) => (opts.includeClub || !p.club) && (!p.end || p.end >= opts.today);

/**
 * The cheapest way to buy `qty` of a product in one store. Several deals can combine: four units
 * with "3 for 20" and "1 for 7.50" on offer cost 20 + 7.50. A deal capped at a few units per
 * purchase applies only that many times.
 */
export function costFor(offer: Offer, qty: number, weighted: boolean, opts: PricingOptions): Cost {
  const regular = offer.price * qty;
  const deals = offer.promos.filter((p) => usable(p, opts));
  if (!deals.length || !(qty > 0)) return { total: round2(regular), regular: round2(regular), promo: null };

  if (weighted || !Number.isInteger(qty) || qty > 200) {
    // By weight: the best per-kilo deal applies to the whole weight (up to its cap) once the
    // minimum weight is reached.
    let best = regular;
    let promo: Promo | null = null;
    for (const p of deals) {
      if (qty < p.minQty && p.minQty > 1) continue;
      const atDeal = p.maxQty ? Math.min(qty, p.maxQty) : qty;
      const total = atDeal * (p.price / p.minQty) + (qty - atDeal) * offer.price;
      if (total < best - 0.001) {
        best = total;
        promo = p;
      }
    }
    return { total: round2(best), regular: round2(regular), promo };
  }

  // By the unit: cost[n] is the cheapest way to buy n units, adding one deal at a time.
  let cost = Array.from({ length: qty + 1 }, (_, n) => n * offer.price);
  let shown: Array<{ promo: Promo | null; saving: number }> = cost.map(() => ({ promo: null, saving: 0 }));
  for (const d of deals) {
    const k = d.minQty;
    if (!(k >= 1) || k > qty) continue;
    const maxBundles = d.maxQty ? Math.floor(d.maxQty / k) : Math.floor(qty / k);
    const next = cost.slice();
    const nextShown = shown.slice();
    for (let n = k; n <= qty; n++) {
      for (let c = 1; c <= maxBundles && c * k <= n; c++) {
        const candidate = cost[n - c * k] + c * d.price;
        if (candidate < next[n] - 0.0001) {
          next[n] = candidate;
          // Name the deal that saves the most in this combination.
          const saving = c * (k * offer.price - d.price);
          const before = shown[n - c * k];
          nextShown[n] = saving >= before.saving ? { promo: d, saving } : before;
        }
      }
    }
    cost = next;
    shown = nextShown;
  }
  return { total: round2(cost[qty]), regular: round2(regular), promo: shown[qty].promo };
}

/** A deal the shopper would unlock by adding a few more units. */
export function nextDeal(offer: Offer, qty: number, opts: PricingOptions, weighted = false): Promo | null {
  let best: Promo | null = null;
  for (const p of offer.promos) {
    if (!usable(p, opts) || p.minQty <= qty) continue;
    // By weight, a per-kilo deal with no real minimum already applies at any weight (see costFor).
    if (weighted && p.minQty <= 1) continue;
    if (!best || p.minQty < best.minQty) best = p;
  }
  return best;
}

/** Lowest single-unit price available for an offer (a one-unit deal, or the shelf price). */
export function singlePrice(offer: Offer, weighted: boolean, opts: PricingOptions): number {
  return costFor(offer, 1, weighted, opts).total;
}

export interface UnitPrice {
  value: number;
  /** e.g. "ל-100 גרם". */
  per: string;
}

/** Price per comparable measure, for telling apart package sizes. */
export function unitPrice(product: Pick<Product, 'qty' | 'unit' | 'weighted'>, price: number): UnitPrice | null {
  if (product.weighted) return { value: price, per: 'לק"ג' };
  if (!(product.qty > 0)) return null;
  switch (product.unit) {
    case 'g':
      return { value: round2((price / product.qty) * 100), per: 'ל-100 גרם' };
    case 'ml':
      return { value: round2((price / product.qty) * 100), per: 'ל-100 מ"ל' };
    case 'm':
      return { value: round2(price / product.qty), per: 'למטר' };
    case 'u':
      return product.qty > 1 ? { value: round2(price / product.qty), per: 'ליחידה' } : null;
    default:
      return null;
  }
}

/** Package size the way it is printed on a shelf label. */
export function sizeLabel(product: Pick<Product, 'qty' | 'unit' | 'weighted'>): string {
  if (product.weighted) return 'במשקל';
  const { qty, unit } = product;
  if (!(qty > 0)) return '';
  const n = (v: number) => String(round2(v));
  if (unit === 'g') return qty >= 1000 ? `${n(qty / 1000)} ק"ג` : `${n(qty)} גרם`;
  if (unit === 'ml') return qty >= 1000 ? `${n(qty / 1000)} ליטר` : `${n(qty)} מ"ל`;
  if (unit === 'm') return `${n(qty)} מטר`;
  if (unit === 'u' && qty > 1) return `${n(qty)} יחידות`;
  return '';
}

const amount = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "₪1,234.50". Always rendered left-to-right (see the `.num` class) so it reads the same in any sentence. */
export const formatPrice = (n: number) => `₪${amount.format(n)}`;

/** "2 ב-10 ₪" / "מבצע 12.90 ₪", marked when it is for club members only. */
export function promoLabel(p: Promo): string {
  const price = Number.isInteger(p.price) ? String(p.price) : p.price.toFixed(2);
  const deal = p.minQty > 1 ? `${p.minQty} ב-${price} ₪` : `מבצע ${price} ₪`;
  return p.club ? `מועדון: ${deal}` : deal;
}
