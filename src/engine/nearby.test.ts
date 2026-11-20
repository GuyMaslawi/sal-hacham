import { describe, expect, it } from 'vitest';
import type { DataIndex, StoreInfo } from '../types';
import { distanceKm, nearestCity, suggestStores } from './nearby';

const HAIFA = { lat: 32.794, lng: 34.9896 };
const NESHER = { lat: 32.771, lng: 35.043 }; // about 5.5 km from Haifa
const AKKO = { lat: 32.928, lng: 35.082 }; // about 17 km from Haifa
const TEL_AVIV = { lat: 32.0853, lng: 34.7818 };

let n = 0;
const store = (chainId: string, city: string, name: string, itemCount = 5000, sub = ''): StoreInfo => ({
  id: `${chainId}-${++n}`,
  chainId,
  name,
  sub,
  city,
  address: '',
  updatedAt: '2026-11-20T04:00',
  itemCount,
  file: '',
  size: 0,
});

const index = (stores: StoreInfo[]): DataIndex => ({
  generatedAt: '',
  chains: [],
  stores,
  geo: {
    חיפה: [HAIFA.lat, HAIFA.lng],
    נשר: [NESHER.lat, NESHER.lng],
    עכו: [AKKO.lat, AKKO.lng],
    'תל אביב - יפו': [TEL_AVIV.lat, TEL_AVIV.lng],
  },
});

describe('distance', () => {
  it('measures kilometres between two points', () => {
    expect(distanceKm(HAIFA, HAIFA)).toBe(0);
    expect(distanceKm(HAIFA, TEL_AVIV)).toBeGreaterThan(78);
    expect(distanceKm(HAIFA, TEL_AVIV)).toBeLessThan(86);
  });

  it('finds the closest city that has stores', () => {
    const i = index([]);
    expect(nearestCity(i, { lat: 32.8, lng: 35.0 })?.city).toBe('חיפה');
    expect(nearestCity(i, { lat: 32.06, lng: 34.77 })?.city).toBe('תל אביב - יפו');
  });
});

describe('suggestStores', () => {
  it('offers one branch per leading chain, most popular chains first', () => {
    const i = index([
      store('carrefour', 'חיפה', 'קרפור מרקט'),
      store('ramilevy', 'חיפה', 'רמי לוי עזריאלי'),
      store('shufersal', 'חיפה', 'דיל גרנד קניון', 8000, 'שופרסל דיל'),
      store('shufersal', 'חיפה', 'שלי חורב', 7000, 'שופרסל שלי'),
      store('victory', 'חיפה', 'ויקטורי'),
    ]);
    const s = suggestStores(i, HAIFA);
    expect(s.map((x) => x.store.chainId)).toEqual(['shufersal', 'ramilevy', 'victory', 'carrefour']);
    expect(s.every((x) => x.preselected)).toBe(true);
  });

  it('represents a chain by its discount branch and lists the others as alternatives', () => {
    const i = index([
      store('shufersal', 'חיפה', 'אקספרס דניה', 9000, 'שופרסל אקספרס'),
      store('shufersal', 'חיפה', 'שלי חורב', 7000, 'שופרסל שלי'),
      store('shufersal', 'חיפה', 'דיל גרנד קניון', 8000, 'שופרסל דיל'),
      store('ramilevy', 'חיפה', 'רמי לוי'),
      store('victory', 'חיפה', 'ויקטורי'),
    ]);
    const shufersal = suggestStores(i, HAIFA)[0];
    expect(shufersal.store.name).toBe('דיל גרנד קניון');
    expect(shufersal.alternatives.map((a) => a.name)).toEqual(['שלי חורב', 'אקספרס דניה']);
  });

  it('never suggests pharmacies or convenience stores', () => {
    const i = index([
      store('superpharm', 'חיפה', 'סופר-פארם'),
      store('doralon', 'חיפה', 'AM-PM'),
      store('goodpharm', 'חיפה', 'גוד פארם'),
      store('ramilevy', 'חיפה', 'רמי לוי'),
    ]);
    expect(suggestStores(i, HAIFA).map((x) => x.store.chainId)).toEqual(['ramilevy']);
  });

  it('prefers the branch in the nearer city', () => {
    const i = index([
      store('ramilevy', 'עכו', 'רמי לוי עכו', 12000),
      store('ramilevy', 'חיפה', 'רמי לוי חיפה', 6000),
      store('victory', 'חיפה', 'ויקטורי'),
      store('shufersal', 'חיפה', 'דיל', 8000, 'שופרסל דיל'),
    ]);
    const rami = suggestStores(i, HAIFA).find((x) => x.store.chainId === 'ramilevy')!;
    expect(rami.store.name).toBe('רמי לוי חיפה');
  });

  it('looks farther out when the immediate area has too few chains', () => {
    const i = index([
      store('shufersal', 'נשר', 'דיל נשר', 8000, 'שופרסל דיל'),
      store('ramilevy', 'עכו', 'רמי לוי עכו'),
      store('victory', 'עכו', 'ויקטורי עכו'),
      store('osherad', 'תל אביב - יפו', 'אושר עד'),
    ]);
    // Standing in Nesher: one chain within 6 km, three within 20 km, Tel Aviv is out of range.
    expect(suggestStores(i, NESHER).map((x) => x.store.chainId)).toEqual(['shufersal', 'ramilevy', 'victory']);
  });

  it('keeps the area tight when it already offers a choice', () => {
    const i = index([
      store('shufersal', 'חיפה', 'דיל', 8000, 'שופרסל דיל'),
      store('ramilevy', 'חיפה', 'רמי לוי'),
      store('victory', 'חיפה', 'ויקטורי'),
      store('osherad', 'עכו', 'אושר עד עכו'),
    ]);
    expect(suggestStores(i, HAIFA).map((x) => x.store.chainId)).toEqual(['shufersal', 'ramilevy', 'victory']);
  });

  it('ticks at most five chains and offers at most eight', () => {
    const chains = ['shufersal', 'ramilevy', 'yohananof', 'victory', 'osherad', 'carrefour', 'mahsaneihashuk', 'hazihinam', 'tivtaam', 'keshet'];
    const s = suggestStores(index(chains.map((c) => store(c, 'חיפה', c))), HAIFA);
    expect(s).toHaveLength(8);
    expect(s.filter((x) => x.preselected)).toHaveLength(5);
  });

  it('ignores stores whose city has no known location', () => {
    const i = index([store('ramilevy', 'אחר', 'רמי לוי'), store('victory', 'חיפה', 'ויקטורי')]);
    expect(suggestStores(i, HAIFA).map((x) => x.store.chainId)).toEqual(['victory']);
  });
});
