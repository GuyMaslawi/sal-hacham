// Which stores to keep from an earlier run when this run did not produce them.
//
// A chain's portal can be down for a day, refuse the server we run on, or simply not have
// published yet (a run shortly after midnight finds half the country missing). A store that
// drops out of the app and comes back the next morning is worse than a price that is one day
// old and labelled as such, so recent data is carried forward store by store.

export interface CarryCandidate {
  id: string;
  /** Publication time of the store's price list, `YYYY-MM-DDTHH:mm`. */
  u: string;
}

/** Keep a carried store for this long; after that its prices are too old to be worth showing. */
export const MAX_CARRY_DAYS = 14;

export function selectCarryOver<T extends CarryCandidate>(
  previous: T[],
  alreadyHave: ReadonlySet<string>,
  today: string,
  maxAgeDays = MAX_CARRY_DAYS,
): T[] {
  const oldest = Date.parse(today) - maxAgeDays * 86_400_000;
  const seen = new Set<string>();
  return previous.filter((entry) => {
    if (alreadyHave.has(entry.id) || seen.has(entry.id)) return false;
    const published = Date.parse(entry.u.slice(0, 10));
    if (!Number.isFinite(published) || published < oldest) return false;
    seen.add(entry.id);
    return true;
  });
}
