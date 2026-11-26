import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { chooseBaseline, isStale, reuseRecord, selectCarryOver, shrinkProblems } from './carry.ts';
import { describeFile } from './chains.ts';
import {
  cleanAddress,
  isOnlineStorefront,
  isPseudoItem,
  normalizeCode,
  normalizeQuantity,
  parseNumber,
  quantityFromName,
  resolveCity,
} from './normalize.ts';
import {
  limitFromText,
  parsePriceFull,
  parsePromoFull,
  parseStores,
  perKiloFromGrams,
  pickPromos,
  type RawPromo,
} from './parse.ts';
import { decodeFile, tag } from './xml.ts';

const TODAY = '2026-11-20';

describe('decodeFile', () => {
  it('reads UTF-16 without a byte-order mark, and CDATA text', () => {
    const xml = '<Root><Item><ItemName><![CDATA[חלב & שוקו]]></ItemName></Item></Root>';
    expect(decodeFile(Buffer.from(xml, 'utf16le'))).toBe(xml);
    expect(tag(xml, 'ItemName')).toBe('חלב & שוקו');
  });

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
  it('drops web-address fragments some chains leave in store addresses', () => {
    expect(cleanAddress('דרך בר יהודה http 147')).toBe('דרך בר יהודה 147');
    expect(cleanAddress('האורגים http://ww 1')).toBe('האורגים 1');
    expect(cleanAddress('דרך הדרום http:// 1')).toBe('דרך הדרום 1');
    expect(cleanAddress('חורב 15 www.kulinarik.co.il/|')).toBe('חורב 15');
    expect(cleanAddress('שדרות הנשיא 134')).toBe('שדרות הנשיא 134');
  });

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

  it('does not take a factor from the shelf comparison unit', () => {
    expect(normalizeQuantity('450', '', '1 ק"ג', false, 'לחמניות')).toEqual({ qty: 450, unit: 'g' });
    expect(normalizeQuantity('1.5', '', 'ליטר', false, 'חלב 1.5 ליטר')).toEqual({ qty: 1500, unit: 'ml' });
  });

  it('reads "450 liters" of bread rolls as 450, since only that is believable', () => {
    expect(normalizeQuantity('450.00', 'ליטר', 'ליטר 1', false, '6 לחמניות רכות')).toEqual({ qty: 450, unit: 'ml' });
  });

  it('prefers the size in the name when the fields are off by a thousand', () => {
    expect(normalizeQuantity('1500', 'ליטר', '', false, 'חלב 1.5 ליטר')).toEqual({ qty: 1500, unit: 'ml' });
    expect(normalizeQuantity('3', 'גרם', '', false, 'בונזו 3 ק"ג')).toEqual({ qty: 3000, unit: 'g' });
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
    expect(map.get('111')).toMatchObject([{ minQty: 2, price: 12, club: false, end: '2026-11-28', desc: '2ב12 תירס' }]);
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
  const raw = (minQty: number, price: number, club = false, extra: Partial<RawPromo> = {}): RawPromo => ({
    minQty,
    price,
    club,
    end: '',
    desc: '',
    rawPrice: price,
    rate: null,
    basis: 'text',
    weighted: false,
    ...extra,
  });
  const deal = (minQty: number, price: number, club = false) => ({ minQty, price, club, end: '', desc: '' });

  it('drops deals that are not cheaper, or implausibly cheap', () => {
    expect(pickPromos(base, [raw(1, 10), raw(2, 21), raw(1, 0.5)])).toEqual([]);
  });

  it('keeps every bundle size that beats the smaller ones, and a better club price', () => {
    const picked = pickPromos(base, [raw(3, 21), raw(1, 9), raw(2, 18.5), raw(1, 6, true), raw(1, 8, true)]);
    // 2 for 18.50 (9.25 each) is no better than 1 for 9, so it adds nothing.
    expect(picked).toEqual([deal(3, 21), deal(1, 9), deal(1, 6, true)]);
  });

  it('keeps a middle bundle when it is a real step down in price', () => {
    const picked = pickPromos(base, [raw(1, 9), raw(2, 16), raw(4, 28)]);
    expect(picked).toEqual([deal(4, 28), deal(2, 16), deal(1, 9)]);
  });

  it('ignores a club price that does not beat the public one', () => {
    expect(pickPromos(base, [raw(1, 7), raw(1, 8, true)])).toEqual([deal(1, 7)]);
  });

  it('reads a bundle price as one unit when the discount rate says so', () => {
    // Shelf 169, "15% off" published as [2 units, 143.65]: 143.65 is 169 less 15%, i.e. one unit.
    const shelf = { ...base, price: 169 };
    const p = raw(2, 143.65, false, { basis: 'majority', rate: 15, rawPrice: 143.65 });
    expect(pickPromos(shelf, [p])).toEqual([deal(2, 287.3)]);
  });
});

describe('parsePromoFull: price conventions', () => {
  const file = (...promos: string[]) => `<Root><Promotions>${promos.join('')}</Promotions></Root>`;
  const one = (desc: string, code: string, minQty: string, price: string, weighted = '0') =>
    `<Promotion><PromotionDescription>${desc}</PromotionDescription><PromotionEndDateTime>2026-12-31</PromotionEndDateTime>
     <ClubID>0</ClubID><Groups><Group><PromotionItems><PromotionItem><ItemCode>${code}</ItemCode><RewardType>1</RewardType>
     <MinQty>${minQty}</MinQty><DiscountedPrice>${price}</DiscountedPrice><bIsWeighted>${weighted}</bIsWeighted>
     </PromotionItem></PromotionItems></Group></Groups></Promotion>`;
  const priceOf = (m: Map<string, RawPromo[]>, code: string) => m.get(code)?.map((p) => [p.minQty, p.price]);

  it('turns a per-unit price into the bundle total when the wording says "N for X"', () => {
    const m = parsePromoFull(file(one('אורז בסמטי 2 ב22', '1', '2', '11')), TODAY);
    expect(priceOf(m, '1')).toEqual([[2, 22]]);
  });

  it('leaves a bundle total alone', () => {
    const m = parsePromoFull(file(one('2ב12 תירס', '1', '2', '12')), TODAY);
    expect(priceOf(m, '1')).toEqual([[2, 12]]);
  });

  it('applies the file\'s own convention to deals without wording', () => {
    const m = parsePromoFull(
      file(
        one('אורז 2 ב22', '1', '2', '11'),
        one('פסטה 3 ב15', '2', '3', '5'),
        one('קפה 2 ב30', '3', '2', '15'),
        one('מבצע שבועי', '4', '2', '8'),
      ),
      TODAY,
    );
    expect(priceOf(m, '4')).toEqual([[2, 16]]);
  });

  it('reads weighed items by the kilo', () => {
    const m = parsePromoFull(
      file(one('חזה עוף 2 ב 59.90', '5', '2', '29.95', '1'), one('אבוקדו 14.90', '6', '0.01', '14.9', '1')),
      TODAY,
    );
    expect(priceOf(m, '5')).toEqual([[2, 59.9]]);
    expect(priceOf(m, '6')).toEqual([[1, 14.9]]);
  });

  it('restores the bundle size when it was published as one unit', () => {
    const m = parsePromoFull(file(one('שוקולד 2ב21.90ש', '7', '1', '10.95')), TODAY);
    expect(priceOf(m, '7')).toEqual([[2, 21.9]]);
  });

  it('drops online-only and minimum-basket deals and marks members-only wording as club', () => {
    const m = parsePromoFull(
      file(
        one('מבצע אונליין במבה', '8', '1', '3'),
        one('בקנייה מעל 75 ש"ח', '9', '1', '3'),
        one('מחיר לחברי מועדון', '10', '1', '3'),
      ),
      TODAY,
    );
    expect(m.has('8')).toBe(false);
    expect(m.has('9')).toBe(false);
    expect(m.get('10')?.[0].club).toBe(true);
  });

  it('reads compact end dates and comma decimals', () => {
    const xml = file(one('מבצע', '11', '1', '12,90').replace('2026-12-31', '20261231'));
    expect(parsePromoFull(xml, TODAY).get('11')?.[0]).toMatchObject({ price: 12.9, end: '2026-12-31' });
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

// ---- Audit fixes ----------------------------------------------------------------------------

describe('parseNumber', () => {
  it('reads a comma before exactly three digits as a thousands separator', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('12,345,678')).toBe(12345678);
  });

  it('still reads other commas as decimal points', () => {
    expect(parseNumber('12,90')).toBe(12.9);
    expect(parseNumber('0,500')).toBe(0.5);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('12.90')).toBe(12.9);
  });
});

describe('normalizeQuantity: believable sizes', () => {
  it('reads a small number next to a litre or kilo hint in litres or kilos', () => {
    expect(normalizeQuantity('3', '', 'ליטר', false, "ג'ל כביסה מרוכז 1.5")).toEqual({ qty: 3000, unit: 'ml' });
    expect(normalizeQuantity('3', '', 'ליטר', false, 'מקסימה גל כביסה קריס')).toEqual({ qty: 3000, unit: 'ml' });
    expect(normalizeQuantity('5', '', '1 ק"ג', false, 'חול לחתול')).toEqual({ qty: 5000, unit: 'g' });
    // A size the name confirms is still taken as written.
    expect(normalizeQuantity('15', '', 'ליטר', false, 'קרם עיניים 15 מל')).toEqual({ qty: 15, unit: 'ml' });
  });

  it('gives no size rather than an unbelievable one', () => {
    // Lettuce sold by the head, published as "1" against "100 מ"ל".
    expect(normalizeQuantity('1', '', '100 מ"ל', false, 'חסה סלנובה')).toEqual({ qty: 0, unit: '' });
    expect(normalizeQuantity('', '', '', false, 'פיירי לימון 1190 ליטר')).toEqual({ qty: 0, unit: '' });
  });

  it('keeps a tiny size the product name agrees with', () => {
    expect(normalizeQuantity('3', 'גרם', '', false, 'סופר גלו גל 3 גרם')).toEqual({ qty: 3, unit: 'g' });
  });

  it('lets the name correct the fields only when its own size is believable', () => {
    // The field says 1190 ml; "1190 ליטר" in the name is a typo, not 1,190,000 ml.
    expect(normalizeQuantity('1190', 'מ"ל', '', false, 'פיירי לימון 1190 ליטר')).toEqual({ qty: 1190, unit: 'ml' });
    expect(normalizeQuantity('3', 'גרם', '', false, 'בונזו 3 ק"ג')).toEqual({ qty: 3000, unit: 'g' });
  });

  it('reads a pack in the name as its total', () => {
    const sixPack = "מארז מים מינרלים מוגז 6* 1.5 ל' סאן בנדטו";
    expect(quantityFromName(sixPack)).toEqual({ qty: 9000, unit: 'ml' });
    expect(quantityFromName('שישיית בירה סטלה ארטואה 6X330 מ"ל')).toEqual({ qty: 1980, unit: 'ml' });
    expect(quantityFromName('בירה גולדסטאר בק6*330מ"ל')).toEqual({ qty: 1980, unit: 'ml' });
    expect(quantityFromName('רביעיית טונה פוסידון בשמן 4*108גר')).toEqual({ qty: 432, unit: 'g' });
    expect(quantityFromName("שלישיית תירס יכין 200*3 ג'")).toEqual({ qty: 600, unit: 'g' });
    // Dimensions are not sizes.
    expect(quantityFromName('שקית אשפה 90*75 עם ידיות')).toBeNull();
    // The fields giving one bottle of the pack: the pack's price is for all six.
    expect(normalizeQuantity('1.5', 'ליטר', '', false, sixPack)).toEqual({ qty: 9000, unit: 'ml' });
    expect(normalizeQuantity('9', 'ליטר', '', false, sixPack)).toEqual({ qty: 9000, unit: 'ml' });
    // "3" is the number of cans here, not 3 kilos.
    expect(normalizeQuantity('3', '', 'ק"ג', false, "שלישיית תירס יכין 200*3 ג'")).toEqual({ qty: 600, unit: 'g' });
  });

  it('reads a supplier carton code in the name as one item of it', () => {
    // "12*500גרם" on a 19.90 price is the carton the shop orders, not what the shopper buys.
    expect(quantityFromName('אסם פתי בר שוקו 12*500גרם')).toEqual({ qty: 500, unit: 'g' });
    expect(quantityFromName('קוקה קולה 6*1.5 ליטר')).toEqual({ qty: 1500, unit: 'ml' });
    expect(quantityFromName('ריו מרה טונה במים 80X3 גרם')).toEqual({ qty: 80, unit: 'g' });
    expect(quantityFromName("חטיפי סלים דלסי קידס 18.4ג'*5")).toEqual({ qty: 18.4, unit: 'g' });
    expect(normalizeQuantity('500', 'גרם', '', false, 'אסם פתי בר שוקו 12*500גרם')).toEqual({ qty: 500, unit: 'g' });
    expect(normalizeQuantity('0.5', '', 'ק"ג', false, 'אסם ספגטי 20*500גרם')).toEqual({ qty: 500, unit: 'g' });
  });
});

describe('resolveCity: street and area names', () => {
  it('does not take a city from a street or area phrase', () => {
    expect(resolveCity('', 'יפו מכללה יום ביום', 'רבנו ירוחם 2')).toBe('תל אביב - יפו');
    expect(resolveCity('', 'קאסם', 'התאנה , אזור תעשייה לב הארץ 5')).toBe('כפר קאסם');
    expect(resolveCity('', 'מוצקין - רבמ"ד', 'שדרות בן גוריון 80')).toBe('קרית מוצקין');
    expect(resolveCity('', 'סניף 5', 'שדרות ירושלים 170')).toBe('אחר');
    expect(resolveCity('', 'סניף 5', 'נתיבות המשפט 40')).toBe('אחר');
    expect(resolveCity('', 'סניף 5', "רח' חיפה 3")).toBe('אחר');
    expect(resolveCity('', 'יוניברס קריון- דרך עכו', 'דרך עכו 192')).toBe('אחר');
    // A city's name followed by a house number is a street.
    expect(resolveCity('', 'קרפור סיטי נאות רחל', 'אילת 36')).toBe('אחר');
  });

  it('still finds the city when it is the city', () => {
    expect(resolveCity('', 'שדרות - קופנהגן', 'קופנהגן 1')).toBe('שדרות');
    expect(resolveCity('', 'יש חסד שדרות', '19 אריאל שרון')).toBe('שדרות');
    expect(resolveCity('', 'סופר-פארם', 'סמטת הפלדה 1 שדרות')).toBe('שדרות');
    expect(resolveCity('', 'סופר-פארם דרך מצדה ב"ש', 'דרך מצדה 4')).toBe('באר שבע');
  });

  it('reads short city names in store names', () => {
    expect(resolveCity('', 'יהוד - מקלב', 'מקלב 8')).toBe('יהוד-מונוסון');
    expect(resolveCity('', 'חיים ויצמן מודיעין', 'חיים ויצמן 8')).toBe('מודיעין-מכבים-רעות');
    expect(resolveCity('', 'נטו ח. מודיעין עלית* ת.', 'יחזקאל 2')).toBe('מודיעין עילית');
    expect(resolveCity('', 'קרפור כרכור', 'שדרות מחנה שמונים 4')).toBe('פרדס חנה-כרכור');
    // But not in addresses, where they are streets.
    expect(resolveCity('', 'סניף 5', 'מוצקין 12')).toBe('אחר');
  });
});

describe('isOnlineStorefront', () => {
  it('flags online shops and delivery storefronts', () => {
    for (const name of [
      'אתר משנת יוסף',
      'חצי חינם משלוחים',
      '97 אינטרנט',
      'סניף קליק וסע',
      'שופרסל ONLINE',
      'אונליין - אור ים',
      'סופר-פארם אתר סחר',
      'וולט מרקט',
    ]) {
      expect(isOnlineStorefront(name), name).toBe(true);
    }
  });

  it('leaves shops alone', () => {
    for (const name of ['קרפור סיטי אבן יהודה', 'שדרות', 'קניון אתרים', 'משען', 'סניף 16']) {
      expect(isOnlineStorefront(name), name).toBe(false);
    }
  });
});

describe('isPseudoItem', () => {
  it('flags coupons, deposits, delivery fees and departments', () => {
    for (const name of [
      'קופון ציפר',
      'קופון 200ג ב11.90ש',
      'הנ.קופון מגבוני בייבי סיסטר',
      'ה.נ קופון אלפרו 1לי',
      'הנחת קופון נימה מילסטון',
      'קוד קופון הקרן לידידות',
      'פיקדון 0.30',
      'פקדון בקבוק 0.30 שח',
      'אריזת פקדון(חוק פקדון)',
      'דמי משלוח',
      'משלוח אונליין דימונה',
      'משלוחים מוזלים',
      'הובלה פנימית',
      'מחלקת ירקות',
      'מחלקה כללית רב קו',
      'כללי',
      'כללי חומרי ניקוי',
    ]) {
      expect(isPseudoItem(name, 10), name).toBe(true);
    }
    expect(isPseudoItem('שקית גופיה גדול', 0.2)).toBe(true);
    expect(isPseudoItem('שקית ניילון ממותגת ללחמניות', 0.5)).toBe(true);
  });

  it('keeps real products that mention the same words', () => {
    for (const name of [
      '10 שקיות אשפה 50 ליטר',
      'קולה 0.5 חייב פקדון',
      'משלוח מנות בשקית צלו',
      'שקית למשלוח מנות דגם 634',
      'מיקס למרק-מחלקת ירקות',
      'אבקת קארי שקית 80 גר',
    ]) {
      expect(isPseudoItem(name, 10), name).toBe(false);
    }
    // A pack of bags on the shelf, and a reusable bag, are products.
    expect(isPseudoItem('שקיות גופיה גדולות', 9.9)).toBe(false);
    expect(isPseudoItem('שקית רב פעמית', 1.9)).toBe(false);
  });
});

describe('parsePriceFull: placeholders', () => {
  it('drops placeholder prices and rows that are not products', () => {
    const xml = `<Root><StoreID>1</StoreID><Items>
      ${item('7290012016004', 'פסיפלורה ארוז 500 גר', '0.01')}
      ${item('7290019621713', 'אורז בסמטי 375 ג', '0.19')}
      ${item('100', 'קופון ציפר', '10.00')}
      ${item('101', 'פיקדון בקבוקים', '0.30')}
      ${item('7290000000002', 'במבה 80 גרם', '0.50')}
    </Items></Root>`;
    expect([...parsePriceFull(xml).items.keys()]).toEqual(['7290000000002']);
  });
});

describe('weighed deli deals', () => {
  const file = (...promos: string[]) => `<Root><Promotions>${promos.join('')}</Promotions></Root>`;
  const weighed = (desc: string, code: string, minQty: string, price: string) =>
    `<Promotion><PromotionDescription>${desc}</PromotionDescription><PromotionEndDateTime>2026-12-31</PromotionEndDateTime>
     <ClubID>0</ClubID><Groups><Group><PromotionItems><PromotionItem><ItemCode>${code}</ItemCode><RewardType>3</RewardType>
     <MinQty>${minQty}</MinQty><DiscountedPrice>${price}</DiscountedPrice><bIsWeighted>1</bIsWeighted>
     </PromotionItem></PromotionItems></Group></Groups></Promotion>`;
  const priceOf = (m: Map<string, RawPromo[]>, code: string) => m.get(code)?.map((p) => [p.minQty, p.price]);
  const deli = { code: '1', name: 'פסטרמה הודו מעושנת טירת צבי', manufacturer: '', price: 99, qty: 1000, unit: 'g' as const, weighted: true };

  it('turns "250 ג ב 19.9" into a price per kilo', () => {
    // kingstore: shelf 99 a kilo; the deal was stored as 19.90 a kilo.
    const m = parsePromoFull(file(weighed('פסטרמות/נקניק טירת צבי 250 ג ב 19.9', '1', '0.25', '19.9')), TODAY);
    expect(priceOf(m, '1')).toEqual([[1, 79.6]]);
    expect(pickPromos(deli, m.get('1'))).toMatchObject([{ minQty: 1, price: 79.6 }]);
  });

  it('reads the gram wording whatever the minimum says', () => {
    const m = parsePromoFull(
      file(
        weighed('מגוון פסטרמות יחיעם 250 גרם ב20', '2', '1', '20'),
        weighed('פסטרמות יחיעם 250 גר ב-21.90', '3', '1', '21.9'),
        weighed('גבינה צהובה נעם 15% 200ג ב15ש:', '4', '1', '75'),
        weighed('מגוון פסטרמות מעדניה ב7.90ש ל100ג', '5', '1', '79'),
        weighed('אודסקיה ב 8.50 ל 100 גר', '6', '1', '85'),
        // Cut short: the published price is the package's.
        weighed('מגוון פסטרמות עוף טוב במעדניה 300 גר ב', '7', '1', '19.9'),
      ),
      TODAY,
    );
    expect(priceOf(m, '2')).toEqual([[1, 80]]);
    expect(priceOf(m, '3')).toEqual([[1, 87.6]]);
    expect(priceOf(m, '4')).toEqual([[1, 75]]);
    expect(priceOf(m, '5')).toEqual([[1, 79]]);
    expect(priceOf(m, '6')).toEqual([[1, 85]]);
    expect(priceOf(m, '7')).toEqual([[1, 66.33]]);
    expect(perKiloFromGrams('2 ק"ג ב 59.90', 59.9)).toBeNull();
  });

  it('reads a minimum under a kilo as the package it is', () => {
    const m = parsePromoFull(file(weighed('סלמי במבצע', '8', '0.5', '30')), TODAY);
    expect(priceOf(m, '8')).toEqual([[1, 60]]);
  });

  it('drops a package deal that is not cheaper per kilo than the shelf', () => {
    const m = parsePromoFull(file(weighed('פסטרמות/נקניק טירת צבי 250 ג ב 19.9', '1', '0.25', '19.9')), TODAY);
    expect(pickPromos({ ...deli, price: 70 }, m.get('1'))).toEqual([]);
  });
});

describe('purchase limits', () => {
  it('reads real limit wording', () => {
    expect(limitFromText("עד 6 יח'")).toBe(6);
    expect(limitFromText('מוגבל ל-2')).toBe(2);
    expect(limitFromText('מקסימום 4')).toBe(4);
    expect(limitFromText("מקס' 2 יח'")).toBe(2);
    expect(limitFromText('אורז בסמטי 5קג מחנה יהודה ב19.90ש מוגבל 3 מנות')).toBe(3);
    expect(limitFromText('בננה ב6.90ש עד3ק')).toBe(3);
    expect(limitFromText('אבטיח ב4.9 מוגבל ל12')).toBe(12);
    expect(limitFromText('כבד עוף טרי מחפוד ב29.90ש"ח מוגבל ל4ק"ג')).toBe(4);
    expect(limitFromText("וויסקי מקאלן 700מ\"ל 12ב249.90ש* עד2יח")).toBe(2);
    expect(limitFromText('תה שחור נענע 25 שקיקיםמוגבל 3')).toBe(3);
  });

  it('does not read brands or sizes as limits', () => {
    expect(limitFromText('שישיית פפסי מקס 1.5 ל ב 32.90')).toBe(0);
    expect(limitFromText('חטיף חלבון פרוטאין מקס 2-ב-22')).toBe(0);
    expect(limitFromText('משחת שיניים לילדים אלמקס 75 מ ל')).toBe(0);
    expect(limitFromText('מיקסמקס 3 יח')).toBe(0);
    expect(limitFromText('קולגייט מקס 125מ"ל 2ב29.90ש')).toBe(0);
    expect(limitFromText('פודינג אסם עד 500 גרם')).toBe(0);
    expect(limitFromText('חטיפי אסם עד 80 גרם 9ב30')).toBe(0);
    expect(limitFromText('קרם לחות לגבר עד 48 שעות 75 מ"ל')).toBe(0);
    expect(limitFromText('מוגבל 500 גרם')).toBe(0);
  });

  it('keeps invented limits out of the stored deals', () => {
    const one = (desc: string, code: string, minQty: string, price: string) =>
      `<Promotion><PromotionDescription>${desc}</PromotionDescription><PromotionEndDateTime>2026-12-31</PromotionEndDateTime>
       <ClubID>0</ClubID><Groups><Group><PromotionItems><PromotionItem><ItemCode>${code}</ItemCode><RewardType>3</RewardType>
       <MinQty>${minQty}</MinQty><DiscountedPrice>${price}</DiscountedPrice></PromotionItem></PromotionItems></Group></Groups></Promotion>`;
    const m = parsePromoFull(
      `<Root>${one('שישיית פפסי מקס 1.5 ל ב 32.90', '2', '1', '32.9')}${one('חטיף חלבון פרוטאין מקס 2-ב-22', '3', '2', '22')}${one('קפה נמס ב 24.90 מוגבל 6 יח\'', '4', '1', '24.9')}</Root>`,
      TODAY,
    );
    expect(m.get('2')?.[0].maxQty).toBeUndefined();
    expect(m.get('3')?.[0].maxQty).toBeUndefined();
    expect(m.get('4')?.[0].maxQty).toBe(6);
  });
});

describe('selectCarryOver: newest wins', () => {
  it('keeps the newer copy when two earlier runs have the same store', () => {
    const folder = { id: 'carrefour-1', u: '2026-11-19T05:00', from: 'folder' };
    const site = { id: 'carrefour-1', u: '2026-11-20T05:00', from: 'site' };
    expect(selectCarryOver([folder, site], new Set(), '2026-11-21')).toEqual([site]);
    // On a tie the first listed (the local folder) wins.
    expect(selectCarryOver([folder, { ...site, u: folder.u }], new Set(), '2026-11-21')).toEqual([folder]);
  });
});

describe('reuseRecord', () => {
  it('records new files only for stores built from them', () => {
    const built = new Map([['a-1', 'new-a1']]);
    const previous = new Map([
      ['a-1', 'old-a1'],
      ['a-2', 'old-a2'],
      ['a-3', 'old-a3'],
    ]);
    // a-2 failed to download this run and was carried from the folder; a-3 came from the site.
    const record = reuseRecord(['a-1', 'a-2', 'a-3'], built, new Set(['a-2']), previous);
    expect(record).toEqual({ 'a-1': 'new-a1', 'a-2': 'old-a2' });
  });
});

describe('deploy guard', () => {
  const stores = (c: string, n: number, u = '2026-11-20T05:00') => Array.from({ length: n }, () => ({ c, u }));

  it('stops a run in which a chain lost most of its stores', () => {
    const before = [...stores('shufersal', 400), ...stores('carrefour', 145), ...stores('hcohen', 5)];
    const after = [...stores('shufersal', 400)];
    expect(shrinkProblems(before, after, TODAY)).toEqual([
      'carrefour: 145 → 0 stores',
      'hcohen: 5 → 0 stores',
      'all chains: 550 → 400 stores',
    ]);
  });

  it('lets ordinary changes through', () => {
    const before = [...stores('shufersal', 400), ...stores('mishnatyosef', 1), ...stores('hcohen', 5)];
    // A branch or two closing, a one-store chain dropping out.
    const after = [...stores('shufersal', 395), ...stores('hcohen', 4)];
    expect(shrinkProblems(before, after, TODAY)).toEqual([]);
  });

  it('stops a run that lost a fifth of everything, even spread across chains', () => {
    const before = [...stores('a', 100), ...stores('b', 100)];
    const after = [...stores('a', 75), ...stores('b', 75), ...stores('c', 50)];
    expect(shrinkProblems(before, after, TODAY)).toEqual(['all chains: 200 → 150 stores']);
  });

  it('does not count stores the earlier set would have dropped for age, or chains not compared', () => {
    const before = [...stores('a', 100), ...stores('b', 50, '2026-11-01T05:00'), ...stores('c', 50)];
    const after = stores('a', 100);
    expect(shrinkProblems(before, after, TODAY, new Set(['a', 'b']))).toEqual([]);
  });

  it('compares with the site, else with the chains the fallback holds, else fails when the site was asked for', () => {
    const site = [{ c: 'shufersal' }, { c: 'carrefour' }];
    const folder = [{ c: 'carrefour' }];
    const all = ['shufersal', 'carrefour', 'victory'];
    expect(chooseBaseline(site, folder, true, all)).toMatchObject({ from: 'site', chains: new Set(all) });
    expect(chooseBaseline(null, folder, true, all)).toMatchObject({ from: 'folder', chains: new Set(['carrefour']) });
    expect(chooseBaseline(null, null, true, all).error).toBeTruthy();
    // A local run without --previous-url has nothing to compare with, and that is fine.
    expect(chooseBaseline(null, null, false, all)).toMatchObject({ stores: null });
    expect(chooseBaseline(null, null, false, all).error).toBeUndefined();
  });
});

describe('deploy guard and unplaced stores', () => {
  it('does not count stores with no address and no city', async () => {
    const { shrinkProblems } = await import('./carry.ts');
    const named = Array.from({ length: 29 }, () => ({ c: 'kingstore', u: '2026-11-25T08:00', city: 'חיפה', a: 'הרצל 1' }));
    const nameless = Array.from({ length: 19 }, () => ({ c: 'kingstore', u: '2026-11-25T08:00', city: 'אחר', a: '' }));
    expect(shrinkProblems([...named, ...nameless], named, '2026-11-25')).toEqual([]);
    expect(shrinkProblems([...named, ...nameless], named.slice(0, 10), '2026-11-25')).toContain('kingstore: 29 → 10 stores');
  });
});

describe('club field', () => {
  it('reads "everyone" the way each chain writes it', async () => {
    const { isEveryoneClub } = await import('./parse.ts');
    for (const t of ['', '0', '0 - כלל הלקוחות', '0=אין', ' 0=אין ', 'אין']) expect(isEveryoneClub(t)).toBe(true);
    for (const t of ['2=לייף סטייל', '1', '10 - חברי מועדון', '01']) expect(isEveryoneClub(t)).toBe(false);
  });
});

describe('hand-checked store cities', () => {
  it('puts the checked city on the store, and every such city has coordinates', async () => {
    const { applyStoreCities, loadStoreCities } = await import('./normalize.ts');
    const { readFileSync } = await import('node:fs');
    const cities = loadStoreCities();
    const stores = [
      { id: 'keshet-16', city: 'אחר' },
      { id: 'shufersal-1', city: 'תל אביב - יפו' },
    ];
    expect(applyStoreCities(stores, cities)).toBe(1);
    expect(stores[0].city).toBe('חיפה');
    expect(stores[1].city).toBe('תל אביב - יפו');
    const coords = JSON.parse(readFileSync(new URL('../data/city-coords.json', import.meta.url), 'utf8'));
    expect(Object.values(cities).filter((c) => !coords[c])).toEqual([]);
  });
});
