// Staples bought by type, not by brand: produce, fresh meat and fish, eggs. Someone who writes
// "עגבניות" or "חזה עוף" wants to know where tomatoes or chicken breast are cheapest, not where one
// chain's own tomato is sold (only in that chain). For these, a list line is priced in every
// store at the cheapest product of the same type, as long as the shopper has not asked for that
// exact product.

import { normalize } from '../lib/text';
import type { Catalog } from './catalog';
import type { Product } from '../types';

export interface Kind {
  id: string;
  /** What the type is called on screen ("עגבניות"). */
  label: string;
  /**
   * Every group must be met by some word of the name; a group is alternative word beginnings
   * ("עגבני" meets "עגבניה" and "עגבניות"), or a whole word when it ends with "$" ("שום$" is
   * garlic, not "שומר" or "שומשום").
   */
  all: string[][];
  /** No word of the name may begin with one of these. */
  none?: string[];
  /** Words from the common "processed" list that are fine for this type ("בצל יבש" is fresh onion). */
  allow?: string[];
  /** Sold by the kilo, or by the unit (a pack). Prices of the two cannot be compared. */
  by: 'kg' | 'unit';
}

/** Never the fresh staple: processed, frozen, dried, cooked, prepared or a variety apart. */
const PROCESSED = [
  'קפוא', 'מקפוא', 'קפא', 'מעושנ', 'מבושל', 'צלוי', 'אפוי', 'ממולא', 'ברוטב', 'במרינדה', 'מרינד', 'בציפוי', 'מצופ',
  'מטוגנ', 'מוקפצ', 'מיובש', 'יבש', 'מסוכר', 'מסוכרת', 'בטעמ', 'כבוש', 'חמוצ', 'בחומצ', 'שימור', 'ציפס',
  'פסטרמה', 'נקניק', 'שווארמה', 'קבב', 'המבורגר', 'שיפוד', 'מתובל', 'סלט', 'רסק', 'מרוסק', 'קצוצ', 'חתוכ',
  'ממרח', 'מחית', 'קפואה', 'קפואימ', 'מוכנ', 'לתינוק', 'במלח', 'מוחמצ', 'להחמצה', 'במיונז', 'פיקנטי', 'סביח',
  'מטבוחה', 'קציצ', 'בורקס', 'פירה', 'סלסה', 'צימוק', 'מאפה', 'קטרינג', 'גפרור', 'שבבי', 'אבקת',
  // Deli salads and ready dishes: "חציל בטחינה", "גזר מרוקאי", "כנפיים ברביקיו", "סלק שמיר".
  'האש', 'בטחינה', 'שמיר', 'הגבינות', 'קולסלו', 'רוטיסרי', 'קונפי', 'ברביקיו', 'בצילי', 'בשומ', 'ודבש',
  'בעשבי', 'בפסטו', 'רצועות', 'מגורד', 'מקולפ', 'קלופ', 'קלוף', 'קלוי', 'מרוקאי', 'קוריאני', 'רומני',
  'יווני', 'תאילנדי', 'מזרחי', 'ירקות', 'סוכר', 'טבעי', 'בשוקולד', 'בקינמונ', 'טבעות',
];

/**
 * A type's first word group must be the first word of the name, after any of these: produce and
 * meat are named by what they are ("עגבניה", "חזה עוף טרי"), while prepared food only mentions
 * them ("גאודה עגבניות וזיתים", "בורקס תפו"א", "כבד עוף עם בצל").
 */
const LEAD = ['מנות', 'מנה', 'דג', 'טרי'].map((w) => normalize(w));

const KINDS_SOURCE: Kind[] = [
  // Vegetables, by the kilo.
  { id: 'tomato', label: 'עגבניות', all: [['עגבני']], none: ['שרי', 'מגי', 'תמר', 'צבעונ', 'ענב', 'מיני', 'אורגני', 'לבבות'], by: 'kg' },
  { id: 'cherry-tomato', label: 'עגבניות שרי', all: [['עגבני'], ['שרי']], none: ['אורגני'], by: 'kg' },
  { id: 'cucumber', label: 'מלפפונים', all: [['מלפפונ']], none: ['בייבי', 'מיני', 'אורגני'], by: 'kg' },
  { id: 'red-pepper', label: 'פלפל אדום', all: [['פלפל'], ['אדומ']], none: ['חריפ', 'צ׳ילי', 'מיני', 'אורגני'], by: 'kg' },
  { id: 'yellow-pepper', label: 'פלפל צהוב', all: [['פלפל'], ['צהוב']], none: ['חריפ', 'מיני', 'אורגני'], by: 'kg' },
  { id: 'green-pepper', label: 'פלפל ירוק', all: [['פלפל'], ['ירוק']], none: ['חריפ', 'צ׳ילי', 'מיני', 'אורגני'], by: 'kg' },
  { id: 'onion', label: 'בצל', all: [['בצל']], none: ['אדומ', 'סגול', 'ירוק', 'שאלוט', 'שאלוטס', 'פנינה', 'קטנ', 'אורגני'], allow: ['יבש'], by: 'kg' },
  { id: 'red-onion', label: 'בצל סגול', all: [['בצל'], ['אדומ', 'סגול']], none: ['אורגני'], by: 'kg' },
  { id: 'potato', label: 'תפוחי אדמה', all: [['תפוח', 'תפוא'], ['אדמה', 'תפוא']], none: ['בטטה', 'מתוק', 'בייבי', 'אורגני', 'ירושלמי', 'קסביה', 'כסביה'], by: 'kg' },
  { id: 'sweet-potato', label: 'בטטה', all: [['בטטה', 'בטטות']], none: ['אורגני', 'ירושלמי', 'קסביה', 'כסביה', 'קוסביה', 'בשמנ'], by: 'kg' },
  { id: 'carrot', label: 'גזר', all: [['גזר']], none: ['בייבי', 'גמדי', 'אורגני', 'מגורד'], by: 'kg' },
  { id: 'zucchini', label: 'קישואים', all: [['קישוא']], none: ['אורגני'], by: 'kg' },
  { id: 'eggplant', label: 'חצילים', all: [['חציל']], none: ['אורגני', 'בלאדי', 'בלדי'], by: 'kg' },
  { id: 'cabbage', label: 'כרוב', all: [['כרוב']], none: ['אדומ', 'סגול', 'כרובית', 'ניצנ', 'סיני', 'ברוקולי', 'קייל', 'אורגני', 'במיונז', 'אסיאתי'], by: 'kg' },
  { id: 'red-cabbage', label: 'כרוב אדום', all: [['כרוב'], ['אדומ', 'סגול']], none: ['אורגני'], by: 'kg' },
  { id: 'cauliflower', label: 'כרובית', all: [['כרובית']], none: ['אורגני'], by: 'kg' },
  { id: 'broccoli', label: 'ברוקולי', all: [['ברוקולי']], none: ['אורגני'], by: 'kg' },
  { id: 'beet', label: 'סלק', all: [['סלק']], none: ['עלי', 'אורגני'], by: 'kg' },
  { id: 'radish', label: 'צנון', all: [['צנונ']], none: ['אורגני'], by: 'kg' },
  { id: 'kohlrabi', label: 'קולורבי', all: [['קולורבי', 'קולרבי']], by: 'kg' },
  { id: 'turnip', label: 'לפת', all: [['לפת']], by: 'kg' },
  { id: 'fennel', label: 'שומר', all: [['שומר']], none: ['זרעי', 'שלמ', 'טחונ', 'בשבש'], by: 'kg' },
  { id: 'pumpkin', label: 'דלעת', all: [['דלעת']], none: ['גרעינ', 'ערמונ', 'אורגני'], by: 'kg' },
  { id: 'butternut', label: 'דלורית', all: [['דלורית']], by: 'kg' },
  { id: 'green-beans', label: 'שעועית ירוקה', all: [['שעועית'], ['ירוק']], by: 'kg' },
  { id: 'mushrooms', label: 'פטריות', all: [['פטרי']], none: ['פורטבלו', 'שיטאקי', 'יער', 'צדפה', 'שמפיניונ', 'למילוי'], by: 'kg' },
  { id: 'garlic', label: 'שום', all: [['שומ$']], none: ['גבישי', 'טחונ', 'כתוש', 'שחור', 'ירוק', 'סיני', 'אורגני', 'פרוס', 'פלחימ'], allow: ['יבש'], by: 'kg' },
  { id: 'ginger', label: 'ג׳ינג׳ר', all: [['גינגר', 'זנגביל']], by: 'kg' },
  // Fruit, by the kilo.
  { id: 'banana', label: 'בננות', all: [['בננ']], none: ['אורגני', 'בננית'], by: 'kg' },
  { id: 'apple', label: 'תפוחי עץ', all: [['תפוח']], none: ['אדמה', 'תפוא', 'אורגני', 'עוגה', 'תפוחיות', 'ירושלמי'], by: 'kg' },
  { id: 'pear', label: 'אגסים', all: [['אגס']], none: ['אורגני'], by: 'kg' },
  { id: 'avocado', label: 'אבוקדו', all: [['אבוקדו']], none: ['אורגני', 'ממרח'], by: 'kg' },
  { id: 'lemon', label: 'לימון', all: [['לימונ']], none: ['ליים$', 'מיצ', 'עשב', 'אורגני', 'פרסי', 'פרוס'], by: 'kg' },
  { id: 'orange', label: 'תפוזים', all: [['תפוז']], none: ['דם', 'סיני', 'מיצ', 'אורגני'], by: 'kg' },
  { id: 'clementine', label: 'קלמנטינות', all: [['קלמנטינ', 'מנדרינ']], none: ['אורגני'], by: 'kg' },
  { id: 'grapefruit', label: 'אשכולית', all: [['אשכולית']], none: ['אורגני'], by: 'kg' },
  { id: 'pomelo', label: 'פומלה', all: [['פומלה']], by: 'kg' },
  { id: 'pomelit', label: 'פומלית', all: [['פומלית']], by: 'kg' },
  { id: 'mango', label: 'מנגו', all: [['מנגו']], none: ['אורגני'], by: 'kg' },
  { id: 'persimmon', label: 'אפרסמון', all: [['אפרסמונ']], by: 'kg' },
  { id: 'kiwi', label: 'קיווי', all: [['קיוי']], none: ['זהוב', 'אורגני'], by: 'kg' },
  { id: 'pomegranate', label: 'רימונים', all: [['רימונ']], none: ['גרעינ'], by: 'kg' },
  { id: 'plum', label: 'שזיפים', all: [['שזיפ']], none: ['אורגני', 'מגולענ', 'גלעינ', 'אמריקאי', 'חרצנ'], by: 'kg' },
  { id: 'peach', label: 'אפרסקים', all: [['אפרסק']], none: ['אורגני'], by: 'kg' },
  { id: 'nectarine', label: 'נקטרינות', all: [['נקטרינ']], none: ['אורגני'], by: 'kg' },
  { id: 'grapes', label: 'ענבים', all: [['ענב']], none: ['אורגני', 'עלי'], by: 'kg' },
  { id: 'watermelon', label: 'אבטיח', all: [['אבטיח']], none: ['גרעינ'], by: 'kg' },
  { id: 'melon', label: 'מלון', all: [['מלונ']], by: 'kg' },
  { id: 'prickly-pear', label: 'סברס', all: [['סברס']], by: 'kg' },
  { id: 'guava', label: 'גויאבה', all: [['גויאבה']], by: 'kg' },
  // Chicken and turkey, fresh, by the kilo.
  { id: 'chicken-breast', label: 'חזה עוף', all: [['חזה'], ['עופ']], none: ['שניצל', 'רצועות', 'אווז', 'הודו', 'חצוי', 'עצמ', 'עע'], by: 'kg' },
  { id: 'chicken-schnitzel', label: 'שניצל עוף', all: [['שניצל'], ['עופ']], none: ['תירס', 'פירור', 'קורנפלקס'], by: 'kg' },
  { id: 'chicken-thighs', label: 'ירכיים עוף', all: [['ירכ']], none: ['הודו', 'אווז', 'כבש'], by: 'kg' },
  { id: 'chicken-legs', label: 'כרעיים עוף', all: [['כרעי']], none: ['הודו', 'אווז'], by: 'kg' },
  { id: 'chicken-drumsticks', label: 'שוקיים עוף', all: [['שוקי']], none: ['הודו', 'אווז', 'בקר'], by: 'kg' },
  { id: 'chicken-wings', label: 'כנפיים עוף', all: [['כנפ']], none: ['הודו', 'הודיות', 'אווז'], by: 'kg' },
  { id: 'pargiot', label: 'פרגיות', all: [['פרגי']], by: 'kg' },
  { id: 'whole-chicken', label: 'עוף שלם', all: [['עופ'], ['שלמ', 'במשקל']], none: ['חזה', 'כרעי', 'כנפ', 'שוקי', 'ירכ', 'טחונ', 'כבד', 'לבבות', 'קורקבנ', 'פרגי', 'שניצל', 'גרונ'], by: 'kg' },
  { id: 'chicken-liver', label: 'כבד עוף', all: [['כבד'], ['עופ']], none: ['בצל', 'קצוצ', 'פטה'], by: 'kg' },
  { id: 'ground-chicken', label: 'עוף טחון', all: [['טחונ', 'עופ'], ['טחונ'], ['עופ']], by: 'kg' },
  { id: 'ground-turkey', label: 'הודו טחון', all: [['טחונ', 'הודו'], ['טחונ'], ['הודו']], by: 'kg' },
  { id: 'turkey-schnitzel', label: 'שניצל הודו', all: [['שניצל'], ['הודו']], by: 'kg' },
  // Beef, fresh, by the kilo.
  { id: 'ground-beef', label: 'בשר טחון', all: [['בשר', 'טחונ'], ['טחונ']], none: ['עופ', 'הודו', 'כבש', 'טלה', 'דג'], by: 'kg' },
  { id: 'entrecote', label: 'אנטריקוט', all: [['אנטריקוט']], none: ['רוסטביפ', 'אצבעות', 'נתחי', 'טחונ'], by: 'kg' },
  { id: 'asado', label: 'אסאדו', all: [['אסאדו']], none: ['טחונ', 'מיני', 'כבש', 'טלה', 'בשורשימ'], by: 'kg' },
  { id: 'shoulder-roast', label: 'צלי כתף', all: [['צלי', 'כתפ'], ['כתפ']], none: ['כבש', 'טלה', 'עגל'], by: 'kg' },
  { id: 'goulash', label: 'גולש', all: [['גולש']], by: 'kg' },
  { id: 'shank', label: 'שריר', all: [['שריר']], by: 'kg' },
  { id: 'sinta', label: 'סינטה', all: [['סינטה']], by: 'kg' },
  { id: 'shaitel', label: 'שייטל', all: [['שיטל']], by: 'kg' },
  // Fish, fresh, by the kilo.
  { id: 'salmon', label: 'פילה סלמון', all: [['סלמונ', 'פילה'], ['סלמונ']], none: ['גבינה', 'הילטונ', 'גרבלקס', 'גראבלקס', 'עישונ', 'בעישונ', 'פרוס', 'פלטה', 'סשימי', 'קראסט', 'שלמ'], by: 'kg' },
  { id: 'tilapia', label: 'אמנון שלם', all: [['אמנונ', 'נסיכת']], by: 'kg' },
  // Fresh only: vacuum-packed "5-7" fillets are frozen ones at a third of the price.
  { id: 'tilapia-fillet', label: 'פילה אמנון טרי', all: [['פילה'], ['אמנונ', 'נסיכת'], ['טרי']], by: 'kg' },
  { id: 'denis', label: 'דניס', all: [['דניס']], by: 'kg' },
  { id: 'sea-bass', label: 'לברק שלם', all: [['לברק']], by: 'kg' },
  { id: 'carp', label: 'קרפיון', all: [['קרפיונ']], by: 'kg' },
];

/** A word beginning, normalized like product names; a trailing "$" (kept) asks for the whole word. */
const stemOf = (stem: string) => (stem.endsWith('$') ? `${normalize(stem.slice(0, -1))}$` : normalize(stem));

export const KINDS: Kind[] = KINDS_SOURCE.map((k) => {
  const allow = new Set((k.allow ?? []).map(stemOf));
  return {
    ...k,
    all: k.all.map((group) => group.map(stemOf)),
    none: [...(k.none ?? []), ...PROCESSED.filter((w) => !allow.has(stemOf(w)))].map(stemOf),
  };
});
const KIND_BY_ID = new Map(KINDS.map((k) => [k.id, k]));
export const kindById = (id: string) => KIND_BY_ID.get(id);

// Eggs: by size and count, from any farm. Free-range, organic and enriched eggs are kinds apart.
const EGG_SIZES: Record<string, string> = { s: 'S', m: 'M', l: 'L', xl: 'XL' };
const EGG_NOT = /חופש|אורגני|אומגה|שליו|מבושל|קשות|מועשר|כפרי|חצר|ביצת/;

function eggKind(p: Product): Kind | null {
  if (p.weighted || !/ביצ/.test(p.name) || EGG_NOT.test(p.name)) return null;
  const size = /(?:^|[^a-z])(xl|l|m|s)(?![a-z])/i.exec(p.name)?.[1]?.toLowerCase();
  const count = Number(/(\d{1,2})\s*(?:יח|ביצים|יחידות|\b)/.exec(p.name)?.[1] ?? (p.unit === 'u' && p.qty > 1 ? p.qty : 0));
  if (!size || ![6, 10, 12, 18, 20, 24, 30].includes(count)) return null;
  const id = `eggs-${EGG_SIZES[size]}-${count}`;
  let kind = KIND_BY_ID.get(id);
  if (!kind) {
    kind = { id, label: `ביצים ${EGG_SIZES[size]} (${count})`, all: [], by: 'unit' };
    KIND_BY_ID.set(id, kind);
  }
  return kind;
}

const words = (p: Product) =>
  normalize(p.name)
    .split(' ')
    .map((w) => w.replace(/\.+$/, ''))
    .filter(Boolean);

const kindCache = new WeakMap<Product, Kind | null>();

/** The staple type a product is, or null for anything bought by brand. */
export function kindOf(p: Product): Kind | null {
  const cached = kindCache.get(p);
  if (cached !== undefined) return cached;
  let found: Kind | null = eggKind(p);
  if (!found) {
    const ws = words(p);
    const is = (w: string, stem: string) => (stem.endsWith('$') ? w === stem.slice(0, -1) : w.startsWith(stem));
    const starts = (stem: string) => ws.some((w) => is(w, stem));
    let lead = 0;
    while (lead < ws.length - 1 && LEAD.includes(ws[lead])) lead++;
    for (const k of KINDS) {
      if ((k.by === 'kg') !== p.weighted) continue;
      if (!k.all[0].some((stem) => is(ws[lead] ?? '', stem))) continue;
      if (!k.all.every((group) => group.some(starts))) continue;
      if (k.none?.some(starts)) continue;
      found = k;
      break;
    }
  }
  kindCache.set(p, found);
  return found;
}

const membersCache = new WeakMap<Catalog, Map<string, Product[]>>();

/** Every product of a type among the chosen stores. */
export function productsOfKind(catalog: Catalog, kindId: string): Product[] {
  let byKind = membersCache.get(catalog);
  if (!byKind) {
    byKind = new Map();
    for (const p of catalog.list) {
      const k = kindOf(p);
      if (!k) continue;
      const list = byKind.get(k.id);
      if (list) list.push(p);
      else byKind.set(k.id, [p]);
    }
    membersCache.set(catalog, byKind);
  }
  return byKind.get(kindId) ?? [];
}

const ceilingCache = new WeakMap<Catalog, Map<string, number>>();

/**
 * The shelf price above which a product of this type is something else under the same name: a
 * deli salad called "חצילים", dried mango, smoked salmon. Two and a half times the typical price
 * (the median of each store's cheapest), so a store that only has the salad counts as not
 * having the vegetable rather than as selling it at five times the price.
 */
export function kindCeiling(catalog: Catalog, kindId: string): number {
  let byKind = ceilingCache.get(catalog);
  if (!byKind) ceilingCache.set(catalog, (byKind = new Map()));
  const known = byKind.get(kindId);
  if (known !== undefined) return known;
  const cheapest = new Map<string, number>();
  for (const p of productsOfKind(catalog, kindId)) {
    for (const [store, offer] of p.offers) {
      const was = cheapest.get(store);
      if (was === undefined || offer.price < was) cheapest.set(store, offer.price);
    }
  }
  const prices = [...cheapest.values()].sort((a, b) => a - b);
  const ceiling = prices.length ? prices[Math.floor((prices.length - 1) / 2)] * 2.5 : Infinity;
  byKind.set(kindId, ceiling);
  return ceiling;
}
