// Some chains refuse connections from servers outside Israel, so the daily job on GitHub cannot
// fetch them. Run this on a computer in Israel:
//
//   npm run deploy:israel
//
// It works out which chains the live site is missing, fetches just those here, stores the result
// on the "local-data" branch, and asks GitHub to rebuild the site with them.

import { execFileSync } from 'node:child_process';
import { CHAINS } from './chains.ts';

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'inherit' });
const read = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

/** Chains known to block foreign servers; used when the live site cannot be consulted. */
const KNOWN_BLOCKED = ['carrefour', 'hazihinam'];

async function chainsToFetch(): Promise<string[]> {
  const fromArgs = process.argv[2];
  if (fromArgs) return fromArgs.split(',');
  try {
    const repo = read('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    const [owner, name] = repo.split('/');
    const res = await fetch(`https://${owner}.github.io/${name}/data/index.json`, { cache: 'no-store' });
    const index = (await res.json()) as { stores: Array<{ c: string; u: string }> };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    // A chain needs fetching from here if the site has no data for it from the last two days.
    const fresh = new Set(
      index.stores.filter((s) => Date.parse(today) - Date.parse(s.u.slice(0, 10)) <= 2 * 86_400_000).map((s) => s.c),
    );
    const stale = CHAINS.map((c) => c.id).filter((id) => !fresh.has(id));
    return [...new Set([...KNOWN_BLOCKED, ...stale])];
  } catch {
    return KNOWN_BLOCKED;
  }
}

const chains = await chainsToFetch();
console.log(`Fetching from this computer: ${chains.join(', ')}`);
run('npx', ['tsx', 'scripts/sync/index.ts', '--chains', chains.join(','), '--out', '.local-data/data']);
run('npx', [
  'gh-pages',
  '--dist', '.local-data',
  '--branch', 'local-data',
  '--no-history',
  '--nojekyll',
  '--message', 'Prices that can only be fetched from Israel',
]);
run('gh', ['workflow', 'run', 'sync-prices.yml']);
console.log('Done. GitHub is rebuilding the site; it takes about five minutes.');
