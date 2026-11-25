// Is the price data still alive? Run by .github/workflows/health.yml after every rebuild and a
// few times a day. Prints a short report in Hebrew and exits 1 when something needs attention,
// so the workflow can open (or close) an issue, which GitHub emails to the repository's owner.
//
//   node scripts/health.ts [index-url]

/** The chains fetched on Guy's Mac (the hourly job), because they refuse GitHub's servers. */
export const FROM_ISRAEL = ['carrefour', 'victory', 'mahsaneihashuk', 'hazihinam', 'superpharm', 'netivhahesed', 'hcohen'];

/**
 * Chains publish once a day, but many skip Shabbat: Friday morning's file can be the newest until
 * Sunday morning, about 46 hours. Older than this is a chain that stopped, or a fetch that broke.
 */
export const CHAIN_STALE_HOURS = 50;
/** Rebuilds run hourly from the Mac and, less reliably, from GitHub's own schedule. */
export const SITE_STALE_HOURS = 12;

interface IndexLike {
  generatedAt: string;
  chains: Array<{ id: string; name: string }>;
  stores: Array<{ c: string; u: string }>;
}

export interface Health {
  problems: string[];
  /** One line per chain: name, stores, newest price list. For the report, healthy or not. */
  chains: Array<{ id: string; name: string; stores: number; newest: string; hours: number }>;
  siteHours: number;
}

/** "YYYY-MM-DDTHH:mm" in Israel time, as minutes, comparable with `israelNow`. */
const israelMinutes = (local: string) => {
  const [d, t = '00:00'] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, day, h, min) / 60000;
};

const israelNow = (now: Date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return israelMinutes(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`);
};

const hoursText = (h: number) => (h >= 48 ? `${Math.round(h / 24)} ימים` : `${Math.round(h)} שעות`);

export function assess(index: IndexLike, now: Date): Health {
  const nowMin = israelNow(now);
  // Two chains can share a display name ("סיטי מרקט"); tell them apart in the report.
  const seen = new Map<string, number>();
  for (const c of index.chains) seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
  const names = new Map(index.chains.map((c) => [c.id, (seen.get(c.name) ?? 0) > 1 ? `${c.name} (${c.id})` : c.name]));
  const byChain = new Map<string, { stores: number; newest: string }>();
  for (const s of index.stores) {
    const c = byChain.get(s.c) ?? { stores: 0, newest: '' };
    c.stores++;
    if (s.u > c.newest) c.newest = s.u;
    byChain.set(s.c, c);
  }

  const chains = [...byChain.entries()]
    .map(([id, c]) => ({
      id,
      name: names.get(id) ?? id,
      stores: c.stores,
      newest: c.newest,
      hours: (nowMin - israelMinutes(c.newest)) / 60,
    }))
    .sort((a, b) => b.hours - a.hours);

  const problems: string[] = [];
  const siteHours = (now.getTime() - new Date(index.generatedAt).getTime()) / 3_600_000;
  if (siteHours > SITE_STALE_HOURS) {
    problems.push(
      `האתר לא נבנה מחדש כבר ${hoursText(siteHours)}. כנראה גם המק כבוי וגם התזמון של GitHub לא רץ, או שהבנייה נכשלת (ראו Actions).`,
    );
  }

  const stale = chains.filter((c) => c.hours > CHAIN_STALE_HOURS);
  const israelStale = stale.filter((c) => FROM_ISRAEL.includes(c.id));
  const present = FROM_ISRAEL.filter((id) => byChain.has(id));
  if (present.length > 0 && israelStale.length === present.length) {
    problems.push(
      `כל ${present.length} הרשתות שמתעדכנות מהמק לא התעדכנו כבר ${hoursText(Math.min(...israelStale.map((c) => c.hours)))}. ` +
        'המשימה השעתית במק לא רצה: המק כבוי או במצב שינה, או ש-gh התנתק מחשבון GuyMaslawi. ' +
        'היומן: ~/Library/Logs/SalHacham/history.log',
    );
  }
  for (const c of stale) {
    if (israelStale.length === present.length && FROM_ISRAEL.includes(c.id)) continue;
    problems.push(`${c.name}: המחירים האחרונים מלפני ${hoursText(c.hours)} (${c.stores} סניפים).`);
  }
  for (const id of FROM_ISRAEL) {
    if (!byChain.has(id)) problems.push(`${names.get(id) ?? id}: הרשת חסרה לגמרי באתר.`);
  }

  return { problems, chains, siteHours };
}

/** The issue text: what is wrong first, then every chain's state for context. */
export function report(health: Health, runUrl?: string): string {
  const lines = [
    health.problems.length ? '**מה לא תקין:**' : '**הכל תקין.**',
    ...health.problems.map((p) => `- ${p}`),
    '',
    `האתר נבנה לפני ${hoursText(health.siteHours)}.${runUrl ? ` הבדיקה: ${runUrl}` : ''}`,
    '',
    '<details><summary>מצב כל הרשתות</summary>',
    '',
    '| רשת | סניפים | מחירים אחרונים | לפני |',
    '| --- | ---: | --- | --- |',
    ...health.chains.map((c) => `| ${c.name} | ${c.stores} | ${c.newest.replace('T', ' ')} | ${hoursText(c.hours)} |`),
    '',
    '</details>',
  ];
  return lines.join('\n');
}

// Command line: fetch the published index and report.
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] ?? 'https://guymaslawi.github.io/sal-hacham/data/index.json';
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) {
    console.log(`**לא ניתן לקרוא את רשימת הסניפים מהאתר** (${res.status} ${url}). ייתכן שהאתר למטה.`);
    process.exit(1);
  }
  const health = assess((await res.json()) as IndexLike, new Date());
  console.log(report(health, process.env.RUN_URL));
  process.exit(health.problems.length ? 1 : 0);
}
