import { describe, expect, it } from 'vitest';
import { cleanRecognizedText, parseShoppingList } from './text';

const parse = (s: string) => parseShoppingList(s).map((l) => `${l.qty} ${l.label}`);

describe('parseShoppingList', () => {
  it('reads written quantities', () => {
    expect(parse("חלב 3%\n2 קוטג'\nלחם x3\nעגבניות 2 קג\n12 ביצים")).toEqual([
      '1 חלב 3%',
      "2 קוטג'",
      '3 לחם',
      '2 עגבניות',
      '1 12 ביצים',
    ]);
  });

  it('reads quantities said out loud', () => {
    expect(
      parse(
        "שני חלב\nלחם שתיים\nשלוש עגבניות\nקילו מלפפונים\nחצי קילו גבינה\nקילו וחצי תפוחים\nשתי חבילות קוטג'\nוגם נייר טואלט\nתוסיף ושני לחמים",
      ),
    ).toEqual([
      '2 חלב',
      '2 לחם',
      '3 עגבניות',
      '1 מלפפונים',
      '0.5 גבינה',
      '1.5 תפוחים',
      "2 קוטג'",
      '1 נייר טואלט',
      '2 לחמים',
    ]);
  });

  it('ignores invisible direction marks from WhatsApp and speech', () => {
    expect(parse('\u200fשתי עגבניות\n\u200f\u200e2 חלב\u200f')).toEqual(['2 עגבניות', '2 חלב']);
  });

  it('skips headings', () => {
    expect(parse('רשימה לסופר:\n- חלב x2\nירקות:\nעגבניות\nרשימת קניות')).toEqual(['2 חלב', '1 עגבניות']);
  });

  it('leaves words that only start like a number alone', () => {
    expect(parse('שניצל\nשמן זית\nשקיות זבל\nבקבוק יין')).toEqual(['1 שניצל', '1 שמן זית', '1 שקיות זבל', '1 בקבוק יין']);
  });
});

describe('cleanRecognizedText', () => {
  it('keeps the items and drops specks, times and headings', () => {
    const read = "רשימת קניות\n10:42\nחלב 3%\n\n| 2 קוטג' |\nביצים .1\n|| 0 ה 00\n—\nנייר טואלט";
    expect(cleanRecognizedText(read)).toBe("חלב 3%\n2 קוטג'\nביצים 1\nנייר טואלט");
  });

  it('separates words the reader glued together', () => {
    expect(cleanRecognizedText("שמןזית\n2קוטג'\nחלב3%\nלחם אחיד")).toBe("שמן זית\n2 קוטג'\nחלב 3%\nלחם אחיד");
  });

  it('drops lines that are mostly noise', () => {
    expect(cleanRecognizedText('ה ה ש 0 |\n%%% 12 ab\nעגבניות')).toBe('עגבניות');
  });
});
