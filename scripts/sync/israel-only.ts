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
//   npm run deploy:israel -- --allow-shrink               upload even if a chain lost many stores
//   node scripts/sync/israel-only.ts --hourly             for the hourly job on Guy's Mac
//
// --hourly builds on the previous run's data kept on this computer instead of downloading the
// last upload again, uploads only when a price list actually changed, and leaves the rebuild to
// the site's own hourly run. It runs under plain Node (no tsx), from scripts/hourly-israel.sh.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { CHAINS } from './chains.ts';

const RELEASE = 'local-data';
const ARCHIVE = '.local-data/local-data.tar';
const UPLOADED = '.local-data/uploaded.sha256';

const run = (cmd: string, args: string[], timeoutMs?: number) =>
  execFileSync(cmd, args, { stdio: 'inherit', ...(timeoutMs ? { timeout: timeoutMs, killSignal: 'SIGKILL' as const } : {}) });
// An upload that the Mac's sleep froze half way must not hold up every later run.
const UPLOAD_TIMEOUT_MS = 20 * 60 * 1000;
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
    // A chain the site lists but has nothing recent for is fetched from here too. A chain the
    // site does not list at all was left out on purpose (an online-only shop), not lost.
    const fresh = new Set(
      index.stores.filter((s) => Date.parse(today) - Date.parse(s.u.slice(0, 10)) <= 86_400_000).map((s) => s.c),
    );
    const listed = new Set(index.stores.map((s) => s.c));
    const stale = CHAINS.map((c) => c.id).filter((id) => listed.has(id) && !fresh.has(id));
    return [...new Set([...KNOWN_BLOCKED, ...stale])];
  } catch {
    return KNOWN_BLOCKED;
  }
}

const hourly = flag('hourly');
const chains = await chainsToFetch();
console.log(`Fetching from this computer: ${chains.join(', ')}`);

// Start from what was uploaded last time, so a run at an hour when a chain has not published
// yet keeps that chain's previous prices instead of dropping it. The hourly job keeps that data
// here between runs; otherwise it is downloaded from the release.
rmSync('.local-data/prev', { recursive: true, force: true });
mkdirSync('.local-data/prev', { recursive: true });
if (hourly && existsSync('.local-data/data/index.json')) {
  renameSync('.local-data/data', '.local-data/prev/data');
} else {
  try {
    read('gh', ['release', 'download', RELEASE, '--repo', repo, '--pattern', 'local-data.tar', '--dir', '.local-data/prev']);
    run('tar', ['-xf', '.local-data/prev/local-data.tar', '-C', '.local-data/prev']);
  } catch {
    console.log('No earlier upload to build on.');
  }
}
// The same Node that runs this script, with the same loader (tsx under npm, none under --hourly).
run(process.execPath, [
  ...process.execArgv,
  'scripts/sync/index.ts',
  '--chains', chains.join(','),
  '--out', '.local-data/data',
  '--fallback', '.local-data/prev/data',
  ...(hourly ? ['--reuse'] : []),
  ...(flag('allow-shrink') ? ['--allow-shrink'] : []),
]);
rmSync('.local-data/prev', { recursive: true, force: true });

/** A fingerprint of every store's price list, to tell whether anything changed since the last upload. */
function fingerprint(dir: string): string {
  const hash = createHash('sha256');
  for (const f of readdirSync(`${dir}/s`).sort()) hash.update(f).update(readFileSync(`${dir}/s/${f}`));
  return hash.digest('hex');
}
const print = fingerprint('.local-data/data');
if (hourly && existsSync(UPLOADED) && readFileSync(UPLOADED, 'utf8') === print) {
  console.log('No chain published new prices since the last upload; nothing to send.');
  process.exit(0);
}

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
// An upload cut short (the Mac went to sleep, the connection dropped) is tried once more.
try {
  run('gh', ['release', 'upload', RELEASE, ARCHIVE, '--repo', repo, '--clobber'], UPLOAD_TIMEOUT_MS);
} catch {
  console.log('Upload failed or took too long; trying once more.');
  run('gh', ['release', 'upload', RELEASE, ARCHIVE, '--repo', repo, '--clobber'], UPLOAD_TIMEOUT_MS);
}
writeFileSync(UPLOADED, print);

if (flag('no-rebuild') || hourly) {
  console.log('Uploaded. The next scheduled or manual rebuild will include these chains.');
} else {
  run('gh', ['workflow', 'run', 'sync-prices.yml', '--repo', repo]);
  console.log('Uploaded. GitHub is rebuilding the site; it takes about five minutes.');
}
