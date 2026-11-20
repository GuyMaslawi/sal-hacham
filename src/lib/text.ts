// Hebrew-aware text helpers for search and for parsing pasted shopping lists.

/** Lowercase, drop niqqud and quote marks, fold final letters, keep letters/digits/%. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'׳״`´]/g, '')
    .replace(/[^0-9a-zא-ת%.]+/g, ' ')
    .replace(/ך/g, 'כ')
    .replace(/ם/g, 'מ')
    .replace(/ן/g, 'נ')
    .replace(/ף/g, 'פ')
    .replace(/ץ/g, 'צ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const tokens = (s: string) => normalize(s).split(' ').filter(Boolean);

/** Digits only, no leading zeros: the form barcodes are stored in. */
export const normalizeCode = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '');

export interface ParsedLine {
  label: string;
  qty: number;
}

/**
 * Parse a free-text shopping list, one item per line (or comma separated).
 * Understands "2 חלב", "חלב x2", "חלב 2", "חלב - 2 יח'", bullets and checkbox marks.
 */
export function parseShoppingList(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const rawLine of text.split(/[\n,;]+/)) {
    let line = rawLine
      .replace(/^[\s\-–•*·▪◦☐☑✓✔✅⬜🔲]+/u, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();
    if (!line) continue;
    let qty = 1;

    const multiplier =
      /\s*[x×*]\s*(\d{1,2})$/i.exec(line) ?? /^(\d{1,2})\s*[x×*]\s*/i.exec(line) ?? /^[x×*]\s*(\d{1,2})\s+/i.exec(line);
    const unitsSuffix = /\s*[-–:]?\s*(\d{1,2})\s*(?:יח'?|יחידות|חבילות|אריזות|בקבוקים|קרטונים)$/.exec(line);
    const leading = /^(\d{1,2})\s+(?=\D)/.exec(line);
    const trailing = /\s+(\d{1,2})$/.exec(line);

    if (multiplier) {
      qty = Number(multiplier[1]);
      line = line.replace(multiplier[0], ' ');
    } else if (unitsSuffix) {
      qty = Number(unitsSuffix[1]);
      line = line.slice(0, unitsSuffix.index);
    } else if (leading && !/^\d+\s*(%|גרם|ג'|מ"ל|מל|ליטר|ק"ג|קג|קילו)/.test(line)) {
      qty = Number(leading[1]);
      line = line.slice(leading[0].length);
    } else if (trailing && !/%\s*$/.test(line)) {
      qty = Number(trailing[1]);
      line = line.slice(0, trailing.index);
    }

    const label = line.replace(/\s+/g, ' ').replace(/[\s\-–:]+$/, '').trim();
    if (label) out.push({ label, qty: Math.min(Math.max(qty, 1), 99) });
  }
  return out;
}
