// Which stores to keep from an earlier run when this run did not produce them.
//
// A chain's portal can be down for a day, refuse the server we run on, or simply not have
// published yet (a run shortly after midnight finds half the country missing). A store that
// drops out of the app and comes back the next morning is worse than a price that is one day
// old and labelled as such, so recent data is carried forward store by store.
//
// Also here: the check that a run did not lose so many stores that it must not replace the
// deployed data, and what --reuse remembers about which files built each store.

export interface CarryCandidate {
  id: string;
  /** Publication time of the store's price list, `YYYY-MM-DDTHH:mm`. */
  u: string;
}

/** Keep a carried store for this long; after that its prices are too old to be worth showing. */
export const MAX_CARRY_DAYS = 14;

/**
 * True when a price list was published more than `maxAgeDays` before `today`. A branch whose
 * newest file is that old has usually closed; the chain just never stopped listing its last
 * file. An unreadable date is not treated as stale.
 */
export function isStale(publishedIso: string, today: string, maxAgeDays = MAX_CARRY_DAYS): boolean {
  const published = Date.parse(publishedIso.slice(0, 10));
  if (!Number.isFinite(published)) return false;
  return published < Date.parse(today) - maxAgeDays * 86_400_000;
}

/**
 * The stores worth carrying: recent enough, not produced by this run, one per store. When
 * several earlier runs have the same store (the local fallback and the published site), the one
 * with the newest price list wins; on a tie, the one listed first.
 */
export function selectCarryOver<T extends CarryCandidate>(
  previous: T[],
  alreadyHave: ReadonlySet<string>,
  today: string,
  maxAgeDays = MAX_CARRY_DAYS,
): T[] {
  const oldest = Date.parse(today) - maxAgeDays * 86_400_000;
  const best = new Map<string, T>();
  for (const entry of previous) {
    if (alreadyHave.has(entry.id)) continue;
    const published = Date.parse(entry.u.slice(0, 10));
    if (!Number.isFinite(published) || published < oldest) continue;
    const kept = best.get(entry.id);
    if (!kept || entry.u > kept.u) best.set(entry.id, entry);
  }
  return [...best.values()];
}

// ---- Deploy guard -------------------------------------------------------------------------

export interface ShrinkLimits {
  /** A chain may lose at most this share of its stores from one run to the next... */
  chainShare: number;
  /** ...and losing fewer stores than this is never a problem (a chain with two stores closing one). */
  chainMinLost: number;
  /** The whole data set may lose at most this share of its stores. */
  totalShare: number;
}

export const SHRINK_LIMITS: ShrinkLimits = { chainShare: 0.3, chainMinLost: 3, totalShare: 0.2 };

/**
 * Why a new data set should not replace the deployed one, if it should not: a chain lost a large
 * share of its stores, or the total shrank a lot. That is what a failed download looks like (the
 * chains fetched from Israel vanishing when their file could not be read), not shops closing.
 * Stores the earlier set would have dropped anyway for being too old do not count, and only
 * `chains` are compared when given (a run limited to some chains).
 */
/**
 * A store with neither an address nor a known city. Some portals list a batch of these
 * ("סניף 3360") in one run and not the next; they cannot be found by place anyway, so their
 * coming and going is not the kind of loss the guard is for.
 */
const unplaced = (s: { city?: string; a?: string }) => s.city === 'אחר' && !s.a?.trim();

export function shrinkProblems(
  previous: Array<{ c: string; u: string; city?: string; a?: string }>,
  next: Array<{ c: string; city?: string; a?: string }>,
  today: string,
  chains: ReadonlySet<string> | null = null,
  limits: ShrinkLimits = SHRINK_LIMITS,
): string[] {
  const count = (list: Array<{ c: string; city?: string; a?: string }>) => {
    const byChain = new Map<string, number>();
    for (const s of list) {
      if (unplaced(s)) continue;
      if (!chains || chains.has(s.c)) byChain.set(s.c, (byChain.get(s.c) ?? 0) + 1);
    }
    return byChain;
  };
  const before = count(previous.filter((s) => !isStale(s.u, today)));
  const after = count(next);
  const problems: string[] = [];
  let totalBefore = 0;
  // A chain that grew, or a new one, does not make up for stores missing elsewhere.
  let totalAfter = 0;
  for (const [chain, n] of before) {
    const now = after.get(chain) ?? 0;
    totalBefore += n;
    totalAfter += Math.min(now, n);
    const lost = n - now;
    if (lost >= limits.chainMinLost && lost > n * limits.chainShare) problems.push(`${chain}: ${n} → ${now} stores`);
  }
  if (totalAfter < totalBefore * (1 - limits.totalShare)) {
    problems.push(`all chains: ${totalBefore} → ${totalAfter} stores`);
  }
  return problems;
}

/** What a run is compared with before its index replaces the deployed one. */
export type Baseline<T> =
  | { stores: T[]; chains: Set<string>; from: 'site' | 'folder'; error?: undefined }
  | { stores: null; chains: null; from: null; error?: string };

/**
 * The published site's index when it could be read; else the fallback folder's, comparing only
 * the chains it holds; else nothing. When the site was asked for and neither can be read, the
 * run cannot tell what it would lose (the chains fetched from Israel live only there) and must
 * not replace the deployed data: that comes back as `error`.
 */
export function chooseBaseline<T extends { c: string }>(
  site: T[] | null,
  folder: T[] | null,
  siteRequested: boolean,
  chains: string[],
): Baseline<T> {
  if (site) return { stores: site, chains: new Set(chains), from: 'site' };
  if (folder) {
    const held = new Set(folder.map((s) => s.c));
    return { stores: folder, chains: new Set(chains.filter((c) => held.has(c))), from: 'folder' };
  }
  if (siteRequested) {
    return { stores: null, chains: null, from: null, error: 'neither the published index nor a fallback folder could be read' };
  }
  return { stores: null, chains: null, from: null };
}

/**
 * The sources.json --reuse reads next time: stores built (or copied unchanged) this run record
 * the files they were built from; a store carried from the fallback folder keeps the record it
 * had there, even if this run listed newer files for it that it then failed to read. A store
 * carried from the site has no record, so the next run builds it afresh.
 */
export function reuseRecord<S>(
  storeIds: string[],
  built: ReadonlyMap<string, S>,
  carriedFromFolder: ReadonlySet<string>,
  previous: ReadonlyMap<string, S>,
): Record<string, S> {
  const record: Record<string, S> = {};
  for (const id of storeIds) {
    const source = built.get(id) ?? (carriedFromFolder.has(id) ? previous.get(id) : undefined);
    if (source !== undefined) record[id] = source;
  }
  return record;
}
