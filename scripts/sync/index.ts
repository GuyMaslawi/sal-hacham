// Downloads today's price-transparency files, normalizes them and writes the compact data set
// the app reads:
//
//   <out>/index.json            chains + every store (name, city, address, freshness)
//   <out>/s/<store-id>.json.gz  one self-contained price list per store
//
// Usage: npm run sync -- [--chains shufersal,carrefour] [--cities "חיפה,נשר"] [--limit 5]
//                        [--out public/data] [--concurrency 6] [--min-stores 400]
//                        [--fallback <dir>] [--previous-url <url>] [--reuse] [--allow-shrink]
//
// --reuse (the hourly job on Guy's Mac): a store whose chain has published no new file since the
// run that produced --fallback is copied from there instead of downloaded and parsed again.
// Which files built each store is kept in <out>/sources.json for the next run.
//
// Stores this run could not produce (a portal is down, refuses connections from outside Israel,
// or has not published yet today) are kept from an earlier run while they are recent enough:
// from --fallback, an earlier output folder, or --previous-url, the published site, whichever
// has the newer price list.
//
// Before writing an index the run is compared with the data set it replaces (the published site,
// else --fallback). If a chain lost more than 30% of its stores, or the whole set more than 20%,
// the run fails and the current data stays online; so it does when --previous-url cannot be read
// and there is no --fallback either. --allow-shrink deploys anyway (a first deploy, or a chain
// that really did go away).

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { CHAINS, israelDate, type ChainAdapter, type RemoteFile } from './chains.ts';
import { chooseBaseline, isStale, reuseRecord, selectCarryOver, shrinkProblems } from './carry.ts';
import { mapPool, request } from './http.ts';
import { applyStoreCities, isOnlineStorefront, loadStoreCities, resolveCity, UNKNOWN_CITY } from './normalize.ts';
import { parsePriceFull, parsePromoFull, parseStores, pickPromos, type PriceItem, type RawStore } from './parse.ts';
import { decodeFile } from './xml.ts';

const DATA_VERSION = 1;
/**
 * Bumped whenever parsing changes what a store file means (deal prices, sizes, filters). Stores
 * built by an older parser are not carried into a new run: better a store missing for a few
 * hours than one showing prices read the old, wrong way.
 */
const PARSER_VERSION = 3;
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
  previousUrl: string | null;
  reuse: boolean;
  /** Write the index even when it lost many stores compared with the one it replaces. */
  allowShrink: boolean;
}

/** Which chain files built a store, and on which day (promotions are filtered by the day). */
interface Source {
  src: string;
  day: string;
  pv: number;
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
    previousUrl: get('previous-url') ?? null,
    reuse: argv.includes('--reuse'),
    allowShrink: argv.includes('--allow-shrink'),
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
  /** Version of the parser that built the file. */
  pv?: number;
}

const stampToIso = (s: string) =>
  s.length >= 12 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}` : '';

const newest = (files: RemoteFile[]) => files.reduce((a, b) => (b.stamp > a.stamp ? b : a));

interface IndexFile {
  stores: StoreEntry[];
}

/** The index of the --fallback folder, or null when there is none. */
function loadFolderIndex(args: Args): IndexFile | null {
  const indexPath = args.fallback ? join(args.fallback, 'index.json') : '';
  if (!indexPath || !existsSync(indexPath)) return null;
  return JSON.parse(readFileSync(indexPath, 'utf8')) as IndexFile;
}

/** The index currently published at --previous-url, or null when it could not be read. */
async function loadSiteIndex(args: Args): Promise<IndexFile | null> {
  if (!args.previousUrl) return null;
  try {
    const index = JSON.parse((await request(`${siteBase(args)}index.json`, { retries: 2 })).toString('utf8')) as IndexFile;
    return Array.isArray(index.stores) ? index : null;
  } catch (err) {
    console.warn(`  could not read the published index: ${(err as Error).message}`);
    return null;
  }
}

const siteBase = (args: Args) => args.previousUrl!.replace(/\/?$/, '/');

/** What --reuse can copy: the previous run's stores and the files each was built from. */
interface Previous {
  sources: Map<string, Source>;
  entries: Map<string, StoreEntry>;
}

function loadPrevious(args: Args, folder: IndexFile | null): Previous {
  const empty: Previous = { sources: new Map(), entries: new Map() };
  if (!args.reuse || !args.fallback || !folder) return empty;
  const sourcesPath = join(args.fallback, 'sources.json');
  if (!existsSync(sourcesPath)) return empty;
  try {
    const sources = JSON.parse(readFileSync(sourcesPath, 'utf8')) as Record<string, Source>;
    return { sources: new Map(Object.entries(sources)), entries: new Map(folder.stores.map((e) => [e.id, e])) };
  } catch {
    return empty;
  }
}

async function syncChain(
  chain: ChainAdapter,
  args: Args,
  today: string,
  previous: Previous,
  /** Filled in for every store this run built (or copied unchanged): the files it came from. */
  sources: Map<string, Source>,
): Promise<StoreEntry[]> {
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
  // Online shops and delivery storefronts are not places a shopper can walk into.
  storeIds = storeIds.filter((id) => !isOnlineStorefront(describe(id).name));
  // Branches whose newest price list is weeks old have closed; leave them out.
  const stale = new Set(storeIds.filter((id) => isStale(stampToIso(newest(priceFiles.get(id)!).stamp), today)));
  storeIds = storeIds.filter((id) => !stale.has(id));
  if (args.cities) storeIds = storeIds.filter((id) => args.cities!.includes(describe(id).city));
  if (args.limit > 0) storeIds = storeIds.slice(0, args.limit);

  const results = await mapPool(storeIds, args.concurrency, async (storeId): Promise<StoreEntry | null> => {
    const candidates = priceFiles.get(storeId)!.sort((a, b) => a.stamp.localeCompare(b.stamp));
    const toRead = chain.mergeAllPriceFiles ? candidates : [candidates[candidates.length - 1]];
    const id = `${chain.id}-${storeId}`;
    const promoFile = promoFiles.get(storeId);
    const source: Source = {
      src: [...toRead.map((f) => f.name), promoFile?.length ? newest(promoFile).name : ''].join('|'),
      day: today,
      pv: PARSER_VERSION,
    };
    // Recorded only once the store has been built from these files: a store whose download
    // failed or came back short is carried from an earlier run, and must keep that run's record.

    // Nothing new from the chain for this store since the last run: copy what that run built.
    const before = previous.sources.get(id);
    const entry = previous.entries.get(id);
    if (
      before && entry && args.fallback &&
      before.src === source.src && before.day === source.day && before.pv === source.pv &&
      existsSync(join(args.fallback, entry.f))
    ) {
      copyFileSync(join(args.fallback, entry.f), join(args.out, entry.f));
      sources.set(id, source);
      const d = describe(storeId);
      return { ...entry, n: d.name, sub: d.sub, city: d.city, a: d.address };
    }

    const items = new Map<string, PriceItem>();
    for (const f of toRead) {
      for (const [code, item] of parsePriceFull(decodeFile(await chain.download(f))).items) items.set(code, item);
    }
    if (items.size < MIN_ITEMS_PER_STORE) return null;

    let promos = new Map<string, ReturnType<typeof pickPromos>>();
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
        if (deals) {
          row.push(deals.map((d) => [d.minQty, d.price, d.club ? 1 : 0, d.end, d.desc, ...(d.maxQty ? [d.maxQty] : [])]));
        }
        return row;
      });

    const updated = stampToIso(candidates[candidates.length - 1].stamp);
    const gz = gzipSync(JSON.stringify({ v: DATA_VERSION, id, u: updated, items: rows }), { level: 9 });
    const file = `s/${id}.json.gz`;
    writeFileSync(join(args.out, file), gz);
    sources.set(id, source);

    const d = describe(storeId);
    return {
      id,
      c: chain.id,
      n: d.name,
      sub: d.sub,
      city: d.city,
      a: d.address,
      u: updated,
      k: rows.length,
      p: promos.size,
      f: file,
      z: gz.length,
      pv: PARSER_VERSION,
    };
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
      (stale.size ? `, ${stale.size} skipped (no price list for over two weeks)` : '') +
      (failed ? `, ${failed} failed` : ''),
  );
  return entries;
}

interface CarryCandidate {
  id: string;
  u: string;
  entry: StoreEntry;
  from: 'folder' | 'site';
}

/**
 * Keep recent stores this run did not produce, from the --fallback folder or the published site,
 * whichever has the newer price list for each. Returns the ids taken from each.
 */
async function carryOver(
  args: Args,
  stores: StoreEntry[],
  today: string,
  folder: IndexFile | null,
  site: IndexFile | null,
): Promise<{ fromFolder: Set<string>; fromSite: Set<string> }> {
  const wanted = args.chains ? new Set(args.chains) : null;
  // Only stores built by this parser, from the chains asked for, that are real shops.
  const usable = (e: StoreEntry) => e.pv === PARSER_VERSION && (!wanted || wanted.has(e.c)) && !isOnlineStorefront(e.n);
  const fromFolderList: CarryCandidate[] = (folder?.stores ?? [])
    .filter((e) => usable(e) && existsSync(join(args.fallback!, e.f)))
    .map((entry) => ({ id: entry.id, u: entry.u, entry, from: 'folder' }));
  const fromSiteList: CarryCandidate[] = (site?.stores ?? [])
    .filter(usable)
    .map((entry) => ({ id: entry.id, u: entry.u, entry, from: 'site' }));

  const have = new Set(stores.map((s) => s.id));
  // The folder is listed first, so it wins a tie (no download needed).
  const chosen = selectCarryOver([...fromFolderList, ...fromSiteList], have, today);
  const folderBest = new Map(selectCarryOver(fromFolderList, have, today).map((c) => [c.id, c]));

  const copyFromFolder = (c: CarryCandidate) => {
    copyFileSync(join(args.fallback!, c.entry.f), join(args.out, c.entry.f));
    return c;
  };
  const results = await mapPool(chosen, 8, async (c) => {
    if (c.from === 'folder') return copyFromFolder(c);
    try {
      writeFileSync(join(args.out, c.entry.f), await request(`${siteBase(args)}${c.entry.f}`));
      return c;
    } catch (err) {
      // The site's copy could not be fetched: an older one from the folder beats none.
      const older = folderBest.get(c.id);
      if (!older) throw err;
      return copyFromFolder(older);
    }
  });

  const fromFolder = new Set<string>();
  const fromSite = new Set<string>();
  for (const r of results) {
    if (!r.ok) continue;
    stores.push(r.value.entry);
    (r.value.from === 'folder' ? fromFolder : fromSite).add(r.value.id);
  }
  return { fromFolder, fromSite };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = israelDate().iso;
  const chains = args.chains ? CHAINS.filter((c) => args.chains!.includes(c.id)) : CHAINS;
  if (!chains.length) throw new Error(`No matching chains. Available: ${CHAINS.map((c) => c.id).join(', ')}`);

  // What this run replaces, read before the long download so a run that cannot be checked
  // stops early. Without either, the chains fetched from Israel would silently disappear.
  const folderIndex = loadFolderIndex(args);
  const siteIndex = await loadSiteIndex(args);
  const baseline = chooseBaseline(
    siteIndex?.stores ?? null,
    folderIndex?.stores ?? null,
    !!args.previousUrl,
    chains.map((c) => c.id),
  );
  if (baseline.error && !args.allowShrink) {
    throw new Error(
      `Could not read ${siteBase(args)}index.json and there is no --fallback data either, so the stores ` +
        'this run cannot fetch itself would vanish. Not writing an index. Pass --allow-shrink for a first deploy.',
    );
  }

  rmSync(join(args.out, 's'), { recursive: true, force: true });
  mkdirSync(join(args.out, 's'), { recursive: true });

  console.log(`Syncing ${chains.length} chains for ${today} → ${args.out}`);
  const started = Date.now();
  const stores: StoreEntry[] = [];
  const failedChains: string[] = [];
  // Chains live on different hosts, so they can run side by side without hammering anyone.
  const previous = loadPrevious(args, folderIndex);
  const sources = new Map<string, Source>();
  const perChain = await mapPool(chains, 4, (chain) => syncChain(chain, args, today, previous, sources));
  perChain.forEach((r, i) => {
    if (r.ok) stores.push(...r.value);
    else {
      failedChains.push(chains[i].id);
      console.error(`  [${chains[i].id}] FAILED: ${(r.error as Error).message}`);
    }
  });

  const fresh = stores.length;
  const { fromFolder, fromSite } = await carryOver(args, stores, today, folderIndex, siteIndex);
  if (fromFolder.size) console.log(`  kept ${fromFolder.size} stores from ${args.fallback}`);
  if (fromSite.size) console.log(`  kept ${fromSite.size} stores from the published site`);

  if (stores.length < args.minStores) {
    throw new Error(
      `Only ${stores.length} stores were produced (expected at least ${args.minStores}). ` +
        'Not writing an index, so a deploy that depends on this run will not replace good data.',
    );
  }

  // Compare with what this run replaces: the published site, else the fallback folder (which
  // only holds some chains, so only those are compared). A run limited to some cities or a few
  // stores per chain is a test, not a replacement.
  if (baseline.stores && !args.cities && !(args.limit > 0)) {
    // Online storefronts are left out now; an earlier set that still lists them is not "more".
    const before = baseline.stores.filter((s) => !isOnlineStorefront(s.n));
    const problems = shrinkProblems(before, stores, today, baseline.chains);
    if (problems.length) {
      const what =
        `Far fewer stores than the data set this replaces (${baseline.from === 'site' ? 'the published site' : args.fallback}): ` +
        `${problems.join('; ')}.`;
      if (!args.allowShrink) {
        throw new Error(`${what} Not writing an index, so the current data stays online. Pass --allow-shrink if this is expected.`);
      }
      console.warn(`  ${what} Writing it anyway (--allow-shrink).`);
    }
  }

  // Cities checked by hand for stores whose chain gives none we can use (scripts/data/store-cities.json).
  applyStoreCities(stores, loadStoreCities());
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
  if (args.reuse) {
    const record = reuseRecord(stores.map((s) => s.id), sources, fromFolder, previous.sources);
    writeFileSync(join(args.out, 'sources.json'), JSON.stringify(record));
  }

  const totalMb = stores.reduce((n, s) => n + s.z, 0) / 1e6;
  console.log(
    `Done in ${Math.round((Date.now() - started) / 1000)}s: ${stores.length} stores, ` +
      `${new Set(stores.map((s) => s.city)).size} cities, ${totalMb.toFixed(1)} MB compressed.` +
      ` Fresh: ${fresh}, kept from earlier runs: ${fromFolder.size + fromSite.size}.` +
      (failedChains.length ? ` Chains that failed: ${failedChains.join(', ')}.` : ''),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
