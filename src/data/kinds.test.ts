import { describe, expect, it } from 'vitest';
import { compareBasket, lineKind } from '../engine/optimizer';
import type { ListItem, Product, StoreInfo } from '../types';
import { buildCatalog } from './catalog';
import { kindOf } from './kinds';

const product = (name: string, weighted = true, qty = 1000, unit: Product['unit'] = 'g'): Product => ({
  pid: name,
  code: name,
  name,
  manufacturer: '',
  qty,
  unit,
  weighted,
  norm: name,
  offers: new Map(),
});
const kind = (name: string, weighted = true) => kindOf(product(name, weighted))?.id ?? null;

describe('staple kinds', () => {
  it('knows fresh produce, meat, fish and eggs by their names', () => {
    expect(kind('עגבניה')).toBe('tomato');
    expect(kind('עגבנייה ישראל')).toBe('tomato');
    expect(kind('עגבניות שרי לובלו שקיל')).toBe('cherry-tomato');
    expect(kind('בצל יבש')).toBe('onion');
    expect(kind('תפו"א אדום ארוז')).toBe('potato');
    expect(kind('חזה עוף טרי.')).toBe('chicken-breast');
    expect(kind('בשר טחון טרי')).toBe('ground-beef');
    expect(kind('פילה אמנון טרי')).toBe('tilapia-fillet');
    expect(kind('שום יבש תפזורת')).toBe('garlic');
    expect(kind('ביצים 18 יח L פיקוח מ.לסר', false)).toBe('eggs-L-18');
    expect(kind('ביצים 12 יחידות M פיקוח', false)).toBe('eggs-M-12');
  });

  it('leaves out prepared, frozen, smoked, dried and look-alike products', () => {
    expect(kind('גאודה עגבניות וזיתים שקיל')).toBeNull();
    expect(kind('בורקס תפו"א בייתי')).toBeNull();
    expect(kind('כבד עוף עם בצל')).toBeNull();
    expect(kind('חציל בטחינה')).toBeNull();
    expect(kind('חזה עוף חצוי ע"ע טרי')).toBeNull();
    expect(kind('בשר מס 10 צוואר בקר')).toBeNull();
    expect(kind('פילה אמנון 5-7 בוואקום')).toBeNull();
    expect(kind('סלמון הילטון מצונן')).toBeNull();
    expect(kind('מנגו דל סוכר')).toBeNull();
    expect(kind('לימון פרסי שחור')).toBeNull();
    expect(kind('שומר שלם')).toBeNull();
    expect(kind('שומשום')).toBeNull();
    expect(kind('ביצי חופש L 12', false)).toBeNull();
    // Canned tomatoes are not sold by the kilo.
    expect(kind('עגבניות קצוצות יכין 240', false)).toBeNull();
  });
});

describe('pricing a staple by kind', () => {
  const store = (id: string, chainId: string): StoreInfo => ({
    id,
    chainId,
    name: id,
    sub: '',
    city: 'חיפה',
    address: '',
    updatedAt: '2026-11-25T04:00',
    itemCount: 0,
    file: '',
    size: 0,
  });
  const stores = [store('a-1', 'a'), store('b-1', 'b'), store('c-1', 'c')];
  const catalog = buildCatalog(
    [
      { id: 'a-1', u: '', items: [['11', 'עגבניה', '', 8.9, 1000, 'g', 1]] },
      {
        id: 'b-1',
        u: '',
        items: [
          ['21', 'עגבניות ישראל', '', 6.9, 1000, 'g', 1],
          ['22', 'עגבניה פרימיום', '', 12.9, 1000, 'g', 1],
        ],
      },
      // Only a deli salad sold under the name: not the vegetable.
      { id: 'c-1', u: '', items: [['31', 'עגבניות', '', 59, 1000, 'g', 1]] },
    ],
    stores,
  );
  const line = (extra: Partial<ListItem> = {}): ListItem => ({
    id: 't',
    label: 'עגבניה',
    qty: 2,
    pids: ['a:11~kg'],
    checked: false,
    addedAt: 0,
    ...extra,
  });
  const opts = { includeClub: false, today: '2026-11-25' };

  it('takes the cheapest product of the kind in each store, and not a price five times the usual', () => {
    expect(lineKind(line(), catalog)).toBe('tomato');
    const c = compareBasket([line()], catalog, ['a-1', 'b-1', 'c-1'], opts);
    expect(c.quotes.map((q) => [q.storeId, q.total, q.missing.length])).toEqual([
      ['b-1', 13.8, 0],
      ['a-1', 17.8, 0],
      ['c-1', 0, 1],
    ]);
  });

  it('prices only the chosen product when the shopper asks for exactly that', () => {
    expect(lineKind(line({ exact: true }), catalog)).toBeNull();
  });
});
