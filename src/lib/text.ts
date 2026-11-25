// Hebrew-aware text helpers for search and for parsing pasted shopping lists.

/**
 * Lowercase, drop niqqud and quote marks, fold final letters, keep letters/digits/%.
 * Doubled ו and י are folded too, so both spellings meet: "קריית ביאליק" finds "קרית ביאליק",
 * "וויסקי" finds "ויסקי".
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    // The Hebrew hyphen (maqaf) separates words, like "-": "חד־פעמי" is "חד פעמי".
    .replace(/־/g, ' ')
    .replace(/[֑-ׇ]/g, '')
    // Straight and curly quotes alike (iPhones and Word type curly ones): "צ’יפס" is "צ'יפס".
    .replace(/["'׳״`´‘’“”„]/g, '')
    .replace(/[^0-9a-zא-ת%.]+/g, ' ')
    .replace(/ך/g, 'כ')
    .replace(/ם/g, 'מ')
    .replace(/ן/g, 'נ')
    .replace(/ף/g, 'פ')
    .replace(/ץ/g, 'צ')
    .replace(/וו+/g, 'ו')
    .replace(/יי+/g, 'י')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Other ways a shopper may write the same Hebrew word: a plural for the singular that produce is
 * sold under ("עגבניות" → "עגבניה", "מלפפונים" → "מלפפונ"). `word` must already be normalized.
 */
export function wordForms(word: string): string[] {
  if (word.length < 5) return [];
  const base = word.slice(0, -2);
  if (word.endsWith('ות')) return [`${base}ה`, `${base}ת`];
  if (word.endsWith('ימ')) return [base, `${base}ה`];
  // The plural before another word: "תפוחי אדמה" is sold as "תפוח אדמה", "עלי בייבי" as "עלה".
  if (word.endsWith('י') && !word.endsWith('וי')) return [word.slice(0, -1), `${word.slice(0, -1)}ה`];
  return [];
}

export const tokens = (s: string) => normalize(s).split(' ').filter(Boolean);

/** Digits only, no leading zeros: the form barcodes are stored in. */
export const normalizeCode = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '');

/**
 * Remove invisible right-to-left marks. WhatsApp puts them in copied messages and Apple's speech
 * recognizer starts every Hebrew phrase with one; left in, "‏שתי עגבניות" would not read as 2.
 */
export const stripDirectionMarks = (s: string) => s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');

export interface ParsedLine {
  label: string;
  qty: number;
  /** The quantity was given in kilos ("חצי קילו גבינה"), not as a count. */
  kg?: boolean;
}

/**
 * Parse a free-text shopping list, one item per line (or comma separated).
 * Understands "2 חלב", "חלב x2", "חלב 2", "חלב - 2 יח'", bullets and checkbox marks.
 */
export function parseShoppingList(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const tidy = stripDirectionMarks(text)
    // Curly quotes, as iPhones and Word type them: ק”ג is ק"ג.
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    // "1/2 קילו", "½ קילו".
    .replace(/(^|\s)(?:1\/2|½)(?=\s*(?:ק"ג|ק״ג|קג|קילו))/g, '$1חצי');
  // A comma between digits is a decimal point ("1,5 ק"ג"), not a new item.
  for (const rawLine of tidy.split(/\n|;|(?<!\d),|,(?!\d)/)) {
    let line = spokenToWritten(
      rawLine
        .replace(/^[\s\-–•*·▪◦☐☑✓✔✅⬜🔲]+/u, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim(),
    );
    // Headings, not products: "רשימה לסופר:", "ירקות:", "רשימת קניות".
    if (!line || /:$/.test(line) || HEADING.test(line)) continue;
    let qty = 1;
    let kg = false;

    const KILO = `(?:ק"ג|ק״ג|קג|קילו)`;
    // "קילו עגבניות" or "עגבניות קילו" without a number means one kilo.
    const kiloLead = new RegExp(`^(\\d+(?:[.,]\\d+)?|חצי)?\\s*${KILO}\\s+`).exec(line);
    const kiloTrail = new RegExp(`\\s+(?:(\\d+(?:[.,]\\d+)?|חצי)\\s*)?${KILO}$`).exec(line);
    const multiplier = /\s*[x×*]\s*(\d{1,2})$/i.exec(line) ?? /^(\d{1,2})\s*[x×*]\s*/i.exec(line) ?? /^[x×*]\s*(\d{1,2})\s+/i.exec(line);
    const unitsSuffix = /\s*[-–:]?\s*(\d{1,2})\s*(?:יח'?|יחידות|חבילות|אריזות|בקבוקים|קרטונים)$/.exec(line);
    // A bare number counts as a quantity only when it is small: "12 ביצים" or "ביצים 30" is a
    // pack size, not twelve or thirty cartons.
    const leading = /^([1-9])\s+(?=\D)/.exec(line);
    const trailing = /\s+([1-9])$/.exec(line);
    const kilos = (m: RegExpExecArray) => (!m[1] ? 1 : m[1] === 'חצי' ? 0.5 : parseFloat(m[1].replace(',', '.')));

    if (kiloLead) {
      qty = kilos(kiloLead);
      kg = true;
      line = line.slice(kiloLead[0].length);
    } else if (kiloTrail) {
      qty = kilos(kiloTrail);
      kg = true;
      line = line.slice(0, kiloTrail.index);
    } else if (multiplier) {
      qty = Number(multiplier[1]);
      line = line.replace(multiplier[0], ' ');
    } else if (unitsSuffix) {
      qty = Number(unitsSuffix[1]);
      line = line.slice(0, unitsSuffix.index);
    } else if (leading && !/^\d+\s*(?:%|גרם|ג'|מ"ל|מל|ליטר)(?![א-ת])/.test(line)) {
      // ("3 מלפפונים" is three cucumbers; only "3 מל" on its own is a size.)
      qty = Number(leading[1]);
      line = line.slice(leading[0].length);
    } else if (trailing && !/%\s*$/.test(line)) {
      qty = Number(trailing[1]);
      line = line.slice(0, trailing.index);
    }

    const label = line
      .replace(/\s+/g, ' ')
      .replace(/[\s\-–:.]+$/, '')
      .trim();
    if (label) out.push({ label, qty: Math.min(Math.max(Math.round(qty * 2) / 2, 0.5), 99), ...(kg ? { kg } : {}) });
  }
  return out;
}

const HEADING = /^(?:רשימת|רשימה)\s*(?:קניות|לסופר|למכולת)?$|^קניות$/;

const NUMBER_WORDS: Record<string, number> = {
  אחד: 1,
  אחת: 1,
  שניים: 2,
  שתיים: 2,
  שני: 2,
  שתי: 2,
  שלוש: 3,
  שלושה: 3,
  ארבע: 4,
  ארבעה: 4,
  חמש: 5,
  חמישה: 5,
  שש: 6,
  שישה: 6,
  שבע: 7,
  שבעה: 7,
  שמונה: 8,
  תשע: 9,
  תשעה: 9,
  עשר: 10,
  עשרה: 10,
};
const NUMBER_WORD = Object.keys(NUMBER_WORDS).join('|');

// What people say before an item when they dictate a list: "וגם חלב", "תוסיף לחם".
const SPOKEN_LEAD = /^(?:וגם|גם|ועוד|עוד|תוסיף|תוסיפי|תרשום|תרשמי|צריך|צריכים|צריכה|לקנות|קנה|קני)\s+/;
// "2 חבילות קוטג'" is two of the cottage cheese; the pack word is not part of the product.
const PACK_WORD = /^(?:חבילות|חבילה|בקבוקים|בקבוק|יחידות|יחידה|אריזות|אריזה|קרטונים|קרטון|פחיות|פחית)\s+(?:של\s+)?/;

/** Write spoken quantities as digits: "שני קילו עגבניות" → "2 קילו עגבניות", "חלב שתיים" → "חלב 2". */
function spokenToWritten(line: string): string {
  let s = line;
  // A fat percentage said out loud: "חלב שלוש אחוז" is "חלב 3%".
  s = s.replace(new RegExp(`(^|\\s)(${NUMBER_WORD})\\s+אחוז(?=\\s|$)`, 'g'), (_, sp: string, w: string) => `${sp}${NUMBER_WORDS[w]}%`);
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*אחוז(?=\s|$)/g, '$1%');
  for (let i = 0; i < 3 && SPOKEN_LEAD.test(s); i++) s = s.replace(SPOKEN_LEAD, '');
  // "ושני לחמים" in the middle of a dictated list.
  s = s.replace(new RegExp(`^ו(?=(?:${NUMBER_WORD})\\s)`), '');
  s = s.replace(new RegExp(`^(${NUMBER_WORD})\\s+`), (_, w: string) => `${NUMBER_WORDS[w]} `);
  s = s.replace(new RegExp(`\\s+(${NUMBER_WORD})$`), (_, w: string) => ` ${NUMBER_WORDS[w]}`);
  // "קילו וחצי עגבניות", "2 קילו וחצי".
  s = s.replace(/^(\d+\s*)?(קילו|ק"ג)\s+וחצי\s+/, (_, n: string | undefined) => `${(n ? Number(n) : 1) + 0.5} קילו `);
  // After a number: "2 חבילות קוטג'" → "2 קוטג'".
  return s.replace(new RegExp(`^(\\d+)\\s+${PACK_WORD.source.slice(1)}`), '$1 ');
}

/**
 * Tidy text read from a photo of a list. Character recognition leaves stray marks (ruled lines
 * read as "|", specks read as single letters) and screenshots bring in times and headings.
 * Keeps only lines that look like words.
 */
export function cleanRecognizedText(text: string): string {
  const keep: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
      .replace(/[|\\[\]{}<>_~=—“”„©®°§¶]+/g, ' ')
      // Words the reader glued together: a final letter (ם ן ך ף ץ) only ends a word, and a
      // number next to a word is its own token ("שמןזית" → "שמן זית", "2קוטג'" → "2 קוטג'").
      .replace(/([ךםןףץ])(?=[א-ת])/g, '$1 ')
      .replace(/(\d)(?=[א-ת])/g, '$1 ')
      .replace(/([א-ת])(?=\d)/g, '$1 ')
      .split(/\s+/)
      // ".1" next to an item is usually a misread mark; keep the number.
      .map((t) => t.replace(/^[.,'"]+(?=\d)/, ''))
      // A lone letter or a run of zeros is almost always a speck, not part of an item.
      .filter((t) => t && !/^[א-ת]$/.test(t) && !/^0+$/.test(t) && !/^[^\p{L}\p{N}%]+$/u.test(t))
      .join(' ')
      .replace(/^[.,'"\-–:;]+|[.,\-–:;]+$/g, '')
      .trim();
    const hebrew = (line.match(/[א-ת]/g) ?? []).length;
    const visible = line.replace(/\s/g, '').length;
    if (hebrew < 2 || hebrew / visible < 0.5 || HEADING.test(line)) continue;
    keep.push(line);
  }
  return keep.join('\n');
}
