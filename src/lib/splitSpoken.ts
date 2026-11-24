// A list said in one breath ("קוטג' לחם עגבניות ולחם פרוס") arrives from the speech recognizer
// as a single line. This finds where one item ends and the next begins, using the shopper's own
// catalog as the dictionary: "לחם פרוס" is how products are named, "קוטג' לחם" and "לחם
// עגבניות" are not.

import { normalize, stripDirectionMarks } from './text';

const NUMBER_WORDS = new Set([
  'אחד', 'אחת', 'שניים', 'שתיים', 'שני', 'שתי', 'שלוש', 'שלושה', 'ארבע', 'ארבעה', 'חמש', 'חמישה',
  'שש', 'שישה', 'שבע', 'שבעה', 'שמונה', 'תשע', 'תשעה', 'עשר', 'עשרה',
]);
// Words that continue a quantity: "2 קילו", "קילו וחצי", "3 חבילות".
const QTY_CONTINUES = /^(?:קילו|ק"ג|קג|וחצי|חבילות|חבילה|בקבוקים|יחידות|אריזות|פחיות|קרטונים)$/;
// After a number these make it a size, part of the product: "קולה 1.5 ליטר", "חלב 3 אחוז".
const SIZE_UNIT = /^(?:ליטר|ל'|גרם|גר|ג'|מ"ל|מל|אחוז|%)$/;
// Said between items and dropped: "חלב וגם לחם".
const JOINERS = new Set(['וגם', 'גם', 'ועוד']);

const isNumber = (w: string) => /^\d+(?:[.,]\d+)?$/.test(w) || NUMBER_WORDS.has(w);
const isQtyStart = (w: string) => isNumber(w) || w === 'קילו' || w === 'חצי';
const isSize = (w: string) => /^\d+(?:[.,]\d+)?%?$/.test(w) || SIZE_UNIT.test(w);

// Words that describe the one before them and are never bought on their own: "שמנת מתוקה",
// "לחם פרוס", "סבון כלים". Product names alone cannot always tell, in a small catalog.
const ATTACHES = new Set(
  `מתוקה מתוק חמוצה חמוץ פרוס פרוסה פרוסות פרוסים עמיד עמידה צהובה צהוב מלא מלאה אחיד קלוי
  קלויה טחון טחונה נמס גולמית מגורדת מגורד טרי טרייה טריים קפוא קפואה קפואים מיובש מיובשות
  מיובשים דל דלת מופחת אורגני אורגנית מלוח מלוחים חריף חריפה ירוק ירוקים ירוקה שחור שחורים
  שחורה אדום אדומה אדומים כתית מעולה טבעי טבעית מרוסק מרוסקת קצוץ קצוצה כפרי ביתי ביתית מתובל
  מתובלת לייט דיאט זירו בסמטי פרסי יסמין כלים כביסה טואלט אפייה אפיה זבל אדמה סויה מלך
  מינרליים מוגזים מטבח ידיים רצפה שיניים`
    .split(/\s+/)
    .map((w) => normalize(w)),
);

/** What the catalog says about spoken words, from its product names. */
export interface NameStats {
  /** Names that contain all these words, in this order. */
  count(words: string[]): number;
  /** The same, but the first word must open the name (as its first or second word). */
  countLeading(words: string[]): number;
  /** Names that begin with this word, i.e. where it names the product itself. */
  starts(word: string): number;
}

// A spoken word matches a name's word with a Hebrew ending added ("פרוס" → "פרוסה", "פרוסות"),
// or with the same stem ("תפוחים" said, "תפוח" written), but not any longer word ("שוקו" is
// not "שוקולד", "לחם" is not "לחמניות").
const ENDING = /^(?:ה|ת|ות|ים|ית|יות|י)?$/;
const stem = (w: string) => {
  const m = /^(.{3,}?)(?:יות|ות|ים|יה|ית|ה|י)$/.exec(w);
  return m ? m[1] : w;
};
const matches = (nameWord: string, nameStem: string, word: string, wordStem: string) =>
  nameStem === wordStem || (nameWord.startsWith(word) && ENDING.test(nameWord.slice(word.length)));

/** Statistics over product names (already normalized). Cached, since words repeat. */
export function nameStats(names: string[]): NameStats {
  const split = names.map((n) => n.split(' '));
  const stems = split.map((ws) => ws.map(stem));
  const counts = new Map<string, number>();
  const startCounts = new Map<string, number>();
  const tally = (words: string[], leading: boolean) => {
    const cacheKey = `${leading ? '^' : ''}${words.join(' ')}`;
    const hit = counts.get(cacheKey);
    if (hit !== undefined) return hit;
    let n = 0;
    const wordStems = words.map(stem);
    for (let i = 0; i < split.length; i++) {
      const name = split[i];
      const nameStems = stems[i];
      let at = 0;
      let ok = true;
      for (let k = 0; k < words.length; k++) {
        const w = words[k];
        while (at < name.length && !matches(name[at], nameStems[at], w, wordStems[k])) at++;
        if (at >= name.length || (leading && k === 0 && at > 1)) {
          ok = false;
          break;
        }
        at++;
      }
      if (ok) n++;
    }
    counts.set(cacheKey, n);
    return n;
  };
  return {
    count: (words) => tally(words, false),
    countLeading: (words) => tally(words, true),
    starts(word) {
      const hit = startCounts.get(word);
      if (hit !== undefined) return hit;
      let n = 0;
      const wordStem = stem(word);
      for (let i = 0; i < split.length; i++) if (split[i][0] && matches(split[i][0], stems[i][0], word, wordStem)) n++;
      startCounts.set(word, n);
      return n;
    },
  };
}

/** The search form of one spoken word (no quote marks, final letters folded). */
const key = (word: string) => normalize(word).split(' ')[0] ?? '';

/**
 * Do these words name one product rather than several? A word that seldom starts a product name
 * ("פרוס", "כלים", "סויה") describes the one before it. A word that often does ("לחם", "ביסלי")
 * joins only when names really carry these words together, in this order ("רוטב עגבניות").
 * Words the catalog does not know at all (a brand, a misheard word) never decide it.
 */
function joinValue(words: string[], stats: NameStats): number {
  const keys = words.map(key);
  // Joined only by describing words ("שמנת מתוקה"): sure, whatever the catalog holds.
  if (keys.slice(1).every((k) => ATTACHES.has(k))) return 1;
  const known = keys.filter((k) => k && (stats.count([k]) > 0 || ATTACHES.has(k)));
  if (known.length < 2) return WEAK_JOIN;
  const leads = (w: string) => stats.starts(w) / stats.count([w]);
  // Names that open with these very words, in this order ("לחם … פרוס", "רוטב עגבניות").
  const named = stats.countLeading(known);
  const ratio = named / Math.min(...known.map((k) => stats.count([k])));
  const sure = named >= 2 && ratio >= 0.08;
  let guessed = false;
  for (let k = 1; k < known.length; k++) {
    const w = known[k];
    if (ATTACHES.has(w)) continue;
    if (sure && (leads(w) < 0.5 || ratio >= 0.3)) continue;
    // A describing word ("עמיד", "סויה", "פרוסה") after a word that names products ("חלב",
    // "גבינה"), when names ever put the two together. Flavours said alone ("תפוזים בננות") do
    // not qualify: neither word opens names.
    const after = known[k - 1];
    if (
      (leads(w) < 0.1 && leads(after) >= 0.25) ||
      // …and a common pairing, not one odd product ("לחם עגבניות מיובשות").
      (describes(w, stats) &&
        leads(known[0]) >= 0.25 &&
        stats.count([known[0], w]) >= Math.max(2, 0.05 * stats.count([w])))
    ) {
      guessed = true;
      continue;
    }
    return 0;
  }
  return guessed ? WEAK_JOIN : 1;
}

/** What joining words is worth when no product name carries them together. */
const WEAK_JOIN = 0.4;
/** What a describing word left alone as an item costs ("פרוסה" is not something to buy). */
const LONE_DESCRIBER = -0.6;

/** A word that seldom opens a product name: it describes rather than names. */
const describes = (w: string, stats: NameStats) => {
  const n = stats.count([w]);
  return n > 0 && stats.starts(w) / n < 0.3;
};

/**
 * Split the words of one stretch into products. Each join is scored by how sure it is, and the
 * split with the most sure joins wins (on a tie, fewer pieces).
 */
function splitContent(words: string[], stats: NameStats): string[][] {
  const n = words.length;
  // best[i]: the best split of words[0..i), and where its last piece starts.
  const best: Array<{ value: number; pieces: number; from: number }> = [{ value: 0, pieces: 0, from: 0 }];
  for (let i = 1; i <= n; i++) {
    best[i] = { value: -1, pieces: Infinity, from: i - 1 };
    // Products are rarely named in more than four spoken words.
    for (let j = Math.max(0, i - 4); j < i; j++) {
      // A size ("1.5 ליטר", "3%") always belongs to the word before it.
      if (j > 0 && isSize(words[j])) continue;
      const content = words.slice(j, i).filter((w) => !isSize(w));
      let value = best[j].value;
      if (content.length > 1) {
        const join = joinValue(content, stats);
        if (join === 0) continue;
        value += join * (content.length - 1);
      } else if (j > 0 && content.length === 1) {
        const k = key(content[0]);
        if (ATTACHES.has(k)) value += 2 * LONE_DESCRIBER;
        else if (describes(k, stats)) value += LONE_DESCRIBER;
      }
      const pieces = best[j].pieces + 1;
      if (value > best[i].value + 1e-9 || (Math.abs(value - best[i].value) < 1e-9 && pieces < best[i].pieces)) {
        best[i] = { value, pieces, from: j };
      }
    }
  }
  const out: string[][] = [];
  for (let i = n; i > 0; i = best[i].from) out.unshift(words.slice(best[i].from, i));
  return out;
}

/**
 * Split one dictated line into items. Quantities start an item ("שני חלב שלוש עגבניות"), "ו"
 * before a known word starts one ("…ולחם פרוס"), and otherwise product names decide.
 */
export function splitSpokenLine(line: string, stats: NameStats): string[] {
  const words = stripDirectionMarks(line).split(/\s+/).filter(Boolean);
  // First cut at the clear signs; each stretch starts with its quantity words, if any.
  const stretches: string[][] = [];
  let current: string[] = [];
  const cut = () => {
    if (current.length) stretches.push(current);
    current = [];
  };
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    const prev = words[i - 1];
    const next = words[i + 1];
    if (JOINERS.has(w)) {
      cut();
      continue;
    }
    // "ושתי עגבניות": "and" before a quantity.
    if (i > 0 && NUMBER_WORDS.has(w.slice(1)) && w.startsWith('ו')) w = w.slice(1);
    // "ולחם": the "and" of a list, when the word without it is what the catalog knows.
    else if (i > 0 && /^ו[א-ת]{2,}/.test(w) && !w.startsWith('וו')) {
      const bare = w.slice(1);
      if (stats.count([key(bare)]) >= 2 && stats.count([key(bare)]) > 3 * stats.count([key(w)])) {
        cut();
        w = bare;
      }
    }
    const quantityHere = isQtyStart(w) && !(next && SIZE_UNIT.test(next)) && !(isNumber(w) && /%$/.test(next ?? ''));
    const prevIsQuantity = prev !== undefined && (isQtyStart(prev) || QTY_CONTINUES.test(prev));
    if (i > 0 && quantityHere && !prevIsQuantity && next !== undefined) cut();
    current.push(w);
  }
  cut();

  const items: string[] = [];
  for (const stretch of stretches) {
    // The quantity words at its start belong to the first product in it.
    let q = 0;
    while (q < stretch.length - 1 && (isQtyStart(stretch[q]) || QTY_CONTINUES.test(stretch[q]))) q++;
    const quantity = stretch.slice(0, q);
    const pieces = splitContent(stretch.slice(q), stats);
    pieces.forEach((piece, n) => items.push([...(n === 0 ? quantity : []), ...piece].join(' ')));
  }
  return items.filter(Boolean);
}
