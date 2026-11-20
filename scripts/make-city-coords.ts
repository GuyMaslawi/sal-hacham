// One-off helper: looks up the coordinates of every city that has a store, so the app can find
// "stores near me" on the device without sending anyone's location anywhere.
//
//   npx tsx scripts/make-city-coords.ts [path/to/index.json]
//
// Results are kept in scripts/data/city-coords.json and committed; only cities missing from that
// file are looked up, one request per second, as OpenStreetMap's Nominatim service asks.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'scripts/data/city-coords.json';
const indexPath = process.argv[2] ?? 'public/data/index.json';

const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { stores: Array<{ city: string }> };
const cities = [...new Set(index.stores.map((s) => s.city))].filter((c) => c && c !== 'אחר').sort();
const coords: Record<string, [number, number]> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

const inRegion = (lat: number, lng: number) => lat > 29.3 && lat < 33.5 && lng > 34.1 && lng < 36;

async function lookup(city: string, settlementsOnly: boolean): Promise<[number, number] | null> {
  const params = new URLSearchParams({
    q: city.replace(/\*/g, ''),
    format: 'jsonv2',
    limit: '3',
    countrycodes: 'il,ps',
    'accept-language': 'he',
  });
  if (settlementsOnly) params.set('featureType', 'settlement');
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'grocery-price-pipeline/1.0 (one-off city lookup)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const hits = (await res.json()) as Array<{ lat: string; lon: string }>;
  for (const h of hits) {
    const lat = Number(h.lat);
    const lng = Number(h.lon);
    if (inRegion(lat, lng)) return [Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4];
  }
  return null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const missing = cities.filter((c) => !coords[c]);
console.log(`${cities.length} cities, ${missing.length} to look up`);
const failed: string[] = [];
for (const city of missing) {
  try {
    let hit = await lookup(city, true);
    await wait(1100);
    if (!hit) {
      hit = await lookup(city, false);
      await wait(1100);
    }
    if (hit) coords[city] = hit;
    else failed.push(city);
  } catch (err) {
    failed.push(city);
    console.warn(`  ${city}: ${(err as Error).message}`);
    await wait(3000);
  }
}
const sorted = Object.fromEntries(Object.entries(coords).sort(([a], [b]) => a.localeCompare(b, 'he')));
writeFileSync(OUT, JSON.stringify(sorted, null, 0).replace(/\],/g, '],\n') + '\n');
console.log(`Saved ${Object.keys(sorted).length} cities.` + (failed.length ? ` Not found: ${failed.join(', ')}` : ''));
