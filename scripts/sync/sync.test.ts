import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isStale, selectCarryOver } from './carry.ts';
import { describeFile } from './chains.ts';
import { normalizeCode, normalizeQuantity, quantityFromName, resolveCity } from './normalize.ts';
import { parsePriceFull, parsePromoFull, parseStores, pickPromos } from './parse.ts';
import { decodeFile } from './xml.ts';

const TODAY = '2026-11-20';

describe('decodeFile', () => {
  it('reads gzip, UTF-8 with BOM and UTF-16 files', () => {
    const xml = '<Root><StoreName>שלום</StoreName></Root>';
    expect(decodeFile(gzipSync(Buffer.from(xml)))).toBe(xml);
    expect(decodeFile(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml)]))).toBe(xml);
    expect(decodeFile(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]))).toBe(xml);
  });
});

describe('describeFile', () => {
  it('reads the store and timestamp out of a file name', () => {
    expect(describeFile('PriceFull7290027600007-001-017-20261120-043100.gz', 'u')).toMatchObject({
      kind: 'pricefull',
      storeId: '17',
      stamp: '20261120043100',
    });
    expect(describeFile('promofull7290058140886-001-002-20261120-001017.gz', 'u')).toMatchObject({
      kind: 'promofull',
      storeId: '2',
    });
    expect(describeFile('Stores7290055700007-000-20261120-000100.xml', 'u')?.kind).toBe('stores');
  });

  it('ignores the partial update files', () => {
    expect(describeFile('Price7290027600007-001-017-20261120-150000.gz', 'u')).toBeNull();
    expect(describeFile('Promo7290027600007-001-017-20261120-150000.gz', 'u')).toBeNull();
  });
});

describe('normalize', () => {
  it('strips leading zeros and non-digits from barcodes', () => {
    expect(normalizeCode('0007290000066318')).toBe('7290000066318');
    expect(normalizeCode(' 1502 ')).toBe('1502');
  });

  it('normalizes package sizes to grams and millilitres', () => {
    expect(normalizeQuantity('439.00', 'גרם', '100 גרם', false, 'שעועית')).toEqual({ qty: 439, unit: 'g' });
    expect(normalizeQuantity('1.5', 'ליטר', 'ליטר', false, 'קולה')).toEqual({ qty: 1500, unit: 'ml' });
    expect(normalizeQuantity('1.32', 'לא ידוע', 'ליטר', false, 'רביעיית פחיות')).toEqual({ qty: 1320, unit: 'ml' });
    expect(normalizeQuantity('2', 'קילוגרם', '', false, 'סוכר')).toEqual({ qty: 2000, unit: 'g' });
  });

  it('treats weighted items as priced per kilogram', () => {
    expect(normalizeQuantity('0', '', '', true, 'מלפפון')).toEqual({ qty: 1000, unit: 'g' });
  });

  it('falls back to the size written in the product name', () => {
    expect(normalizeQuantity('', 'לא ידוע', '', false, 'טונה בשמן 160 גרם')).toEqual({ qty: 160, unit: 'g' });
    expect(quantityFromName('שמן זית 750 מ"ל')).toEqual({ qty: 750, unit: 'ml' });
    expect(quantityFromName('במבה')).toBeNull();
  });

  it('resolves cities from CBS codes, free text and store names', () => {
    expect(resolveCity('4000', '', '')).toBe('חיפה');
    expect(resolveCity('תל אביב', '', '')).toBe('תל אביב - יפו');
    // Spelling variants ("קריית" / "קרית") land on the official CBS spelling.
    expect(resolveCity('קריית אונו', '', '')).toBe('קרית אונו');
    expect(resolveCity('', 'שלי חיפה- חורב', 'חורב 15')).toBe('חיפה');
    expect(resolveCity('0', 'סניף מרכזי', '')).toBe('אחר');
  });
});

describe('parseStores', () => {
  it('reads stores with their sub-chain, tolerating sloppy closing tags', () => {
    const xml = `<Root><ChainName>שופרסל</ChainName><SubChains>
      <SubChain><SubChainID>2</SubChainID><SubChainName>שופרסל דיל</SubChainName><Stores>
        <Store><StoreID>017</StoreID><StoreName >דיל חיפה</StoreName ><Address>שמחה גולן 54</Address><City>4000</City></Store>
      </Stores></SubChain></SubChains></Root>`;
    const { chainName, stores } = parseStores(xml);
    expect(chainName).toBe('שופרסל');
    expect(stores.get('17')).toEqual({
      storeId: '17',
      name: 'דיל חיפה',
      address: 'שמחה גולן 54',
      city: '4000',
      subChain: 'שופרסל דיל',
    });
  });
});

const item = (code: string, name: string, price: string, extra = '') =>
  `<Item><ItemCode>${code}</ItemCode><ItemName>${name}</ItemName><ManufactureName>לא ידוע</ManufactureName>
   <UnitQty>גרם</UnitQty><Quantity>250</Quantity><bIsWeighted>0</bIsWeighted><ItemPrice>${price}</ItemPrice>${extra}</Item>`;

describe('parsePriceFull', () => {
  const xml = `<Root><ChainID>1</ChainID><StoreID>017</StoreID><Items>
    ${item('7290004127329', 'קוטג&apos; 5%', '6.60')}
    ${item('7290000000001', 'ללא מחיר', '0.00')}
    ${item('', 'ללא קוד', '5.00')}
  </Items></Root>`;

  it('keeps priced, named items and drops the rest', () => {
    const { storeId, items } = parsePriceFull(xml);
    expect(storeId).toBe('17');
    expect([...items.keys()]).toEqual(['7290004127329']);
    expect(items.get('7290004127329')).toEqual({
      code: '7290004127329',
      name: "קוטג' 5%",
      manufacturer: '',
      price: 6.6,
      qty: 250,
      unit: 'g',
      weighted: false,
    });
  });
});

const promo = (opts: {
  desc: string;
  items: string;
  club?: string;
  coupon?: string;
  end?: string;
  minPurchase?: string;
}) => `<Promotion><PromotionDescription>${opts.desc}</PromotionDescription>
  <PromotionStartDateTime>2026-11-01T00:00:00.000</PromotionStartDateTime>
  <PromotionEndDateTime>${opts.end ?? '2026-11-28'}T23:59:00.000</PromotionEndDateTime>
  <ClubID>${opts.club ?? '0'}</ClubID><AdditionalIsCoupon>${opts.coupon ?? '0'}</AdditionalIsCoupon>
  <Groups><Group><MinPurchaseAmount>${opts.minPurchase ?? ''}</MinPurchaseAmount><PromotionItems>${opts.items}</PromotionItems></Group></Groups>
</Promotion>`;

const promoItem = (code: string, reward: string, minQty: string, price: string) =>
  `<PromotionItem><ItemCode>${code}</ItemCode><RewardType>${reward}</RewardType><MinQty>${minQty}</MinQty><DiscountedPrice>${price}</DiscountedPrice></PromotionItem>`;

describe('parsePromoFull', () => {
  const parse = (...promos: string[]) => parsePromoFull(`<Root><Promotions>${promos.join('')}</Promotions></Root>`, TODAY);

  it('reads "N for a total" and fixed-price deals', () => {
    const map = parse(
      promo({ desc: '2ב12 תירס', items: promoItem('111', '1', '2.00', '12.00') }),
      promo({ desc: '12.90 דבש', items: promoItem('222', '3', '1.00', '12.90') }),
      promo({ desc: 'חטיפים 6 ב-25', items: promoItem('333', '10', '6', '25.00') + promoItem('444', '10', '6', '25.00') }),
    );
    expect(map.get('111')).toEqual([{ minQty: 2, price: 12, club: false, end: '2026-11-28', desc: '2ב12 תירס' }]);
    expect(map.get('222')?.[0]).toMatchObject({ minQty: 1, price: 12.9 });
    expect(map.get('333')?.[0]).toMatchObject({ minQty: 6, price: 25 });
    expect(map.get('444')?.[0]).toMatchObject({ minQty: 6, price: 25 });
  });

  it('marks club-only deals', () => {
    const map = parse(
      promo({ desc: 'מחיר מועדון', club: '2 - מועדון אשראי', items: promoItem('111', '3', '1', '9.90') }),
      promo({ desc: 'לכולם', club: '0 - כלל הלקוחות', items: promoItem('222', '3', '1', '9.90') }),
    );
    expect(map.get('111')?.[0].club).toBe(true);
    expect(map.get('222')?.[0].club).toBe(false);
  });

  it('skips deals the shopper may not actually get', () => {
    const map = parse(
      promo({ desc: 'קופון דבש מתנה', coupon: '1', items: promoItem('1', '2', '1', '5.00') }),
      promo({ desc: 'בקניה מעל 100', minPurchase: '100.00', items: promoItem('2', '3', '1', '5.00') }),
      promo({ desc: 'פג תוקף', end: '2026-11-10', items: promoItem('3', '3', '1', '5.00') }),
      promo({ desc: 'חטיפים 1 והשני בחצי מחיר', items: promoItem('4', '2', '1', '5.00') }),
      promo({ desc: 'שוקולד 1+1', items: promoItem('5', '2', '1', '5.00') }),
      // An item with reward type 0 only triggers the deal; the rest are conditional on it.
      promo({ desc: 'מארז', items: promoItem('6', '0', '1', '') + promoItem('7', '2', '1', '5.00') }),
      // Percentage deals on several units are ambiguous.
      promo({ desc: 'אחוזים', items: promoItem('8', '2', '3', '5.00') }),
    );
    expect(map.size).toBe(0);
  });
});

describe('pickPromos', () => {
  const base = { code: '1', name: 'x', manufacturer: '', price: 10, qty: 0, unit: '' as const, weighted: false };
  const deal = (minQty: number, price: number, club = false) => ({ minQty, price, club, end: '', desc: '' });

  it('drops deals that are not cheaper, or implausibly cheap', () => {
    expect(pickPromos(base, [deal(1, 10), deal(2, 21), deal(1, 0.5)])).toEqual([]);
  });

  it('keeps the best public deal, a single-unit fallback and a better club price', () => {
    const picked = pickPromos(base, [deal(3, 21), deal(1, 9), deal(2, 18.5), deal(1, 6, true), deal(1, 8, true)]);
    expect(picked).toEqual([deal(3, 21), deal(1, 9), deal(1, 6, true)]);
  });

  it('ignores a club price that does not beat the public one', () => {
    expect(pickPromos(base, [deal(1, 7), deal(1, 8, true)])).toEqual([deal(1, 7)]);
  });
});

describe('selectCarryOver', () => {
  const entry = (id: string, u: string) => ({ id, u });

  it('keeps recent stores this run did not produce', () => {
    const previous = [entry('a-1', '2026-11-20T04:00'), entry('a-2', '2026-11-19T04:00'), entry('b-1', '2026-11-20T05:00')];
    const kept = selectCarryOver(previous, new Set(['a-1']), '2026-11-21');
    expect(kept.map((e) => e.id)).toEqual(['a-2', 'b-1']);
  });

  it('lets stores with old prices go', () => {
    const previous = [entry('fresh', '2026-11-10T04:00'), entry('stale', '2026-11-01T04:00'), entry('undated', '')];
    expect(selectCarryOver(previous, new Set(), '2026-11-21').map((e) => e.id)).toEqual(['fresh']);
  });

  it('never returns the same store twice', () => {
    const previous = [entry('a-1', '2026-11-20T04:00'), entry('a-1', '2026-11-20T04:00')];
    expect(selectCarryOver(previous, new Set(), '2026-11-21')).toHaveLength(1);
  });
});

describe('isStale', () => {
  it('flags price lists older than two weeks', () => {
    expect(isStale('2026-11-20T04:31', '2026-11-21')).toBe(false);
    expect(isStale('2026-11-07T04:31', '2026-11-21')).toBe(false);
    expect(isStale('2026-11-06T04:31', '2026-11-21')).toBe(true);
    expect(isStale('2024-03-28T10:00', '2026-11-21')).toBe(true);
  });

  it('does not drop a store over a date it cannot read', () => {
    expect(isStale('', '2026-11-21')).toBe(false);
  });
});
