import { describe, expect, it } from 'vitest';
import { buildCatalog, findByBarcode, searchProducts, suggestSubstitutes } from '../data/catalog';
import { costFor, nextDeal, unitPrice } from '../lib/pricing';
import { parseShoppingList } from '../lib/text';
import type { ListItem, StoreData, StoreInfo, StoreRow } from '../types';
import { fitQty } from '../state/app';
import { compareBasket } from './optimizer';

const OPTS = { includeClub: false, today: '2026-11-20' };

const store = (id: string, chainId: string): StoreInfo => ({
  id,
  chainId,
  name: id,
  sub: '',
  city: 'חיפה',
  address: '',
  updatedAt: '2026-11-20T04:00',
  itemCount: 0,
  file: '',
  size: 0,
});

const MILK = '7290000042442';
const COTTAGE = '7290004127329';
const RICE = '7290000111111';
const COFFEE = '7290000222222';

const data = (id: string, items: StoreRow[]): StoreData => ({ id, u: '2026-11-20T04:00', items });

const stores = [store('a-1', 'a'), store('b-1', 'b'), store('c-1', 'c')];
const catalog = buildCatalog(
  [
    data('a-1', [
      [MILK, 'חלב 3% בקרטון 1 ליטר', 'תנובה', 7.2, 1000, 'ml', 0],
      [COTTAGE, "קוטג' 5% 250 גרם", 'תנובה', 6.6, 250, 'g', 0, [[2, 10, 0, '2026-11-28', '2 ב-10']]],
      [RICE, 'אורז פרסי 1 ק"ג', 'סוגת', 12, 1000, 'g', 0],
      [COFFEE, 'קפה נמס 200 גרם', 'עלית', 30, 200, 'g', 0, [[1, 22, 1, '2026-11-28', 'מחיר מועדון']]],
      ['1502', 'מלפפון', '', 6.9, 1000, 'g', 1],
    ]),
    data('b-1', [
      [MILK, 'חלב 3% 1 ליטר', '', 6.9, 1000, 'ml', 0],
      [COTTAGE, "קוטג' 5%", '', 6.1, 250, 'g', 0],
      [RICE, 'אורז פרסי 1 ק"ג', 'סוגת', 15, 1000, 'g', 0],
      [COFFEE, 'קפה נמס 200 גרם', 'עלית', 21, 200, 'g', 0],
      ['88', 'מלפפון טרי', '', 5.9, 1000, 'g', 1],
    ]),
    data('c-1', [
      [MILK, 'חלב 3% 1 ליטר', '', 7.5, 1000, 'ml', 0],
      [RICE, 'אורז פרסי 1 ק"ג', 'סוגת', 9, 1000, 'g', 0, [[1, 8, 0, '2026-11-01', 'מבצע שפג']]],
    ]),
  ],
  stores,
);

const item = (id: string, pids: string[], qty = 1): ListItem => ({ id, label: id, qty, pids, checked: false, addedAt: 0 });
const ids = stores.map((s) => s.id);

describe('pricing', () => {
  const cottageA = catalog.products.get(COTTAGE)!.offers.get('a-1')!;

  it('applies a multi-buy deal only to full bundles', () => {
    expect(costFor(cottageA, 1, false, OPTS)).toMatchObject({ total: 6.6, promo: null });
    expect(costFor(cottageA, 2, false, OPTS).total).toBe(10);
    expect(costFor(cottageA, 3, false, OPTS).total).toBe(16.6);
    expect(costFor(cottageA, 4, false, OPTS).total).toBe(20);
  });

  it('combines deals for the cheapest total', () => {
    const offer = { price: 9, promos: [
      { minQty: 3, price: 20, club: false, end: '', desc: '' },
      { minQty: 1, price: 7.5, club: false, end: '', desc: '' },
    ] };
    expect(costFor(offer, 4, false, OPTS).total).toBe(27.5);
    expect(costFor(offer, 6, false, OPTS).total).toBe(40);
    expect(costFor(offer, 2, false, OPTS).total).toBe(15);
  });

  it('applies a capped deal only as often as allowed', () => {
    const offer = { price: 6.6, promos: [{ minQty: 2, price: 10, club: false, end: '', desc: '', maxQty: 2 }] };
    expect(costFor(offer, 4, false, OPTS).total).toBe(23.2);
  });

  it('points at a deal that one more unit would unlock', () => {
    expect(nextDeal(cottageA, 1, OPTS)?.minQty).toBe(2);
    expect(nextDeal(cottageA, 2, OPTS)).toBeNull();
  });

  it('counts club prices only when asked to', () => {
    const coffeeA = catalog.products.get(COFFEE)!.offers.get('a-1')!;
    expect(costFor(coffeeA, 1, false, OPTS).total).toBe(30);
    expect(costFor(coffeeA, 1, false, { ...OPTS, includeClub: true }).total).toBe(22);
  });

  it('ignores deals that expired after the data was fetched', () => {
    const riceC = catalog.products.get(RICE)!.offers.get('c-1')!;
    expect(costFor(riceC, 1, false, OPTS).total).toBe(9);
  });

  it('prices weighted items by the kilo', () => {
    const cucumber = catalog.products.get('a:1502~kg')!;
    expect(costFor(cucumber.offers.get('a-1')!, 1.5, true, OPTS).total).toBe(10.35);
    expect(unitPrice(cucumber, 6.9)).toEqual({ value: 6.9, per: 'לק"ג' });
  });

  it('computes price per 100 g', () => {
    expect(unitPrice(catalog.products.get(COTTAGE)!, 6.6)).toEqual({ value: 2.64, per: 'ל-100 גרם' });
  });
});

describe('catalog', () => {
  it('merges the same barcode across chains and keeps the fullest name', () => {
    const milk = catalog.products.get(MILK)!;
    expect(milk.offers.size).toBe(3);
    expect(milk.name).toBe('חלב 3% בקרטון 1 ליטר');
    expect(milk.manufacturer).toBe('תנובה');
  });

  it('separates chain-numbered produce codes and products sold by weight', () => {
    const c = buildCatalog(
      [
        data('a-1', [['7290000001524', 'בצל ירוק', '', 8.9, 1, 'u', 0]]),
        data('b-1', [['7290000001524', 'מולוצנייה', '', 39, 1000, 'g', 1], ['7290000644783', 'פילה דג', '', 60, 1000, 'g', 1]]),
        data('c-1', [['7290000644783', 'פילה דג', '', 25, 400, 'g', 0]]),
      ],
      stores,
    );
    expect(c.products.get('a:7290000001524')?.name).toBe('בצל ירוק');
    expect(c.products.get('b:7290000001524~kg')?.name).toBe('מולוצנייה');
    expect(c.products.get('7290000644783~kg')?.offers.has('b-1')).toBe(true);
    expect(c.products.get('7290000644783')?.offers.has('c-1')).toBe(true);
    expect(c.products.get('7290000644783')?.weighted).toBe(false);
  });

  it('keeps in-house codes separate per chain', () => {
    expect(catalog.products.has('a:1502~kg')).toBe(true);
    expect(catalog.products.has('b:88~kg')).toBe(true);
  });

  it('finds products by every word of the query, in any order', () => {
    expect(searchProducts(catalog, 'חלב 3%')[0].pid).toBe(MILK);
    expect(searchProducts(catalog, 'פרסי אורז')[0].pid).toBe(RICE);
    expect(searchProducts(catalog, 'שוקולד')).toEqual([]);
  });

  it('looks up scanned barcodes, with or without leading zeros', () => {
    expect(findByBarcode(catalog, `0${MILK}`)?.pid).toBe(MILK);
    expect(findByBarcode(catalog, '0000000000')).toBeNull();
  });

  it('suggests a similar product in a store that lacks the exact one', () => {
    const cucumber = catalog.products.get('a:1502~kg')!;
    expect(suggestSubstitutes(catalog, cucumber, 'b-1').map((p) => p.pid)).toEqual(['b:88~kg']);
  });

  describe('produce and stand-ins', () => {
    const shop = [store('a-1', 'a'), store('b-1', 'b'), store('c-1', 'c')];
    const produce = buildCatalog(
      [
        data('a-1', [
          ['7290000333333', 'עגבניות קצוצות יכין 240', 'יכין', 6.9, 240, 'g', 0],
          ['7290000444444', 'מלפפונים בחומץ 560 גרם', 'בית השיטה', 12.5, 560, 'g', 0],
          ['11', 'עגבניה', '', 8.9, 1000, 'g', 1],
          ['12', 'מלפפון', '', 6.9, 1000, 'g', 1],
          ['13', 'חזה עוף טרי ארוז', '', 44.9, 1000, 'g', 1],
        ]),
        data('b-1', [
          ['7290000333333', 'עגבניות קצוצות יכין 240', 'יכין', 7.6, 240, 'g', 0],
          ['7290000444444', 'מלפפונים בחומץ 560 גרם', 'בית השיטה', 11.9, 560, 'g', 0],
          ['21', 'עגבניה', '', 7.9, 1000, 'g', 1],
          ['22', 'חזה עוף קפוא', '', 37.9, 1000, 'g', 1],
          ['23', 'כנפיים עוף טרי ארוז', '', 24.9, 1000, 'g', 1],
          ['24', 'חזה עוף טרי שלם', '', 49.9, 1000, 'g', 1],
        ]),
        data('c-1', [['7290000333333', 'עגבניות קצוצות יכין 240', 'יכין', 7.2, 240, 'g', 0]]),
      ],
      shop,
    );

    it('finds fresh produce sold under the singular when the shopper writes the plural', () => {
      expect(searchProducts(produce, 'עגבניות')[0].name).toBe('עגבניה');
      expect(searchProducts(produce, 'מלפפונים')[0].name).toBe('מלפפון');
      // Asking for the canned product still finds it first.
      expect(searchProducts(produce, 'עגבניות קצוצות')[0].pid).toBe('7290000333333');
    });

    it('does not offer frozen for fresh, or another cut of the same animal', () => {
      const breast = produce.products.get('a:13~kg')!;
      expect(suggestSubstitutes(produce, breast, 'b-1').map((p) => p.name)).toEqual(['חזה עוף טרי שלם']);
    });
  });
});

describe('compareBasket', () => {
  it('ranks stores by what the whole basket costs', () => {
    const basket = [item('milk', [MILK]), item('rice', [RICE]), item('coffee', [COFFEE])];
    const c = compareBasket(basket, catalog, ['a-1', 'b-1'], OPTS);
    expect(c.quotes.map((q) => [q.storeId, q.total])).toEqual([
      ['b-1', 42.9],
      ['a-1', 49.2],
    ]);
  });

  it('does not let a store win just because it is missing items', () => {
    const basket = [item('milk', [MILK]), item('cottage', [COTTAGE]), item('coffee', [COFFEE])];
    const c = compareBasket(basket, catalog, ids, OPTS);
    const cStore = c.quotes.find((q) => q.storeId === 'c-1')!;
    expect(cStore.total).toBe(7.5);
    expect(cStore.missing).toEqual(['cottage', 'coffee']);
    expect(cStore.estimate).toBeGreaterThan(30);
    expect(c.quotes[0].storeId).toBe('b-1');
  });

  it('uses the cheapest acceptable product in each store', () => {
    const basket = [item('cucumber', ['a:1502~kg', 'b:88~kg'], 2)];
    const c = compareBasket(basket, catalog, ['a-1', 'b-1'], OPTS);
    expect(c.quotes[0]).toMatchObject({ storeId: 'b-1', total: 11.8 });
    expect(c.quotes[0].lines[0].pid).toBe('b:88~kg');
    expect(c.quotes[1]).toMatchObject({ storeId: 'a-1', total: 13.8 });
  });

  it('finds the two-store split and what it saves', () => {
    const basket = [item('milk', [MILK]), item('rice', [RICE]), item('coffee', [COFFEE]), item('cottage', [COTTAGE], 2)];
    const c = compareBasket(basket, catalog, ['a-1', 'b-1'], OPTS);
    // Best single store: b-1 = 6.9 + 15 + 21 + 12.2 = 55.1
    expect(c.quotes[0]).toMatchObject({ storeId: 'b-1', total: 55.1 });
    // Split: rice (12) and cottage 2-for-10 from a-1; milk (6.9) and coffee (21) from b-1.
    expect(c.split).not.toBeNull();
    expect(c.split!.total).toBe(49.9);
    expect(c.split!.saving).toBe(5.2);
    expect(c.split!.stores.map((s) => s.storeId).sort()).toEqual(['a-1', 'b-1']);
  });

  it('offers no split when one store is cheapest for everything', () => {
    const c = compareBasket([item('milk', [MILK]), item('coffee', [COFFEE])], catalog, ['a-1', 'b-1'], OPTS);
    expect(c.split).toBeNull();
  });

  it('separates lines that are not matched or not sold anywhere', () => {
    const basket = [item('free text', []), item('ghost', ['7290000999999']), item('milk', [MILK])];
    const c = compareBasket(basket, catalog, ids, OPTS);
    expect(c.unmatched.map((i) => i.id)).toEqual(['free text']);
    expect(c.unavailable.map((i) => i.id)).toEqual(['ghost']);
    expect(c.pricedCount).toBe(1);
  });
});

describe('parseShoppingList', () => {
  it('reads quantities written in the usual ways', () => {
    expect(parseShoppingList('2 חלב\nלחם x3\n- קוטג\nביצים 2\n• עגבניות - 4 יח\'\nx3 יוגורט')).toEqual([
      { label: 'חלב', qty: 2 },
      { label: 'לחם', qty: 3 },
      { label: 'קוטג', qty: 1 },
      { label: 'ביצים', qty: 2 },
      { label: 'עגבניות', qty: 4 },
      { label: 'יוגורט', qty: 3 },
    ]);
  });

  it('keeps pack sizes in the name and reads kilos', () => {
    expect(parseShoppingList('ביצים 12\n30 ביצים\n2 ק"ג עגבניות\nתפוחים חצי קילו')).toEqual([
      { label: 'ביצים 12', qty: 1 },
      { label: '30 ביצים', qty: 1 },
      { label: 'עגבניות', qty: 2, kg: true },
      { label: 'תפוחים', qty: 0.5, kg: true },
    ]);
  });

  it('reads decimal commas, curly quotes, a bare trailing kilo and counts of cucumbers', () => {
    expect(parseShoppingList('1,5 ק"ג עגבניות\nחצי ק”ג גבינה\nעגבניות קילו\n3 מלפפונים\n½ קילו בשר\nחלב, לחם')).toEqual([
      { label: 'עגבניות', qty: 1.5, kg: true },
      { label: 'גבינה', qty: 0.5, kg: true },
      { label: 'עגבניות', qty: 1, kg: true },
      { label: 'מלפפונים', qty: 3 },
      { label: 'בשר', qty: 0.5, kg: true },
      { label: 'חלב', qty: 1 },
      { label: 'לחם', qty: 1 },
    ]);
  });

  it('turns a quantity into kilos or whole packages once the product is known', () => {
    const pack500 = { weighted: false, qty: 500, unit: 'g' as const };
    const pack400 = { weighted: false, qty: 400, unit: 'g' as const };
    const byKilo = { weighted: true, qty: 1000, unit: 'g' as const };
    expect(fitQty(0.5, true, pack500)).toBe(1);
    expect(fitQty(0.5, true, pack400)).toBe(1);
    expect(fitQty(2, true, pack500)).toBe(4);
    expect(fitQty(1.5, false, pack500)).toBe(2);
    expect(fitQty(6, false, byKilo)).toBe(1);
    expect(fitQty(2, false, byKilo)).toBe(0.5);
    expect(fitQty(1.5, true, byKilo)).toBe(1.5);
    expect(fitQty(1, false, byKilo)).toBe(1);
  });

  it('prices produce chosen in one chain at the same produce in another', () => {
    const shop = [store('a-1', 'a'), store('b-1', 'b')];
    const c = buildCatalog(
      [data('a-1', [['11', 'עגבניה', '', 8.9, 1000, 'g', 1]]), data('b-1', [['21', 'עגבניה במשקל', '', 7.9, 1000, 'g', 1]])],
      shop,
    );
    const q = compareBasket([item('t', ['a:11~kg'])], c, ['a-1', 'b-1'], OPTS);
    expect(q.quotes.map((x) => [x.storeId, x.total, x.missing.length])).toEqual([
      ['b-1', 7.9, 0],
      ['a-1', 8.9, 0],
    ]);
  });

  it('does not mistake sizes and percentages for quantities', () => {
    expect(parseShoppingList('חלב 3%\n500 גרם בשר טחון\nשמן זית, מלח')).toEqual([
      { label: 'חלב 3%', qty: 1 },
      { label: '500 גרם בשר טחון', qty: 1 },
      { label: 'שמן זית', qty: 1 },
      { label: 'מלח', qty: 1 },
    ]);
  });
});
