import { useMemo, useState } from 'react';
import { Button, Sheet, toast } from '../components/ui';
import { parseShoppingList } from '../lib/text';
import { useApp } from '../state/app';
import { useNav } from '../state/nav';

/** Turn a list written elsewhere (WhatsApp, Notes) into list lines. */
export function PasteSheet() {
  const close = useNav((s) => s.close);
  const [text, setText] = useState('');
  const lines = useMemo(() => parseShoppingList(text), [text]);

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) setText(clip);
      else toast('הלוח ריק');
    } catch {
      toast('לא ניתן לקרוא מהלוח. הדבק ידנית בתיבה');
    }
  };

  return (
    <Sheet
      title="הדבקת רשימה"
      subtitle={'כל שורה היא מוצר. אפשר לכתוב כמות, למשל "2 חלב" או "לחם x3". אחר כך תבחר לכל שורה את המוצר המדויק.'}
      onClose={close}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        autoFocus
        placeholder={'חלב 3%\n2 קוטג\nלחם אחיד\nעגבניות'}
        aria-label="רשימת קניות"
        className="mt-1 w-full resize-none rounded-xl bg-sunken p-4 text-[1.05rem] leading-relaxed outline-none focus:ring-2 focus:ring-ink"
      />
      <div className="mt-3 flex gap-2">
        <Button
          variant="tag"
          className="flex-1"
          disabled={lines.length === 0}
          onClick={() => {
            useApp.getState().addFreeText(lines);
            toast(lines.length === 1 ? 'שורה אחת נוספה לרשימה' : `${lines.length} שורות נוספו לרשימה`);
            close();
          }}
        >
          {lines.length === 0 ? 'הוסף לרשימה' : lines.length === 1 ? 'הוסף שורה אחת' : `הוסף ${lines.length} שורות`}
        </Button>
        {typeof navigator.clipboard?.readText === 'function' ? (
          <Button variant="outline" onClick={paste}>
            הדבק מהלוח
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
