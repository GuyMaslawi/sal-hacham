// Parsers for the three regulated file types: Stores, PriceFull and PromoFull.

import { blocks, tag, tagAny } from './xml.ts';
import {
  cleanManufacturer,
  cleanText,
  normalizeCode,
  normalizeQuantity,
  parseNumber,
  type Unit,
} from './normalize.ts';

// ---- Stores -------------------------------------------------------------------------------

export interface RawStore {
  storeId: string;
  name: string;
  address: string;
  city: string;
  subChain: string;
}

export const storeIdKey = (raw: string) => String(parseInt(raw.replace(/\D/g, '') || '0', 10));

export function parseStores(xml: string): { chainName: string; stores: Map<string, RawStore> } {
  const stores = new Map<string, RawStore>();
  const chainName = cleanText(tag(xml, 'ChainName'));

  const readStores = (scope: string, subChain: string) => {
    const list = blocks(scope, 'Store');
    for (const b of list.length ? list : blocks(scope, 'Branch')) {
      const id = tagAny(b, 'StoreID', 'StoreId');
      if (!id) continue;
      stores.set(storeIdKey(id), {
        storeId: storeIdKey(id),
        name: cleanText(tag(b, 'StoreName')),
        address: cleanText(tag(b, 'Address')),
        city: cleanText(tag(b, 'City')),
        subChain: subChain || cleanText(tag(b, 'SubChainName')),
      });
    }
  };

  const subChains = blocks(xml, 'SubChain');
  if (subChains.length) {
    for (const sc of subChains) {
      const subName = cleanText(tag(sc, 'SubChainName'));
      // A purely numeric sub-chain "name" is an id, not something worth showing.
      readStores(sc, /^\d*$/.test(subName) ? '' : subName);
    }
  } else {
    readStores(xml, '');
  }
  return { chainName, stores };
}

// ---- Prices -------------------------------------------------------------------------------

export interface PriceItem {
  code: string;
  name: string;
  manufacturer: string;
  price: number;
  qty: number;
  unit: Unit;
  weighted: boolean;
}

export function parsePriceFull(xml: string): { storeId: string; items: Map<string, PriceItem> } {
  const storeId = storeIdKey(tagAny(xml.slice(0, 2000), 'StoreID', 'StoreId'));
  const items = new Map<string, PriceItem>();
  let list = blocks(xml, 'Item');
  if (!list.length) list = blocks(xml, 'Product');

  for (const b of list) {
    const code = normalizeCode(tag(b, 'ItemCode'));
    const price = parseNumber(tag(b, 'ItemPrice'));
    const name = cleanText(tagAny(b, 'ItemName', 'ItemNm', 'ManufactureItemDescription', 'ManufacturerItemDescription'));
    if (!code || !name || !(price > 0) || price > 100_000) continue;
    const weighted = /^(1|true|yes)$/i.test(tag(b, 'bIsWeighted'));
    const { qty, unit } = normalizeQuantity(
      tag(b, 'Quantity'),
      tag(b, 'UnitQty'),
      tag(b, 'UnitOfMeasure'),
      weighted,
      name,
    );
    items.set(code, {
      code,
      name,
      manufacturer: cleanManufacturer(tagAny(b, 'ManufactureName', 'ManufacturerName')),
      price: Math.round(price * 100) / 100,
      qty,
      unit,
      weighted,
    });
  }
  return { storeId, items };
}

// ---- Promotions ---------------------------------------------------------------------------

/** What the app stores: "buy `minQty` for a total of `price`". */
export interface Promo {
  /** Units (or kilograms, for weighed items) that must be bought together. */
  minQty: number;
  /** Total price for `minQty` units. */
  price: number;
  /** True when the deal needs a club / loyalty membership or the chain's credit card. */
  club: boolean;
  /** Last valid day, YYYY-MM-DD. */
  end: string;
  desc: string;
  /** Most units the deal applies to per purchase, when the chain limits it. */
  maxQty?: number;
}

/** A promotion as read from the file, before its price convention is settled. */
export interface RawPromo extends Promo {
  /** DiscountedPrice exactly as published. */
  rawPrice: number;
  /** DiscountRate as published (percent), or null. */
  rate: number | null;
  /** Read from the promotion's own text, or decided by the file's majority. */
  basis: 'text' | 'majority';
  weighted: boolean;
}

// Reward types: 1 = N units for a fixed price, 3 = fixed promotional price, 10 = N from a group
// for a fixed price, 2 = percentage discount (only unambiguous for a single unit).
const FIXED_PRICE_REWARDS = new Set(['1', '3', '10']);

const isEveryoneClub = (clubText: string) => {
  const t = clubText.trim();
  return t === '' || t === '0' || /^0\s*[-–]/.test(t);
};

const day = (s: string) => {
  // Accepts 2026-11-20T…, 2026-11-20, 2026/11/20, 20/11/2026 and 20261120.
  const iso = /(\d{4})[-/](\d{2})[-/](\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const il = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (il) return `${il[3]}-${il[2]}-${il[1]}`;
  const compact = /^(20\d{2})(\d{2})(\d{2})/.exec(s.trim());
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : '';
};

// Deals a shopper standing in the store cannot get by just putting the item in the cart.
const NOT_IN_STORE =
  /קופון|תו זהב|תו קני|שובר|עובדי|נקודות|אונליין|online|באתר|באפליקצי|במשלוח|מעל\s*\d|בקני(?:י)?ה\s*(?:של|מעל|ב-?)\s*\d|בקני(?:י)?ת\s*\d/i;
// "Second one at half price", "1+1", "buy X get Y": the reward depends on buying something
// else first, which a per-item price cannot express.
const CONDITIONAL = /השני|שני ב|\d\s*\+\s*\d|מתנה|חינם|קנה |קבל/;
// Membership or a specific payment card, even when the file marks the deal as for everyone.
const MEMBERS_ONLY = /מועדון|חברי|w\s*card|כרטיס|אשראי|לחברים/i;

/** "עד 6 יח'", "מוגבל ל-2", "מקסימום 4" -> 6 */
const LIMIT = /(?:עד|מוגבל(?:ת)?(?:\s*ל)?-?|מקסימום|מקס'?)\s*(\d{1,2})\s*(?:יח|יחידות|מוצרים|מנות|פריטים|ק"ג)?/;

/** "2 ב-12", "3ב25", "2 יח' ב 10", "2 ק"ג ב 59.90" -> [2, 12] */
const N_FOR_X = /(?<![\d.])(\d{1,2})\s*(?:יח'?|יחידות|ק"ג|קג|קילו)?\s*ב\s*-?\s*(\d+(?:\.\d+)?)/;

const close = (a: number, b: number, tolerance = 0.06) => Math.abs(a - b) <= tolerance * b;

/**
 * Promotions that can be expressed as "buy N for a total of X" and need nothing else from the
 * shopper. Coupons, online-only and minimum-basket deals, gifts and blanket vouchers are left
 * out: showing a price the shopper will not actually get is worse than showing the shelf price.
 *
 * Chains disagree on what DiscountedPrice means for a multi-buy: most publish the total for
 * the bundle, some the price of one unit. Each promotion is settled by its own wording ("2 ב-22")
 * where it has one, and otherwise by what the rest of the same file does.
 */
export function parsePromoFull(xml: string, today: string): Map<string, RawPromo[]> {
  const byCode = new Map<string, RawPromo[]>();
  const pending: Array<{ promo: RawPromo; evidence: 'total' | 'unit' | null }> = [];
  const votes = { unit: { total: 0, unit: 0 }, kg: { total: 0, unit: 0 } };

  for (const p of blocks(xml, 'Promotion')) {
    if (tag(p, 'AdditionalIsCoupon') === '1') continue;
    const desc = cleanText(tag(p, 'PromotionDescription'));
    if (NOT_IN_STORE.test(desc) || CONDITIONAL.test(desc)) continue;
    // Reward type 0 marks an item that only triggers the deal: the rest are conditional on it.
    if (/<RewardType>\s*0\s*<\/RewardType>/i.test(p)) continue;

    const start = day(tagAny(p, 'PromotionStartDateTime', 'PromotionStartDate'));
    const end = day(tagAny(p, 'PromotionEndDateTime', 'PromotionEndDate'));
    if ((start && start > today) || (end && end < today)) continue;

    // A minimum basket can be set on the promotion itself or on any of its groups.
    if ([...p.matchAll(/<MinPurchaseAmo?u?n?t>\s*([\d.,]+)\s*</gi)].some((m) => parseNumber(m[1]) > 0)) continue;

    const club = !isEveryoneClub(tagAny(p, 'ClubID', 'ClubId')) || MEMBERS_ONLY.test(desc);
    const defaults = { reward: tag(p, 'RewardType'), minQty: tag(p, 'MinQty'), price: tag(p, 'DiscountedPrice') };
    const said = N_FOR_X.exec(desc);
    const saidN = said ? Number(said[1]) : 0;
    const saidX = said ? Number(said[2]) : 0;

    const groups = blocks(p, 'Group');
    for (const g of groups.length ? groups : [p]) {
      let items = blocks(g, 'PromotionItem');
      if (!items.length) items = blocks(g, 'Item');
      if (items.length === 0 || items.length > 400) continue;

      for (const it of items) {
        if (tag(it, 'IsGiftItem') === '1') continue;
        const reward = tag(it, 'RewardType') || defaults.reward;
        const weighted = tag(it, 'bIsWeighted') === '1';
        let minQty = parseNumber(tag(it, 'MinQty') || defaults.minQty) || 1;
        const rawPrice = parseNumber(tag(it, 'DiscountedPrice') || defaults.price);
        const rateText = tag(it, 'DiscountRate');
        const rate = rateText ? parseNumber(rateText) : null;
        if (!(rawPrice > 0)) continue;
        if (!FIXED_PRICE_REWARDS.has(reward) && !(reward === '2' && minQty <= 1)) continue;
        const code = normalizeCode(tag(it, 'ItemCode'));
        if (!code) continue;

        let evidence: 'total' | 'unit' | null = null;
        let price = rawPrice;
        if (weighted) {
          // A minimum under one kilo only makes sense as a price per kilo.
          if (minQty < 1) {
            minQty = 1;
            evidence = 'unit';
          } else if (said && saidN === Math.round(minQty)) {
            if (close(rawPrice, saidX)) evidence = 'total';
            else if (close(rawPrice * minQty, saidX)) evidence = 'unit';
          }
        } else {
          minQty = Math.max(1, minQty);
          if (!Number.isInteger(minQty) || minQty > 24) continue;
          if (said && saidN === minQty && minQty > 1) {
            if (close(rawPrice, saidX)) evidence = 'total';
            else if (close(rawPrice * minQty, saidX)) evidence = 'unit';
          } else if (said && minQty === 1 && saidN >= 2 && saidN <= 12 && close(rawPrice * saidN, saidX, 0.03)) {
            // "2 ב-21.90" published as one unit at 10.95: a single unit does not get the price.
            minQty = saidN;
            price = saidX;
            evidence = 'total';
          }
        }
        if (evidence === 'unit' && minQty > 1 && price === rawPrice) price = rawPrice * minQty;
        if (evidence && minQty > 1) votes[weighted ? 'kg' : 'unit'][evidence]++;

        // A cap on how much can be bought at the deal price, from the field or the wording.
        const capField = parseNumber(tag(it, 'MaxQty') || tag(p, 'MaxQty'));
        const capText = LIMIT.exec(desc);
        const cap = capField > 0 ? capField : capText ? Number(capText[1]) : 0;
        const promo: RawPromo = {
          minQty: Math.round(minQty * 1000) / 1000,
          price: Math.round(price * 100) / 100,
          club,
          end,
          desc: desc.slice(0, 70),
          ...(cap >= minQty && cap < 1000 ? { maxQty: cap } : {}),
          rawPrice,
          rate,
          basis: evidence ? 'text' : 'majority',
          weighted,
        };
        pending.push({ promo, evidence });
        const list = byCode.get(code);
        if (list) list.push(promo);
        else byCode.set(code, [promo]);
      }
    }
  }

  // Multi-buys the text did not settle follow what the same file does elsewhere.
  for (const { promo, evidence } of pending) {
    if (evidence || promo.minQty <= 1) continue;
    const v = votes[promo.weighted ? 'kg' : 'unit'];
    if (v.unit > v.total * 2 && v.unit >= 3) promo.price = Math.round(promo.rawPrice * promo.minQty * 100) / 100;
  }
  return byCode;
}

/**
 * Settle a multi-buy the text could not, using the published discount rate: the rate says what
 * the regular price of the covered quantity was, which is either one unit or the whole bundle.
 */
function settleByRate(item: PriceItem, p: RawPromo): RawPromo {
  if (p.basis === 'text' || p.minQty <= 1 || p.rate === null || !(p.rate > 0 && p.rate < 100)) return p;
  const regular = p.rawPrice / (1 - p.rate / 100);
  const one = item.price;
  const bundle = item.price * p.minQty;
  if (close(regular, one, 0.04) && !close(regular, bundle, 0.04)) {
    return { ...p, price: Math.round(p.rawPrice * p.minQty * 100) / 100 };
  }
  if (close(regular, bundle, 0.04)) return { ...p, price: Math.round(p.rawPrice * 100) / 100 };
  return p;
}

const strip = ({ minQty, price, club, end, desc, maxQty }: Promo): Promo => ({
  minQty,
  price,
  club,
  end,
  desc,
  ...(maxQty ? { maxQty } : {}),
});

/**
 * Keep the deals worth knowing for an item: for everyone, every bundle size that is not beaten
 * by a smaller or equal one (at most three), and the best club deal when it beats them all.
 */
export function pickPromos(item: PriceItem, promos: RawPromo[] | undefined): Promo[] {
  if (!promos?.length) return [];
  const settled = promos.map((p) => settleByRate(item, p));
  const unit = (p: Promo) => p.price / p.minQty;
  // A "deal" that is not cheaper than the shelf price, or is implausibly cheap, is bad data.
  const sane = settled.filter((p) => unit(p) < item.price * 0.995 && unit(p) >= item.price * 0.2);
  if (!sane.length) return [];
  const byUnit = (a: Promo, b: Promo) => unit(a) - unit(b) || a.minQty - b.minQty;

  const frontier = (list: Promo[]) => {
    const out: Promo[] = [];
    for (const p of [...list].sort((a, b) => a.minQty - b.minQty || unit(a) - unit(b))) {
      // Worth keeping only if it is cheaper per unit than every smaller bundle already kept.
      if (out.every((q) => unit(p) < unit(q) - 0.005)) out.push(p);
    }
    return out.sort(byUnit).slice(0, 3);
  };
  const publicDeals = frontier(sane.filter((p) => !p.club));
  const clubBest = sane.filter((p) => p.club).sort(byUnit)[0];
  const out = [...publicDeals];
  if (clubBest && (!publicDeals.length || unit(clubBest) < unit(publicDeals.sort(byUnit)[0]) - 0.005)) out.push(clubBest);
  return out.map(strip);
}
