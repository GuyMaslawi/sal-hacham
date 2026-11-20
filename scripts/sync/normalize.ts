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

const NAME_QTY =
  /(\d+(?:[.,]\d+)?)\s*(ק"ג|ק״ג|קג|קילו(?:גרם)?|גרם|גר'?|ג'|ג(?![א-ת])|מ"ל|מ״ל|מל(?![א-ת])|מיליליטר|ליטר|ל'|ל(?![א-ת])|יח'?(?:ידות)?)/g;

/** Last "<number> <unit>" mention in a product name, e.g. `טונה 160 גרם` → 160 g. */
export function quantityFromName(name: string): { qty: number; unit: Unit } | null {
  let last: RegExpExecArray | null = null;
  NAME_QTY.lastIndex = 0;
  for (let m = NAME_QTY.exec(name); m; m = NAME_QTY.exec(name)) last = m;
  if (!last) return null;
  const value = parseFloat(last[1].replace(',', '.'));
  const u = unitFromText(last[2]);
  if (!u || !(value > 0)) return null;
  return { qty: round(value * u.factor), unit: u.unit };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Normalize the declared package size to grams / millilitres / units.
 * Weighted items are priced per kilogram, so they normalize to 1000 g.
 */
export function normalizeQuantity(
  quantityRaw: string,
  unitQtyRaw: string,
  unitOfMeasureRaw: string,
  weighted: boolean,
  name: string,
): { qty: number; unit: Unit } {
  if (weighted) return { qty: 1000, unit: 'g' };
  const qty = parseFloat(quantityRaw.replace(',', '.'));
  const u = unitFromText(unitQtyRaw) ?? unitFromText(unitOfMeasureRaw.replace(/^[\d.\s]+/, ''));
  if (u && qty > 0 && qty < 100_000) {
    // "1 unit" tells us nothing if the name carries a real size.
    if (u.unit === 'u' && qty === 1) {
      const fromName = quantityFromName(name);
      if (fromName && fromName.unit !== 'u') return fromName;
    }
    return { qty: round(qty * u.factor), unit: u.unit };
  }
  return quantityFromName(name) ?? { qty: 0, unit: '' };
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
};
for (const [alias, target] of Object.entries(ALIASES)) {
  const canonical = cityByKey.get(cityKey(target));
  if (canonical) cityByKey.set(cityKey(alias), canonical);
}

// Names worth looking for inside a store name when the chain gives no city. Only cities and
// local councils: village names ("רמות", "כרמל", "אלון") are also neighbourhoods and streets.
const townsPath = fileURLToPath(new URL('../data/towns.json', import.meta.url));
const townKeys = new Set((JSON.parse(readFileSync(townsPath, 'utf8')) as string[]).map(cityKey));
// Longest names first, so "קרית אונו" wins over shorter names contained in it.
const scanKeys = [...cityByKey.keys()]
  .filter((k) => k.length >= 3 && townKeys.has(k))
  .sort((a, b) => b.length - a.length);

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
      const scanned = scanForCity(raw);
      return scanned ?? cleanText(raw);
    }
  }
  // Three-letter names ("לוד", "עכו") double as street names, so only trust them in a store name.
  return scanForCity(storeName, 3) ?? scanForCity(address, 4) ?? UNKNOWN_CITY;
}

function scanForCity(text: string, minLength = 4): string | null {
  const key = ` ${cityKey(text)} `;
  if (key.trim().length < 2) return null;
  for (const k of scanKeys) {
    if (k.length >= minLength && key.includes(` ${k} `)) return cityByKey.get(k)!;
  }
  // Abbreviations that are unambiguous on their own ("פת" is not: it is also a Jerusalem junction).
  for (const alias of ['תל אביב', 'תא', 'ראשלצ', 'בש', 'רמהש']) {
    if (key.includes(` ${alias} `)) return cityByKey.get(alias) ?? null;
  }
  return null;
}
