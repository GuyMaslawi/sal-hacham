// The regions Israelis name when they say where they live: "the north", "Haifa and the Krayot",
// "the Shfela". There is no official map of these, so each region is a list of its well-known
// towns, and every other town joins the region of the nearest of them. A town on a border can
// belong to two regions (Rishon LeZion is both "the centre" and "the Shfela").

import type { DataIndex } from '../types';
import { distanceKm, type Point } from './nearby';

export type RegionId =
  | 'north'
  | 'haifa'
  | 'hadera'
  | 'sharon'
  | 'center'
  | 'shfela'
  | 'jerusalem'
  | 'yosh'
  | 'south';

export interface Region {
  id: RegionId;
  name: string;
  /** "The stores in ___", e.g. "בצפון". */
  in: string;
  /** A few towns, so the shopper knows what the name covers. */
  hint: string;
}

export const REGIONS: Region[] = [
  { id: 'north', name: 'צפון', in: 'בצפון', hint: 'גליל, גולן ועמקים: עפולה, טבריה, כרמיאל, נהריה' },
  { id: 'haifa', name: 'חיפה והקריות', in: 'בחיפה והקריות', hint: 'חיפה, הקריות, נשר, טירת כרמל' },
  { id: 'hadera', name: 'חדרה והסביבה', in: 'באזור חדרה', hint: 'חדרה, זכרון יעקב, פרדס חנה, חריש' },
  { id: 'sharon', name: 'השרון', in: 'בשרון', hint: 'נתניה, כפר סבא, רעננה, הרצליה' },
  { id: 'center', name: 'מרכז', in: 'במרכז', hint: 'תל אביב, רמת גן, פתח תקווה, ראשון לציון' },
  { id: 'shfela', name: 'השפלה', in: 'בשפלה', hint: 'רחובות, נס ציונה, מודיעין, רמלה, לוד' },
  { id: 'jerusalem', name: 'ירושלים והסביבה', in: 'בירושלים והסביבה', hint: 'ירושלים, מבשרת ציון, בית שמש' },
  { id: 'yosh', name: 'יהודה ושומרון', in: 'ביהודה ושומרון', hint: 'אריאל, מעלה אדומים, ביתר עילית, אפרת' },
  { id: 'south', name: 'דרום', in: 'בדרום', hint: 'אשדוד, אשקלון, באר שבע, אילת' },
];

/** The towns that define each region. Names are spelled as in the price data. */
const ANCHORS: Record<string, RegionId[]> = {
  // North: the Galilee, the Golan and the valleys.
  נהריה: ['north'],
  עכו: ['north'],
  שלומי: ['north'],
  'מעלות-תרשיחא': ['north'],
  כרמיאל: ['north'],
  "סח'נין": ['north'],
  צפת: ['north'],
  'ראש פינה': ['north'],
  'חצור הגלילית': ['north'],
  'קרית שמונה': ['north'],
  קצרין: ['north'],
  טבריה: ['north'],
  'נוף הגליל': ['north'],
  נצרת: ['north'],
  'כפר כנא': ['north'],
  יפיע: ['north'],
  עפולה: ['north'],
  'מגדל העמק': ['north'],
  'בית שאן': ['north'],
  'רמת ישי': ['north'],
  'יקנעם עילית': ['north'],
  שפרעם: ['north'],
  טמרה: ['north'],
  // Haifa and the Krayot.
  חיפה: ['haifa'],
  'קרית אתא': ['haifa'],
  'קרית ביאליק': ['haifa'],
  'קרית מוצקין': ['haifa'],
  'קרית ים': ['haifa'],
  נשר: ['haifa'],
  'טירת כרמל': ['haifa'],
  'דאלית אל-כרמל': ['haifa'],
  'קרית טבעון': ['haifa'],
  רכסים: ['haifa'],
  יגור: ['haifa'],
  עתלית: ['haifa'],
  // Hadera, the coast up to Zikhron and Wadi Ara.
  חדרה: ['hadera'],
  'פרדס חנה-כרכור': ['hadera'],
  'אור עקיבא': ['hadera'],
  'זכרון יעקב': ['hadera'],
  'בנימינה-גבעת עדה': ['hadera'],
  קיסריה: ['hadera'],
  חריש: ['hadera'],
  'כפר קרע': ['hadera'],
  'אום אל-פחם': ['hadera'],
  'באקה אל-גרביה': ['hadera'],
  // The Sharon.
  נתניה: ['sharon'],
  'עמק חפר': ['sharon'],
  'כפר יונה': ['sharon'],
  'תל מונד': ['sharon'],
  'אבן יהודה': ['sharon'],
  'קדימה-צורן': ['sharon'],
  טייבה: ['sharon'],
  טירה: ['sharon'],
  קלנסווה: ['sharon'],
  רעננה: ['sharon'],
  'כפר סבא': ['sharon'],
  'הוד השרון': ['sharon'],
  'כוכב יאיר-צור יגאל': ['sharon'],
  הרצליה: ['sharon', 'center'],
  'רמת השרון': ['sharon', 'center'],
  // The centre: Tel Aviv and the towns around it.
  'תל אביב - יפו': ['center'],
  'רמת גן': ['center'],
  גבעתיים: ['center'],
  'בני ברק': ['center'],
  'פתח תקווה': ['center'],
  'גבעת שמואל': ['center'],
  'קרית אונו': ['center'],
  'אור יהודה': ['center'],
  'יהוד-מונוסון': ['center'],
  סביון: ['center'],
  'גני תקווה': ['center'],
  אזור: ['center'],
  חולון: ['center'],
  'בת ים': ['center'],
  'ראש העין': ['center'],
  אלעד: ['center'],
  'כפר קאסם': ['center'],
  'ראשון לציון': ['center', 'shfela'],
  שוהם: ['center', 'shfela'],
  // The Shfela.
  'מודיעין-מכבים-רעות': ['shfela', 'center'],
  לוד: ['shfela'],
  רמלה: ['shfela'],
  'באר יעקב': ['shfela'],
  'נס ציונה': ['shfela'],
  רחובות: ['shfela'],
  'מזכרת בתיה': ['shfela'],
  'קרית עקרון': ['shfela'],
  יבנה: ['shfela'],
  'גן יבנה': ['shfela'],
  גדרה: ['shfela'],
  'בית שמש': ['jerusalem', 'shfela'],
  // Jerusalem and the towns around it.
  ירושלים: ['jerusalem'],
  'מבשרת ציון': ['jerusalem'],
  'צור הדסה': ['jerusalem'],
  'מעלה אדומים': ['jerusalem', 'yosh'],
  'מישור אדומים': ['jerusalem', 'yosh'],
  'גבעת זאב': ['jerusalem', 'yosh'],
  'ביתר עילית': ['jerusalem', 'yosh'],
  אפרת: ['jerusalem', 'yosh'],
  'גוש עציון': ['jerusalem', 'yosh'],
  'כפר עציון': ['jerusalem', 'yosh'],
  // Judea and Samaria.
  'מודיעין עילית': ['yosh'],
  'כוכב יעקב': ['yosh'],
  'שער בנימין': ['yosh'],
  'בית אל': ['yosh'],
  אריאל: ['yosh'],
  'קרני שומרון': ['yosh'],
  עמנואל: ['yosh'],
  אלקנה: ['yosh'],
  רבבה: ['yosh'],
  'אלפי מנשה': ['yosh'],
  // Inside the Green Line, beside Kfar Sava.
  מתן: ['sharon'],
  אורנית: ['yosh'],
  // The south and the Negev.
  אשדוד: ['south'],
  אשקלון: ['south'],
  'קרית מלאכי': ['south'],
  'קרית גת': ['south'],
  'באר טוביה': ['south', 'shfela'],
  שדרות: ['south'],
  נתיבות: ['south'],
  אופקים: ['south'],
  רהט: ['south'],
  'באר שבע': ['south'],
  עומר: ['south'],
  להבים: ['south'],
  מיתר: ['south'],
  חורה: ['south'],
  ערד: ['south'],
  דימונה: ['south'],
  ירוחם: ['south'],
  'מצפה רמון': ['south'],
  אילת: ['south'],
};

const pointOf = (index: DataIndex, city: string): Point | null => {
  const c = index.geo[city];
  return c ? { lat: c[0], lng: c[1] } : null;
};

const cache = new WeakMap<DataIndex, Map<string, RegionId[]>>();

/** Every town with a location, and the regions it belongs to. */
export function cityRegions(index: DataIndex): Map<string, RegionId[]> {
  const cached = cache.get(index);
  if (cached) return cached;
  const anchors = Object.entries(ANCHORS)
    .map(([city, regions]) => ({ point: pointOf(index, city), regions }))
    .filter((a): a is { point: Point; regions: RegionId[] } => a.point !== null);
  const out = new Map<string, RegionId[]>();
  for (const city of Object.keys(index.geo)) {
    const own = ANCHORS[city];
    if (own) {
      out.set(city, own);
      continue;
    }
    const p = pointOf(index, city);
    if (!p) continue;
    let best: { d: number; regions: RegionId[] } | null = null;
    for (const a of anchors) {
      const d = distanceKm(p, a.point);
      if (!best || d < best.d) best = { d, regions: a.regions };
    }
    if (best) out.set(city, best.regions);
  }
  cache.set(index, out);
  return out;
}

/** The towns of one region. */
export function citiesIn(index: DataIndex, region: RegionId): Set<string> {
  const out = new Set<string>();
  for (const [city, regions] of cityRegions(index)) if (regions.includes(region)) out.add(city);
  return out;
}

/** The middle of a region, weighted by where its stores are. */
export function regionCenter(index: DataIndex, cities: Set<string>): Point | null {
  let lat = 0;
  let lng = 0;
  let n = 0;
  for (const s of index.stores) {
    const c = cities.has(s.city) ? index.geo[s.city] : undefined;
    if (!c) continue;
    lat += c[0];
    lng += c[1];
    n++;
  }
  return n ? { lat: lat / n, lng: lng / n } : null;
}
