// Several chains refuse connections from servers outside Israel, so the daily job on GitHub
// cannot fetch them. Run this on a computer in Israel:
//
//   npm run deploy:israel
//
// It works out which chains the live site is missing, fetches just those here, uploads them as
// one file to a GitHub release called "local-data", and asks GitHub to rebuild the site. The
// daily job keeps using that file until this is run again, so run it as often as you want those
// chains refreshed (ideally daily).
//
//   npm run deploy:israel -- --chains carrefour,victory   only these chains
//   npm run deploy:israel -- --no-rebuild                 upload only, do not trigger a rebuild

import { execFileSync } from 'node:child_process';
import { CHAINS } from './chains.ts';

const RELEASE = 'local-data';
const ARCHIVE = '.local-data/local-data.tar';

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'inherit' });
const read = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const flag = (name: string) => process.argv.includes(`--${name}`);
const option = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// Always act as the account that owns this repository, whichever account `gh` happens to have
// active. On a machine logged in to several GitHub accounts this keeps the upload from going to,
// or being attempted with, the wrong one.
const origin = read('git', ['remote', 'get-url', 'origin']);
const repoMatch = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(origin);
if (!repoMatch) throw new Error(`The "origin" remote is not a GitHub repository: ${origin}`);
const [, owner, repoName] = repoMatch;
const repo = `${owner}/${repoName}`;
try {
  process.env.GH_TOKEN = read('gh', ['auth', 'token', '--user', owner]);
} catch {
  throw new Error(`gh is not logged in as ${owner}, the owner of this repository. Run: gh auth login`);
}

/** Chains seen refusing GitHub's servers; used when the live site cannot be consulted. */
const KNOWN_BLOCKED = ['carrefour', 'victory', 'mahsaneihashuk', 'hazihinam', 'superpharm', 'netivhahesed', 'hcohen'];

async function chainsToFetch(): Promise<string[]> {
  const chosen = option('chains');
  if (chosen) return chosen.split(',');
  try {
    const res = await fetch(`https://${owner.toLowerCase()}.github.io/${repoName}/data/index.json`, { cache: 'no-store' });
    const index = (await res.json()) as { stores: Array<{ c: string; u: string }> };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    // A chain needs fetching from here if the site has nothing recent for it.
    const fresh = new Set(
      index.stores.filter((s) => Date.parse(today) - Date.parse(s.u.slice(0, 10)) <= 86_400_000).map((s) => s.c),
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

// The store files are already compressed, so a plain tar is enough.
run('tar', ['-cf', ARCHIVE, '-C', '.local-data', 'data']);
try {
  read('gh', ['release', 'view', RELEASE, '--repo', repo, '--json', 'tagName']);
} catch {
  run('gh', [
    'release', 'create', RELEASE,
    '--repo', repo,
    '--title', 'Prices fetched from Israel',
    '--notes', 'Price data for chains that refuse connections from GitHub. Replaced by "npm run deploy:israel"; not a software release.',
    '--latest=false',
  ]);
}
run('gh', ['release', 'upload', RELEASE, ARCHIVE, '--repo', repo, '--clobber']);

if (flag('no-rebuild')) {
  console.log('Uploaded. The next scheduled or manual rebuild will include these chains.');
} else {
  run('gh', ['workflow', 'run', 'sync-prices.yml', '--repo', repo]);
  console.log('Uploaded. GitHub is rebuilding the site; it takes about five minutes.');
}
