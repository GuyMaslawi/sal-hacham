// Downloads today's price-transparency files, normalizes them and writes the compact data set
// the app reads:
//
//   <out>/index.json            chains + every store (name, city, address, freshness)
//   <out>/s/<store-id>.json.gz  one self-contained price list per store
//
// Usage: npm run sync -- [--chains shufersal,carrefour] [--cities "חיפה,נשר"] [--limit 5]
//                        [--out public/data] [--concurrency 6] [--min-stores 400]
//                        [--fallback <dir>]
//
// --fallback points at an earlier output folder. Chains that produce nothing in this run (their
// portal is down, or it refuses connections from outside Israel) are filled in from there.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { CHAINS, israelDate, type ChainAdapter, type RemoteFile } from './chains.ts';
import { mapPool } from './http.ts';
import { resolveCity, UNKNOWN_CITY } from './normalize.ts';
import { parsePriceFull, parsePromoFull, parseStores, pickPromos, type PriceItem, type RawStore } from './parse.ts';
import { decodeFile } from './xml.ts';

const DATA_VERSION = 1;
const MIN_ITEMS_PER_STORE = 200;

interface Args {
  chains: string[] | null;
  cities: string[] | null;
  limit: number;
  out: string;
  concurrency: number;
  /** Fail (and so skip the deploy) when fewer stores than this were produced. */
  minStores: number;
  fallback: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(`--${flag}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
  return {
    chains: list(get('chains')),
    cities: list(get('cities')),
    limit: Number(get('limit') ?? 0),
    out: get('out') ?? 'public/data',
    concurrency: Number(get('concurrency') ?? 6),
    minStores: Number(get('min-stores') ?? 1),
    fallback: get('fallback') ?? null,
  };
}

interface StoreEntry {
  id: string;
  c: string;
  n: string;
  sub: string;
  city: string;
  a: string;
  u: string;
  k: number;
  p: number;
  f: string;
  z: number;
}

const stampToIso = (s: string) =>
  s.length >= 12 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}` : '';

const newest = (files: RemoteFile[]) => files.reduce((a, b) => (b.stamp > a.stamp ? b : a));

async function syncChain(chain: ChainAdapter, args: Args, today: string): Promise<StoreEntry[]> {
  const files = await chain.list();
  const storesFiles = files.filter((f) => f.kind === 'stores');
  const priceFiles = new Map<string, RemoteFile[]>();
  const promoFiles = new Map<string, RemoteFile[]>();
  for (const f of files) {
    const bucket = f.kind === 'pricefull' ? priceFiles : f.kind === 'promofull' ? promoFiles : null;
    if (!bucket) continue;
    const list = bucket.get(f.storeId);
    if (list) list.push(f);
    else bucket.set(f.storeId, [f]);
  }
  if (!priceFiles.size) throw new Error('no PriceFull files are published right now');

  let storeInfo = new Map<string, RawStore>();
  if (storesFiles.length) {
    try {
      storeInfo = parseStores(decodeFile(await chain.download(newest(storesFiles)))).stores;
    } catch (err) {
      console.warn(`  [${chain.id}] stores file unreadable, continuing with bare ids: ${(err as Error).message}`);
    }
  }

  const describe = (storeId: string) => {
    const info = storeInfo.get(storeId);
    // Online-only "stores" publish a web address instead of a street address.
    const rawAddress = (info?.address ?? '').replace(/\s+0$/, '').trim();
    const address = /^https?:|^www\.|^unknown$|^לא ידוע$/i.test(rawAddress) ? '' : rawAddress;
    const city = resolveCity(info?.city ?? '', info?.name ?? '', address);
    // Some chains append an internal branch number to the name: "קרפור כרמליה (2040)".
    const rawName = (info?.name ?? '').replace(/\s*\(\d+\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const name = rawName || (city !== UNKNOWN_CITY ? city : `סניף ${storeId}`);
    return { name, address, sub: info?.subChain ?? '', city };
  };

  let storeIds = [...priceFiles.keys()].sort((a, b) => Number(a) - Number(b));
  // Delivery-app storefronts are not places a shopper can walk into.
  storeIds = storeIds.filter((id) => !/^(וולט|wolt)/i.test(describe(id).name));
  if (args.cities) storeIds = storeIds.filter((id) => args.cities!.includes(describe(id).city));
  if (args.limit > 0) storeIds = storeIds.slice(0, args.limit);

  const results = await mapPool(storeIds, args.concurrency, async (storeId): Promise<StoreEntry | null> => {
    const candidates = priceFiles.get(storeId)!.sort((a, b) => a.stamp.localeCompare(b.stamp));
    const toRead = chain.mergeAllPriceFiles ? candidates : [candidates[candidates.length - 1]];
    const items = new Map<string, PriceItem>();
    for (const f of toRead) {
      for (const [code, item] of parsePriceFull(decodeFile(await chain.download(f))).items) items.set(code, item);
    }
    if (items.size < MIN_ITEMS_PER_STORE) return null;

    let promos = new Map<string, ReturnType<typeof pickPromos>>();
    const promoFile = promoFiles.get(storeId);
    if (promoFile?.length) {
      try {
        const raw = parsePromoFull(decodeFile(await chain.download(newest(promoFile))), today);
        for (const [code, list] of raw) {
          const item = items.get(code);
          if (!item) continue;
          const picked = pickPromos(item, list);
          if (picked.length) promos.set(code, picked);
        }
      } catch (err) {
        // Shelf prices are still correct without the promotions file.
        promos = new Map();
        console.warn(`  [${chain.id}-${storeId}] promotions skipped: ${(err as Error).message}`);
      }
    }

    const rows = [...items.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'he'))
      .map((it) => {
        const row: unknown[] = [it.code, it.name, it.manufacturer, it.price, it.qty, it.unit, it.weighted ? 1 : 0];
        const deals = promos.get(it.code);
        if (deals) row.push(deals.map((d) => [d.minQty, d.price, d.club ? 1 : 0, d.end, d.desc]));
        return row;
      });

    const id = `${chain.id}-${storeId}`;
    const updated = stampToIso(candidates[candidates.length - 1].stamp);
    const gz = gzipSync(JSON.stringify({ v: DATA_VERSION, id, u: updated, items: rows }), { level: 9 });
    const file = `s/${id}.json.gz`;
    writeFileSync(join(args.out, file), gz);

    const d = describe(storeId);
    return { id, c: chain.id, n: d.name, sub: d.sub, city: d.city, a: d.address, u: updated, k: rows.length, p: promos.size, f: file, z: gz.length };
  });

  const entries: StoreEntry[] = [];
  let failed = 0;
  let tooSmall = 0;
  for (const r of results) {
    if (!r.ok) {
      failed++;
      if (failed <= 3) console.warn(`  [${chain.id}] store failed: ${(r.error as Error).message}`);
    } else if (r.value) entries.push(r.value);
    else tooSmall++;
  }
  console.log(
    `  [${chain.id}] ${entries.length} stores written` +
      (tooSmall ? `, ${tooSmall} skipped (fewer than ${MIN_ITEMS_PER_STORE} items)` : '') +
      (failed ? `, ${failed} failed` : ''),
  );
  return entries;
}

/** Fill in chains that produced nothing this run from an earlier output folder. */
function carryOver(args: Args, stores: StoreEntry[]): { stores: number; chains: string[] } {
  const indexPath = args.fallback ? join(args.fallback, 'index.json') : '';
  if (!args.fallback || !existsSync(indexPath)) return { stores: 0, chains: [] };
  const previous = JSON.parse(readFileSync(indexPath, 'utf8')) as { stores: StoreEntry[] };
  const produced = new Set(stores.map((s) => s.c));
  const wanted = args.chains ? new Set(args.chains) : null;
  const chains = new Set<string>();
  let count = 0;
  for (const entry of previous.stores) {
    if (produced.has(entry.c) || (wanted && !wanted.has(entry.c))) continue;
    const source = join(args.fallback, entry.f);
    if (!existsSync(source)) continue;
    copyFileSync(source, join(args.out, entry.f));
    stores.push(entry);
    chains.add(entry.c);
    count++;
  }
  return { stores: count, chains: [...chains] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = israelDate().iso;
  const chains = args.chains ? CHAINS.filter((c) => args.chains!.includes(c.id)) : CHAINS;
  if (!chains.length) throw new Error(`No matching chains. Available: ${CHAINS.map((c) => c.id).join(', ')}`);

  rmSync(join(args.out, 's'), { recursive: true, force: true });
  mkdirSync(join(args.out, 's'), { recursive: true });

  console.log(`Syncing ${chains.length} chains for ${today} → ${args.out}`);
  const started = Date.now();
  const stores: StoreEntry[] = [];
  const failedChains: string[] = [];
  // Chains live on different hosts, so they can run side by side without hammering anyone.
  const perChain = await mapPool(chains, 4, (chain) => syncChain(chain, args, today));
  perChain.forEach((r, i) => {
    if (r.ok) stores.push(...r.value);
    else {
      failedChains.push(chains[i].id);
      console.error(`  [${chains[i].id}] FAILED: ${(r.error as Error).message}`);
    }
  });

  const carried = carryOver(args, stores);
  if (carried.stores) {
    console.log(`  carried over ${carried.stores} stores from ${args.fallback} for: ${carried.chains.join(', ')}`);
  }

  if (stores.length < args.minStores) {
    throw new Error(
      `Only ${stores.length} stores were produced (expected at least ${args.minStores}). ` +
        'Not writing an index, so a deploy that depends on this run will not replace good data.',
    );
  }

  stores.sort((a, b) => a.city.localeCompare(b.city, 'he') || a.c.localeCompare(b.c) || a.n.localeCompare(b.n, 'he'));
  const present = new Set(stores.map((s) => s.c));
  // City coordinates let the app suggest stores near the shopper without any server.
  const coordsPath = fileURLToPath(new URL('../data/city-coords.json', import.meta.url));
  const allCoords: Record<string, [number, number]> = existsSync(coordsPath)
    ? JSON.parse(readFileSync(coordsPath, 'utf8'))
    : {};
  const cities = new Set(stores.map((s) => s.city));
  const geo = Object.fromEntries(Object.entries(allCoords).filter(([city]) => cities.has(city)));
  const index = {
    v: DATA_VERSION,
    generatedAt: new Date().toISOString(),
    chains: CHAINS.filter((c) => present.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
    geo,
    stores,
  };
  writeFileSync(join(args.out, 'index.json'), JSON.stringify(index));

  const totalMb = stores.reduce((n, s) => n + s.z, 0) / 1e6;
  console.log(
    `Done in ${Math.round((Date.now() - started) / 1000)}s: ${stores.length} stores, ` +
      `${new Set(stores.map((s) => s.city)).size} cities, ${totalMb.toFixed(1)} MB compressed.` +
      (failedChains.length ? ` Chains that failed: ${failedChains.join(', ')}.` : '') +
      (carried.stores ? ` Carried over: ${carried.chains.join(', ')}.` : ''),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
