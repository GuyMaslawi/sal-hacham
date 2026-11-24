import { describe, expect, it } from 'vitest';
import { nameStats, splitSpokenLine } from './splitSpoken';
import { normalize } from './text';

// A small catalog in the style of the chains' price files.
const NAMES = [
  'לחם אחיד פרוס 750 גרם', 'לחם מלא פרוס', 'לחם כוסמין פרוס', 'לחם אחיד', 'לחם שיפון', 'לחם מחמצת',
  "קוטג' 5% תנובה", "קוטג' 9% טרה", "קוטג' 3% שטראוס",
  'עגבניות שרי', 'עגבניות תמר', 'רוטב עגבניות לפסטה', 'רוטב עגבניות ביתי', 'רסק עגבניות', 'מחית עגבניות',
  'פסטה פנה', 'פסטה ספגטי', 'פסטה פוזילי',
  'חלב 3% תנובה', 'חלב 1% טרה', 'חלב עמיד 3%', 'חלב סויה אלפרו', 'חלב סויה ללא סוכר', 'משקה סויה',
  'שמן זית כתית מעולה', 'שמן זית 750 מל', 'שמן קנולה', 'זיתים ירוקים', 'זיתים שחורים',
  'נייר טואלט לילי', 'נייר טואלט 32 גלילים', 'נייר אפייה', 'אורז פרסי', 'אורז בסמטי',
  'ביצים L 12', 'ביצים M 12', 'במבה 80 גרם', 'במבה נוגט', 'ביסלי גריל', 'ביסלי בצל', 'מארז במבה ביסלי',
].map(normalize);

const split = (said: string) => splitSpokenLine(said, nameStats(NAMES));

describe('splitSpokenLine', () => {
  it('splits a list said in one breath', () => {
    expect(split("קוטג' לחם עגבניות ולחם פרוס")).toEqual(["קוטג'", 'לחם', 'עגבניות', 'לחם פרוס']);
  });

  it('keeps product names together', () => {
    expect(split('שמן זית נייר טואלט אורז')).toEqual(['שמן זית', 'נייר טואלט', 'אורז']);
    expect(split('פסטה רוטב עגבניות')).toEqual(['פסטה', 'רוטב עגבניות']);
    expect(split('חלב סויה')).toEqual(['חלב סויה']);
  });

  it('starts a new item at a quantity, and keeps sizes with their product', () => {
    expect(split('שני חלב שלוש עגבניות קילו לחם')).toEqual(['שני חלב', 'שלוש עגבניות', 'קילו לחם']);
    expect(split("חלב 3% קוטג' 5%")).toEqual(['חלב 3%', "קוטג' 5%"]);
  });

  it('drops the joining words between items', () => {
    expect(split('חלב וגם לחם ושתי עגבניות')).toEqual(['חלב', 'לחם', 'שתי עגבניות']);
  });

  it('keeps two snacks apart even when a multi-pack names both', () => {
    expect(split('במבה ביסלי')).toEqual(['במבה', 'ביסלי']);
  });

  it('leaves a single item alone', () => {
    expect(split('לחם אחיד')).toEqual(['לחם אחיד']);
    expect(split('ביצים')).toEqual(['ביצים']);
  });
});
