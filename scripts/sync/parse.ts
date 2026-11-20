// Parsers for the three regulated file types: Stores, PriceFull and PromoFull.

import { blocks, tag, tagAny } from './xml.ts';
import {
  cleanManufacturer,
  cleanText,
  normalizeCode,
  normalizeQuantity,
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
    const price = parseFloat(tag(b, 'ItemPrice'));
    const name = cleanText(tagAny(b, 'ItemName', 'ItemNm', 'ManufactureItemDescription', 'ManufacturerItemDescription'));
    if (!code || !name || !(price > 0) || price > 100_000) continue;
    const weighted = tag(b, 'bIsWeighted') === '1';
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

export interface Promo {
  /** Units that must be bought together. */
  minQty: number;
  /** Total price for `minQty` units. */
  price: number;
  /** True when the deal needs a club / loyalty membership. */
  club: boolean;
  /** Last valid day, YYYY-MM-DD. */
  end: string;
  desc: string;
}

// Reward types whose DiscountedPrice is "total price for MinQty units" in every chain we checked:
// 1 = N units for a fixed total, 3 = fixed promotional unit price, 10 = N from a group for a total.
// 2 is a percentage discount and is only unambiguous for a single unit.
const FIXED_TOTAL_REWARDS = new Set(['1', '3', '10']);

const isEveryoneClub = (clubText: string) => {
  const t = clubText.trim();
  return t === '' || t === '0' || /^0\s*[-–]/.test(t);
};

const day = (s: string) => {
  // Accepts 2026-11-20T…, 2026-11-20, 2026/11/20 and 20/11/2026.
  const iso = /(\d{4})[-/](\d{2})[-/](\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const il = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return il ? `${il[3]}-${il[2]}-${il[1]}` : '';
};

/**
 * Promotions that can be expressed as "buy N for a total of X" and need nothing else from the
 * shopper. Coupons, minimum-basket deals, gifts and blanket vouchers are deliberately left out:
 * showing a price the shopper will not actually get is worse than showing the shelf price.
 */
export function parsePromoFull(xml: string, today: string): Map<string, Promo[]> {
  const byCode = new Map<string, Promo[]>();

  for (const p of blocks(xml, 'Promotion')) {
    if (tag(p, 'AdditionalIsCoupon') === '1') continue;
    const desc = cleanText(tag(p, 'PromotionDescription'));
    if (/קופון|תו זהב|תו קני|שובר|עובדי|נקודות/.test(desc)) continue;
    // "Second one at half price", "1+1", "buy X get Y": the reward depends on buying something
    // else first, which a per-item price cannot express.
    if (/השני|שני ב|\d\s*\+\s*\d|מתנה|חינם|קנה |קבל/.test(desc)) continue;

    const start = day(tagAny(p, 'PromotionStartDateTime', 'PromotionStartDate'));
    const end = day(tagAny(p, 'PromotionEndDateTime', 'PromotionEndDate'));
    if ((start && start > today) || (end && end < today)) continue;

    const club = !isEveryoneClub(tagAny(p, 'ClubID', 'ClubId'));
    const promoDefaults = {
      reward: tag(p, 'RewardType'),
      minQty: tag(p, 'MinQty'),
      price: tag(p, 'DiscountedPrice'),
    };

    // Reward type 0 marks an item that only triggers the deal. Its presence means the other
    // items' discounts are conditional, so the whole promotion is skipped.
    if (/<RewardType>\s*0\s*<\/RewardType>/i.test(p)) continue;

    const groups = blocks(p, 'Group');
    for (const g of groups.length ? groups : [p]) {
      const minPurchase = parseFloat(tagAny(g, 'MinPurchaseAmount', 'MinPurchaseAmnt'));
      if (minPurchase > 0) continue;
      let items = blocks(g, 'PromotionItem');
      if (!items.length) items = blocks(g, 'Item');
      if (items.length === 0 || items.length > 400) continue;

      for (const it of items) {
        if (tag(it, 'IsGiftItem') === '1') continue;
        const reward = tag(it, 'RewardType') || promoDefaults.reward;
        const minQty = Math.max(1, parseFloat(tag(it, 'MinQty') || promoDefaults.minQty) || 1);
        const price = parseFloat(tag(it, 'DiscountedPrice') || promoDefaults.price);
        if (!(price > 0)) continue;
        if (!FIXED_TOTAL_REWARDS.has(reward) && !(reward === '2' && minQty === 1)) continue;
        if (!Number.isInteger(minQty) || minQty > 24) continue;
        const code = normalizeCode(tag(it, 'ItemCode'));
        if (!code) continue;
        const promo: Promo = { minQty, price: Math.round(price * 100) / 100, club, end, desc: desc.slice(0, 70) };
        const list = byCode.get(code);
        if (list) list.push(promo);
        else byCode.set(code, [promo]);
      }
    }
  }
  return byCode;
}

/**
 * Keep at most three deals per item: the best for everyone, a single-unit deal for everyone if
 * the best one needs several units, and a club deal when it beats the public one.
 */
export function pickPromos(item: PriceItem, promos: Promo[] | undefined): Promo[] {
  if (!promos?.length) return [];
  const unit = (p: Promo) => p.price / p.minQty;
  // A "deal" that is not cheaper than the shelf price, or is implausibly cheap, is bad data.
  const sane = promos.filter((p) => unit(p) < item.price * 0.995 && unit(p) >= item.price * 0.2);
  if (!sane.length) return [];
  const byUnit = (a: Promo, b: Promo) => unit(a) - unit(b) || a.minQty - b.minQty;

  const publicDeals = sane.filter((p) => !p.club).sort(byUnit);
  const clubDeals = sane.filter((p) => p.club).sort(byUnit);
  const out: Promo[] = [];
  if (publicDeals[0]) {
    out.push(publicDeals[0]);
    if (publicDeals[0].minQty > 1) {
      const single = publicDeals.find((p) => p.minQty === 1);
      if (single) out.push(single);
    }
  }
  if (clubDeals[0] && (!publicDeals[0] || unit(clubDeals[0]) < unit(publicDeals[0]) - 0.005)) {
    out.push(clubDeals[0]);
  }
  return out;
}
