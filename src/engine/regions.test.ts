import { describe, expect, it } from 'vitest';
import coords from '../../scripts/data/city-coords.json';
import type { DataIndex } from '../types';
import { citiesIn, cityRegions, REGIONS } from './regions';
import { autoRadiusKm, storesInArea, suggestStores } from './nearby';

const geo = coords as unknown as Record<string, [number, number]>;
const index: DataIndex = { generatedAt: '', chains: [], stores: [], geo };

describe('regions', () => {
  it('gives every town with a location a region', () => {
    const m = cityRegions(index);
    expect(m.size).toBe(Object.keys(geo).length);
  });

  it('spells every defining town as the price data does', async () => {
    const src = (await import('./regions.ts?raw')).default as string;
    const block = src.slice(src.indexOf('const ANCHORS'), src.indexOf('};', src.indexOf('const ANCHORS')));
    const names = [...block.matchAll(/^\s+(?:'([^']+)'|"([^"]+)"|([^\s:'"/]+)):/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((n) => !geo[n])).toEqual([]);
  });

  it('puts towns where people would look for them', () => {
    const m = cityRegions(index);
    expect(m.get('קרית ים')).toEqual(['haifa']);
    expect(m.get('עפולה')).toEqual(['north']);
    expect(m.get('ראשון לציון')).toContain('shfela');
    expect(m.get('ראשון לציון')).toContain('center');
    expect(m.get('נהלל')).toEqual(['north']);
    expect(m.get('כפר ויתקין')).toEqual(['sharon']);
    expect(m.get('אורים')).toEqual(['south']);
    expect(citiesIn(index, 'jerusalem').has('ירושלים')).toBe(true);
    expect(REGIONS).toHaveLength(9);
  });
});

describe('choosing stores by area', () => {
  const store = (id: string, chainId: string, city: string) => ({
    id,
    chainId,
    name: id,
    sub: '',
    city,
    address: '',
    updatedAt: '',
    itemCount: 5000,
    file: '',
    size: 0,
  });
  const i: DataIndex = {
    ...index,
    stores: [
      store('a', 'shufersal', 'חיפה'),
      store('b', 'ramilevy', 'נשר'),
      store('c', 'victory', 'עכו'),
      store('d', 'yohananof', 'נהריה'),
      store('e', 'osherad', 'תל אביב - יפו'),
    ],
  };
  const haifa = { lat: geo['חיפה'][0], lng: geo['חיפה'][1] };

  it('keeps to the distance the shopper set', () => {
    expect(storesInArea(i, haifa, { radiusKm: 2 }).map((x) => x.store.id)).toEqual(['a']);
    expect(storesInArea(i, haifa, { radiusKm: 10 }).map((x) => x.store.id).sort()).toEqual(['a', 'b']);
    expect(storesInArea(i, haifa, { radiusKm: 30 }).map((x) => x.store.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('always counts the shopper’s own town, however small the distance', () => {
    const edge = { lat: haifa.lat + 0.03, lng: haifa.lng }; // about 3 km from the middle of Haifa
    expect(storesInArea(i, edge, { radiusKm: 1 }).map((x) => x.store.id)).toEqual(['a']);
  });

  it('widens the automatic distance until there is a real choice', () => {
    expect(autoRadiusKm(i, haifa)).toBeGreaterThanOrEqual(20);
  });

  it('offers only the stores of the chosen region', () => {
    const s = suggestStores(i, haifa, { cities: citiesIn(i, 'north') });
    expect(s.map((x) => x.store.id).sort()).toEqual(['c', 'd']);
  });
});
