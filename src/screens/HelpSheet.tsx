import type { ReactNode } from 'react';
import { Button, DealChip, PriceTag, Sheet } from '../components/ui';
import { useNav } from '../state/nav';

/** How the app works and how to read its prices, in the order a shopper meets them. */
export function HelpSheet() {
  const close = useNav((s) => s.close);
  return (
    <Sheet
      title="איך זה עובד"
      onClose={close}
      footer={
        <Button className="w-full" onClick={close}>
          הבנתי, חזרה
        </Button>
      }
    >
      <ol className="space-y-4">
        <Step n={1} title="בוחרים סניפים">
          אנחנו מציעים סניף אחד מכל רשת מובילה באזור שלך, ואפשר להחליף לסניפים שאתה באמת קונה בהם. רק המחירים
          שלהם יורדים לטלפון, ולכן הכול מהיר ועובד גם בלי קליטה.
        </Step>
        <Step n={2} title="בונים רשימה">
          מחפשים מוצר, סורקים ברקוד, או מדביקים רשימה שכתבת בוואטסאפ. כדי להשוות מחיר צריך לבחור מוצר מסוים (למשל
          "חלב 3% תנובה 1 ליטר"), כי "חלב" לבד עולה אחרת בכל אריזה.
        </Step>
        <Step n={3} title="רואים איפה הכי זול">
          בלשונית "השוואה" מופיע מחיר הסל כולו בכל סניף, מהזול ליקר, ומה חסר בכל אחד.
        </Step>
        <Step n={4} title="קונים עם הרשימה">
          בלשונית "בסופר" מסמנים כל מוצר שנכנס לעגלה ורואים כמה הצטבר, לפי המחירים של הסניף שבו אתה נמצא.
        </Step>
      </ol>

      <h3 className="mt-7 mb-2 font-bold">איך לקרוא את המחירים</h3>
      <dl className="perforated text-[0.95rem]">
        <Term
          term={
            <span className="inline-flex items-center gap-2">
              <PriceTag value={24.9} size="sm" /> מחיר הסל
            </span>
          }
        >
          מה שתשלם על כל הרשימה בסניף הזה, אחרי מבצעים.
        </Term>
        <Term term={<DealChip>2 ב-10 ₪</DealChip>}>
          מבצע שכבר נכלל במחיר, כי הכמות ברשימה מספיקה כדי לקבל אותו.
        </Term>
        <Term term={<DealChip club>מועדון: 2 ב-10 ₪</DealChip>}>
          מחיר לחברי מועדון או לבעלי כרטיס האשראי של הרשת. נספר רק אם הפעלת "לכלול מחירי מועדון" בלשונית
          "סניפים".
        </Term>
        <Term term="כולל הערכה">
          כשסניף לא מוכר חלק מהרשימה, אנחנו מוסיפים למחיר שלו את מה שהמוצרים החסרים עולים בממוצע בסניפים האחרים.
          כך סניף לא נראה זול רק כי חסרים בו דברים.
        </Term>
        <Term term="שווה לפצל">
          כשקנייה בשני סניפים חוסכת יותר מהסכום שקבעת, נראה לך מה לקנות בכל אחד.
        </Term>
      </dl>

      <p className="mt-5 text-sm leading-relaxed text-muted">
        המחירים והמבצעים נלקחים מהקבצים שהרשתות מחויבות לפרסם לפי חוק שקיפות המחירים, ומתעדכנים פעם ביום. ייתכנו
        הבדלים מהמחיר על המדף; המחיר בקופה הוא הקובע. קופונים ומבצעים שתלויים בסכום הקנייה לא נספרים.
      </p>
    </Sheet>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="num flex size-9 shrink-0 items-center justify-center rounded-full bg-tag text-lg leading-none font-bold text-tag-ink">
        {n}
      </span>
      <div>
        <p className="font-bold">{title}</p>
        <p className="text-[0.95rem] text-muted">{children}</p>
      </div>
    </li>
  );
}

function Term({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="py-3">
      <dt className="font-semibold">{term}</dt>
      <dd className="mt-1 text-muted">{children}</dd>
    </div>
  );
}
