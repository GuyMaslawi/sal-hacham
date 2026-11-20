// What a quantity of a product costs in one store once promotions are applied.

import type { Offer, Product, Promo } from '../types';

export const round2 = (n: number) => Math.round(n * 100) / 100;

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

export function costFor(offer: Offer, qty: number, weighted: boolean, opts: PricingOptions): Cost {
  const regular = offer.price * qty;
  let best = regular;
  let promo: Promo | null = null;
  for (const p of offer.promos) {
    if (!usable(p, opts)) continue;
    let total: number;
    if (weighted) {
      // Per-kilo deals apply to the whole weight once the minimum weight is reached.
      if (qty < p.minQty && p.minQty > 1) continue;
      total = qty * (p.price / p.minQty);
    } else {
      if (qty < p.minQty) continue;
      const bundles = Math.floor(qty / p.minQty);
      total = bundles * p.price + (qty - bundles * p.minQty) * offer.price;
    }
    if (total < best - 0.001) {
      best = total;
      promo = p;
    }
  }
  return { total: round2(best), regular: round2(regular), promo };
}

/** A deal the shopper would unlock by adding a few more units. */
export function nextDeal(offer: Offer, qty: number, opts: PricingOptions): Promo | null {
  let best: Promo | null = null;
  for (const p of offer.promos) {
    if (!usable(p, opts) || p.minQty <= qty) continue;
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

/** "2 ב-10 ₪" / "מבצע 12.90 ₪". */
export function promoLabel(p: Promo): string {
  const price = Number.isInteger(p.price) ? String(p.price) : p.price.toFixed(2);
  return p.minQty > 1 ? `${p.minQty} ב-${price} ₪` : `מבצע ${price} ₪`;
}
