// Normalization shared by every chain: product names, units, barcodes and city names.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Unit = 'g' | 'ml' | 'u' | 'm' | '';

export function cleanText(s: string): string {
  return s
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,\-*]+|[\s,\-*]+$/g, '')
    .trim();
}

/**
 * A street address as shoppers read it. Some chains leave web-address fragments in the field
 * ("דרך בר יהודה http 147", "חורב 15 www.kulinarik.co.il/|"); those are dropped.
 */
export function cleanAddress(raw: string): string {
  return cleanText(
    cleanText(raw)
      .replace(/\bhttps?\b(?::\/*\S*)?|\bwww\.\S*|\S+\.(?:co\.il|com|org|net)\S*/gi, ' ')
      .replace(/\|/g, ' '),
  );
}

/** Digits only, without leading zeros, so the same barcode matches across chains. */
export function normalizeCode(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return digits;
}

const UNKNOWN_MANUFACTURER = /^(לא ידוע|לא מוגדר|unknown|כללי|ללא|אחר|no ?name|[.,\-_ 0-9]*)$/i;

export function cleanManufacturer(raw: string): string {
  const s = cleanText(raw);
  return UNKNOWN_MANUFACTURER.test(s) ? '' : s;
}

function unitFromText(text: string): { unit: Unit; factor: number } | null {
  const t = text.replace(/["'׳״.]/g, '').trim().toLowerCase();
  if (!t) return null;
  if (/מיליליטר|מל|ml|סמק|סמ"ק/.test(t)) return { unit: 'ml', factor: 1 };
  if (/ליטר|^ל$|liter|litre|^l$/.test(t)) return { unit: 'ml', factor: 1000 };
  if (/קילו|קג|kg|^ק$/.test(t)) return { unit: 'g', factor: 1000 };
  if (/גרם|^גר$|^ג$|gram|^gr$|^g$/.test(t)) return { unit: 'g', factor: 1 };
  if (/מטר|^מ$/.test(t)) return { unit: 'm', factor: 1 };
  if (/יח|unit|מארז|אריזה|זוג/.test(t)) return { unit: 'u', factor: 1 };
  return null;
}

// Weight and volume units as written in product names.
const SIZE_UNIT =
  `ק"ג|ק״ג|קג|קילו(?:גרם)?|גרם|גר'?|ג'|ג(?![א-ת])|מ"ל|מ״ל|מל(?![א-ת])|מיליליטר|ליטר|ל'|ל(?![א-ת])`;
const NAME_QTY = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${SIZE_UNIT}|יח'?(?:ידות)?)`, 'g');
// Multipacks: "6* 1.5 ל'", "200*3 גרם", "80X3 גרם" (count and size either way round), "18.4ג'*5".
// Only a name that says it is a pack is priced as one: without such a word, "אסם פתי בר 12*500גרם"
// is the supplier's carton and the price that of one 500 g packet.
const PACK_WORD =
  /מארז|(?:שלישי|רביעי|חמישי|שישי|שמיני)י?(?:ה|ת)(?![א-ת])|(?<![א-ת])זוג(?![א-ת])(?!\s*מרק)|מולטי\s*פק|קרטון|(?<![א-ת])בק(?=\s*\d)/;
const TIMES = `\\s*[*xX×]\\s*`;
const NAME_PACK = new RegExp(
  `(?<![\\d.,])(\\d+(?:[.,]\\d+)?)${TIMES}(\\d+(?:[.,]\\d+)?)\\s*(${SIZE_UNIT})` +
    `|(?<![\\d.,])(\\d+(?:[.,]\\d+)?)\\s*(${SIZE_UNIT})${TIMES}(\\d+)(?![\\d.,])`,
  'g',
);

const num = (s: string) => parseFloat(s.replace(',', '.'));

/** The size a product name states, and for a pack priced as one the two sizes an item of it could be. */
interface NamedSize {
  qty: number;
  unit: Unit;
  each: number[];
}

function sizeFromName(name: string): NamedSize | null {
  let last: RegExpExecArray | null = null;
  NAME_QTY.lastIndex = 0;
  for (let m = NAME_QTY.exec(name); m; m = NAME_QTY.exec(name)) last = m;
  let pack: RegExpExecArray | null = null;
  NAME_PACK.lastIndex = 0;
  for (let m = NAME_PACK.exec(name); m; m = NAME_PACK.exec(name)) pack = m;

  // A multipack wins when it is the last size in the name ("6*500 מ"ל" ends where "500 מ"ל" does).
  if (pack && (!last || pack.index + pack[0].length >= last.index + last[0].length)) {
    const [a, b, unitText] = pack[1] ? [num(pack[1]), num(pack[2]), pack[3]] : [num(pack[4]), num(pack[6]), pack[5]];
    const u = unitFromText(unitText);
    if (u && a > 0 && b > 0) {
      if (PACK_WORD.test(name)) {
        return { qty: round(a * b * u.factor), unit: u.unit, each: [round(a * u.factor), round(b * u.factor)] };
      }
      // One item of it: the bottle in "6*1.5 ליטר", the packet in "12*500גרם".
      const one = u.factor > 1 ? Math.min(a, b) : Math.max(a, b);
      return { qty: round(one * u.factor), unit: u.unit, each: [] };
    }
  }
  if (!last) return null;
  const value = num(last[1]);
  const u = unitFromText(last[2]);
  if (!u || !(value > 0)) return null;
  return { qty: round(value * u.factor), unit: u.unit, each: [] };
}

/**
 * Last "<number> <unit>" mention in a product name, e.g. `טונה 160 גרם` → 160 g. A pack counts as
 * its total (`מארז מים 6* 1.5 ל'` → 9000 ml) when the name says it is one.
 */
export function quantityFromName(name: string): { qty: number; unit: Unit } | null {
  const size = sizeFromName(name);
  return size && { qty: size.qty, unit: size.unit };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** A number written any of the usual ways: "12.90", "12,90" or "1,234". */
export function parseNumber(raw: string): number {
  const t = raw.trim();
  // A comma followed by exactly three digits groups thousands ("1,234"); "0,500" is still a decimal.
  if (/^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
  return parseFloat(/^\d+,\d+$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, ''));
}

// Package sizes outside this range (grams or millilitres) are almost certainly a unit mix-up,
// unless the product name says the same.
const BELIEVABLE = { min: 5, max: 50_000 };
const believable = (q: { qty: number; unit: Unit }) =>
  q.unit === 'u' || q.unit === 'm' || (q.qty >= BELIEVABLE.min && q.qty <= BELIEVABLE.max);
const same = (a: { qty: number; unit: Unit }, b: { qty: number; unit: Unit }) =>
  a.unit === b.unit && Math.abs(a.qty / b.qty - 1) < 0.2;
/** A number this small next to "litre" or "kilo" counts litres or kilos (3 ליטר, not 3 ml). */
const SMALL = 20;
const NO_SIZE = { qty: 0, unit: '' as Unit };

/**
 * Normalize the declared package size to grams / millilitres / units.
 * Weighted items are priced per kilogram, so they normalize to 1000 g.
 *
 * UnitQty names the unit of Quantity. UnitOfMeasure is the unit the shelf label compares by
 * ("100 גרם", "1 ק\"ג"), so it only hints at the kind of unit; a small number next to a litre or
 * kilo hint is read in litres or kilos. A believable size written in the product name wins when
 * the fields are off by about a thousand, give one bottle of a multipack, or give a small number
 * the name contradicts. A size nobody can believe (1 ml of lettuce) is dropped rather than shown.
 */
export function normalizeQuantity(
  quantityRaw: string,
  unitQtyRaw: string,
  unitOfMeasureRaw: string,
  weighted: boolean,
  name: string,
): { qty: number; unit: Unit } {
  if (weighted) return { qty: 1000, unit: 'g' };
  const qty = parseNumber(quantityRaw);
  const named = sizeFromName(name);
  // Only a believable size in the name may stand in for the fields or correct them.
  const fromName = named && believable(named) ? { qty: named.qty, unit: named.unit } : null;
  const declared = unitFromText(unitQtyRaw);
  const hinted = declared ? null : unitFromText(unitOfMeasureRaw.replace(/^[\d.\s]+/, ''));

  let result: { qty: number; unit: Unit } | null = null;
  if (qty > 0 && qty < 100_000) {
    if (declared) {
      result = { qty: round(qty * declared.factor), unit: declared.unit };
      // Some stores say "liter" or "kilo" but count in millilitres or grams (450 "liters" of
      // bread rolls): take the number as is when only that reading is believable.
      const asIs = { qty: round(qty), unit: declared.unit };
      if (declared.factor > 1 && !believable(result) && believable(asIs)) result = asIs;
    } else if (hinted) {
      // The same number read as grams or as kilograms: take the one that agrees with the name,
      // else kilos for a small number ("3" next to "ליטר" is a 3-litre bottle), else the one
      // that is a believable package size.
      const asIs = { qty: round(qty), unit: hinted.unit };
      const scaled = { qty: round(qty * hinted.factor), unit: hinted.unit };
      const options = hinted.factor === 1 ? [asIs] : [asIs, scaled];
      result =
        (named && options.find((o) => same(o, named))) ||
        (hinted.factor > 1 && qty <= SMALL ? scaled : null) ||
        options.find(believable) ||
        asIs;
    }
  }
  if (!result) return fromName ?? NO_SIZE;

  // The fields and the name agree: nothing to correct, however small (3 g of glue).
  if (named && same(result, named)) return result;
  // A multipack priced as a whole, with the fields giving one item of it.
  if (fromName && named!.each.some((each) => same(result!, { qty: each, unit: named!.unit }))) return fromName;
  // "1 unit" tells us nothing if the name carries a real size.
  if (result.unit === 'u' && result.qty === 1 && fromName && fromName.unit !== 'u') return fromName;
  if (result.unit === 'u' || result.unit === 'm') return result;
  if (fromName && fromName.unit === result.unit) {
    const ratio = result.qty / fromName.qty;
    if ((ratio > 500 && ratio < 2000) || (ratio > 1 / 2000 && ratio < 1 / 500)) return fromName;
  }
  // A small whole number the name contradicts is a count ("3" for a trio of cans) or a slip.
  if (fromName && fromName.unit !== 'u' && Number.isInteger(qty) && qty <= SMALL) return fromName;
  if (!believable(result)) return fromName ?? NO_SIZE;
  return result;
}

// ---- Cities -------------------------------------------------------------------------------

const citiesPath = fileURLToPath(new URL('../data/cities.json', import.meta.url));
const cityByCode: Record<string, string> = JSON.parse(readFileSync(citiesPath, 'utf8'));

function cityKey(s: string): string {
  return s
    .replace(/["'׳״`*()]/g, '')
    .replace(/[-–־]/g, ' ')
    .replace(/יי/g, 'י')
    .replace(/וו/g, 'ו')
    // "מודיעין עלית" and "מודיעין עילית" are both common.
    .replace(/עילית/g, 'עלית')
    .replace(/\s+/g, ' ')
    .trim();
}

const displayCity = (name: string) => name.replace(/\*/g, '').replace(/\s+/g, ' ').trim();

const cityByKey = new Map<string, string>();
for (const name of Object.values(cityByCode)) {
  if (/\((שבט|יישוב)\)/.test(name)) continue;
  cityByKey.set(cityKey(name), displayCity(name));
}

const ALIASES: Record<string, string> = {
  'תל אביב': 'תל אביב - יפו',
  תא: 'תל אביב - יפו',
  יפו: 'תל אביב - יפו',
  פת: 'פתח תקווה',
  ראשלצ: 'ראשון לציון',
  בש: 'באר שבע',
  מודיעין: 'מודיעין-מכבים-רעות',
  'מודיעין מכבים רעות': 'מודיעין-מכבים-רעות',
  נצרת: 'נצרת',
  'נצרת עילית': 'נוף הגליל',
  רמהש: 'רמת השרון',
  כס: 'כפר סבא',
  קש: 'קריית שמונה',
  'קרית מלאכי': 'קריית מלאכי',
  'בנימינה': 'בנימינה-גבעת עדה',
  'פרדס חנה': 'פרדס חנה-כרכור',
  'קדימה': 'קדימה-צורן',
  'מעלות': 'מעלות-תרשיחא',
  'יהוד': 'יהוד-מונוסון',
  'הרצליה פיתוח': 'הרצליה',
  קאסם: 'כפר קאסם',
  מוצקין: 'קרית מוצקין',
  'טירת הכרמל': 'טירת כרמל',
  'דלית אל כרמל': 'דאלית אל-כרמל',
  סכנין: "סח'נין",
  כרכור: 'פרדס חנה-כרכור',
  'גבעת עדה': 'בנימינה-גבעת עדה',
  // Cut short in store names; without it the bare "מודיעין" would win.
  'מודיעין עלי': 'מודיעין עילית',
};
// Aliases that are also everyday words or street names are matched only as the whole city field.
const NOT_SCANNED = new Set(['מעלות', 'קדימה']);
const aliasKeys: string[] = [];
for (const [alias, target] of Object.entries(ALIASES)) {
  const canonical = cityByKey.get(cityKey(target));
  if (!canonical) continue;
  cityByKey.set(cityKey(alias), canonical);
  if (!NOT_SCANNED.has(alias)) aliasKeys.push(cityKey(alias));
}

// Names worth looking for inside a store name when the chain gives no city. Only cities and
// local councils: village names ("רמות", "כרמל", "אלון") are also neighbourhoods and streets.
const townsPath = fileURLToPath(new URL('../data/towns.json', import.meta.url));
const townKeys = new Set((JSON.parse(readFileSync(townsPath, 'utf8')) as string[]).map(cityKey));
const byLength = (a: string, b: string) => b.length - a.length;
// Longest names first, so "קרית אונו" wins over shorter names contained in it.
const scanKeys = [...cityByKey.keys()].filter((k) => k.length >= 3 && townKeys.has(k)).sort(byLength);
// Store names and city fields also use the short names ("יפו", "מודיעין", "יהוד"). Addresses do
// not get these: "רחוב יפו" and "מוצקין 5" are streets.
const scanKeysWithAliases = [...new Set([...scanKeys, ...aliasKeys.filter((k) => k.length >= 3)])].sort(byLength);

/**
 * Phrases in which a city's name is a street or an area: "שדרות בן גוריון", "רח' חיפה",
 * "דרך חברון", "רבנו ירוחם", "אזור תעשייה", "נתיבות המשפט". The street's own name goes too,
 * since it is so often a city ("שדרות ירושלים"). "שדרות" alone, or before a hyphen, stays.
 */
const NOT_A_CITY =
  /(?<![א-ת])(?:(?:שדרות|שד\s*['׳`]|רחוב|רח['׳]?|דרך|רבנו|רבינו)\s+[א-ת][א-ת"'׳״`]*|אזור\s+(?:ה)?(?:תעשי(?:י)?ה|תעסוקה|מסחר)(?![א-ת])|נתיבות\s+המשפט)/g;

export const UNKNOWN_CITY = 'אחר';

/** Resolve a store's city from the CBS code or free text, falling back to the store name/address. */
export function resolveCity(rawCity: string, storeName: string, address: string): string {
  const raw = rawCity.trim();
  if (/^\d+$/.test(raw)) {
    const byCode = cityByCode[String(parseInt(raw, 10))];
    if (byCode) return displayCity(byCode);
  } else if (raw) {
    const hit = cityByKey.get(cityKey(raw));
    if (hit) return hit;
    if (/[א-ת]{2}/.test(raw)) {
      const scanned = scanForCity(raw, 4, scanKeysWithAliases);
      return scanned ?? cleanText(raw);
    }
  }
  // Three-letter names ("לוד", "עכו") double as street names, so only trust them in a store name.
  return scanForCity(storeName, 3, scanKeysWithAliases) ?? scanForCity(address, 4, scanKeys) ?? UNKNOWN_CITY;
}

/** True when `name` appears in `key` as whole words, and not as a street with its house number ("יפו 212"). */
function mentions(key: string, name: string): boolean {
  for (let i = key.indexOf(` ${name} `); i >= 0; i = key.indexOf(` ${name} `, i + 1)) {
    if (!/\d/.test(key.charAt(i + name.length + 2))) return true;
  }
  return false;
}

function scanForCity(text: string, minLength: number, keys: string[]): string | null {
  const key = ` ${cityKey(text.replace(NOT_A_CITY, ' '))} `;
  if (key.trim().length < 2) return null;
  for (const k of keys) {
    if (k.length >= minLength && mentions(key, k)) return cityByKey.get(k)!;
  }
  // Abbreviations that are unambiguous on their own ("פת" is not: it is also a Jerusalem junction).
  for (const alias of ['תל אביב', 'תא', 'ראשלצ', 'בש', 'רמהש']) {
    if (mentions(key, alias)) return cityByKey.get(alias) ?? null;
  }
  return null;
}

// ---- Stores and items that are not what they seem ------------------------------------------

/** Online shops, delivery depots and click-and-collect counters: not places a shopper walks into. */
const ONLINE_STOREFRONT =
  /^(?:וולט|wolt)|אינטרנט|אונליין|online|משלוחי(?:ם)?(?![א-ת])|(?<![א-ת])אתר(?:\s|$)|קליק\s*(?:ו|&|-)?\s*סע/i;

export const isOnlineStorefront = (storeName: string) => ONLINE_STOREFRONT.test(storeName.trim());

/**
 * Rows in a price file that are not products: coupons, bottle deposits, delivery fees, whole
 * departments and "general" catch-alls. Only the leading words count, so "קולה 0.5 חייב פקדון"
 * and "משלוח מנות" (a Purim gift basket) stay.
 */
const PSEUDO_ITEM = new RegExp(
  [
    /^(?:(?:הנחת|קוד|ה\s*\.?\s*נ\s*\.?)\s*)?קופון/,
    /^(?:אריזת\s*)?(?:פיקדון|פקדון)/,
    /^(?:דמי|עלות|קוד)\s+(?:משלוח|הובלה|ביטול)/,
    /^משלוח(?:ים)?(?!\s*מנות)(?![א-ת])/,
    /^הובלה(?![א-ת])/,
    /^מחלק(?:ת|ה)(?![א-ת])/,
    /^כללי(?![א-ת])/,
  ]
    .map((r) => r.source)
    .join('|'),
);
/** A single carrier bag at the till, as opposed to a pack of bags sold on the shelf. */
const CHECKOUT_BAG = /^שקי(?:ת|ות)\s+(?:קניות|ניילון|גופיה|רב\s*פעמית)/;

export const isPseudoItem = (name: string, price: number) =>
  PSEUDO_ITEM.test(name) || (price < 1 && CHECKOUT_BAG.test(name));
