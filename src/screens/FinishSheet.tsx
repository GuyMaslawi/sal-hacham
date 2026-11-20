import { Button, Sheet } from '../components/ui';
import { finishShopping } from '../lib/actions';
import { useApp } from '../state/app';
import { useNav } from '../state/nav';

/** "Done shopping?" Says exactly what will happen to the list before it happens. */
export function FinishSheet() {
  const close = useNav((s) => s.close);
  const items = useApp((s) => s.items);
  const bought = items.filter((i) => i.checked).length;
  const left = items.length - bought;

  return (
    <Sheet
      title="לסיים את הקנייה?"
      onClose={close}
      footer={
        <div className="space-y-2">
          <Button variant="tag" className="w-full" onClick={finishShopping}>
            כן, סיימתי לקנות
          </Button>
          <Button variant="outline" className="w-full" onClick={close}>
            עוד לא, להמשיך לקנות
          </Button>
        </div>
      }
    >
      <ul className="space-y-2 text-[1.05rem]">
        <li>
          {bought === 0
            ? 'עוד לא סימנת אף מוצר כנקנה.'
            : bought === 1
              ? 'מוצר אחד שסימנת כנקנה יימחק מהרשימה.'
              : `${bought} מוצרים שסימנת כנקנו יימחקו מהרשימה.`}
        </li>
        {left > 0 ? (
          <li>
            {left === 1 ? 'מוצר אחד שלא סימנת יישאר' : `${left} מוצרים שלא סימנת יישארו`} ברשימה לפעם הבאה.
          </li>
        ) : null}
      </ul>
    </Sheet>
  );
}
