import { Camera, ClipboardList, Mic } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Sheet, cx, toast } from '../components/ui';
import { pickPhoto, readClipboard } from '../lib/listInput';
import { readListFromImage, type ReadProgress } from '../lib/ocr';
import { canDictate, dictationProblem, startDictation, type Dictation } from '../lib/speech';
import { nameStats, splitSpokenLine } from '../lib/splitSpoken';
import { normalize, parseShoppingList } from '../lib/text';
import { useApp } from '../state/app';
import { useData } from '../state/data';
import { useNav, type ListStart } from '../state/nav';

type Activity = { kind: 'idle' } | { kind: 'listening'; current: string } | ({ kind: 'reading' } & ReadProgress);

interface Note {
  text: string;
  alert?: boolean;
}

/** `base` followed by `lines`, one per line. */
const appendLines = (base: string, lines: string[]) => {
  const head = base.replace(/\s+$/, '');
  const tail = lines.map((l) => l.trim()).filter(Boolean).join('\n');
  return !tail ? head : head ? `${head}\n${tail}` : tail;
};

/**
 * Several products at once: said out loud, read from a photo or a screenshot, pasted from
 * WhatsApp or typed. Whatever way they arrive, they land in one box as one line per product, so
 * the shopper can check and fix them before they join the list.
 */
export function AddListSheet({ start, photo, clipboard }: { start: ListStart; photo?: Blob; clipboard?: Promise<string> }) {
  const close = useNav((s) => s.close);
  const [text, setText] = useState('');
  const [activity, setActivity] = useState<Activity>({ kind: 'idle' });
  const [note, setNote] = useState<Note | null>(null);
  const [picture, setPicture] = useState<string | null>(null);
  const dictation = useRef<Dictation | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const lines = useMemo(() => parseShoppingList(text), [text]);
  const voice = canDictate();
  // The product names of the chosen stores, to tell where one spoken item ends and the next
  // begins ("קוטג' לחם עגבניות ולחם פרוס" said in one breath is four items).
  const catalog = useData((s) => s.catalog);
  const splitter = useMemo(() => {
    let stats: ReturnType<typeof nameStats> | null = null;
    const done = new Map<string, string[]>();
    return (line: string) => {
      let parts = done.get(line);
      if (!parts) {
        stats ??= nameStats(catalog.list.map((p) => normalize(p.name)));
        parts = splitSpokenLine(line, stats);
        done.set(line, parts);
      }
      return parts;
    };
  }, [catalog]);
  const splitRef = useRef(splitter);
  splitRef.current = splitter;
  const listening = activity.kind === 'listening';
  const reading = activity.kind === 'reading';

  const stopVoice = () => dictation.current?.stop();

  const startVoice = () => {
    if (dictation.current) return;
    // Dictation reports everything heard so far each time. It owns the box only while nobody else
    // touched it: once the shopper types or pastes, their text stays and only lines heard after
    // that are added.
    let base = textRef.current;
    let used = 0;
    let wrote = base;
    let written = 0;
    setNote(null);
    setActivity({ kind: 'listening', current: '' });
    dictation.current = startDictation({
      onText: (heard, current) => {
        const parts = heard.flatMap((line) => splitRef.current(line));
        if (textRef.current !== wrote) {
          base = textRef.current;
          used = written;
        }
        const next = appendLines(base, parts.slice(used));
        wrote = next;
        written = parts.length;
        textRef.current = next;
        setText(next);
        setActivity((a) => (a.kind === 'listening' ? { kind: 'listening', current } : a));
      },
      onEnd: (error) => {
        dictation.current = null;
        setActivity((a) => (a.kind === 'listening' ? { kind: 'idle' } : a));
        if (error) setNote({ text: dictationProblem(error), alert: true });
      },
    });
  };

  const readPhoto = async (image: Blob) => {
    stopVoice();
    setNote(null);
    setPicture((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(image);
    });
    setActivity({ kind: 'reading', share: 0, stage: 'loading' });
    try {
      const found = await readListFromImage(image, (p) => setActivity((a) => (a.kind === 'reading' ? { kind: 'reading', ...p } : a)));
      const count = parseShoppingList(found).length;
      if (count > 0) {
        setText((t) => appendLines(t, [found]));
        setNote({
          text: `${count === 1 ? 'נמצא מוצר אחד' : `נמצאו ${count} מוצרים`} בתמונה. כדאי לעבור על הרשימה ולתקן מה שלא נקרא נכון.`,
        });
      } else {
        setNote({
          text: 'לא הצלחתי לקרוא רשימה בתמונה. הכי טוב עובד צילום מסך או רשימה מודפסת, מקרוב ובאור טוב. כתב יד עדיין קשה לקריאה.',
          alert: true,
        });
      }
    } catch {
      setNote({ text: 'קריאת התמונה לא הצליחה. נסה שוב, או הקלד את הרשימה.', alert: true });
    } finally {
      setActivity((a) => (a.kind === 'reading' ? { kind: 'idle' } : a));
    }
  };

  const paste = async (pending?: Promise<string>) => {
    stopVoice();
    const copied = (await (pending ?? readClipboard())).trim();
    if (copied) {
      setText((t) => appendLines(t, [copied]));
      setNote(null);
    } else {
      setNote({ text: 'לא קיבלתי טקסט מההעתקה. לחץ לחיצה ארוכה בתיבה ובחר "הדבק".' });
      box.current?.focus();
    }
  };

  // Begin the way the shopper chose on the list screen, once (React may run effects twice while
  // developing, and a photo must not be read into the box twice).
  const begun = useRef(false);
  useEffect(() => {
    if (begun.current) return;
    begun.current = true;
    if (start === 'voice') startVoice();
    else if (start === 'photo' && photo) void readPhoto(photo);
    else if (start === 'paste') void paste(clipboard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closing the sheet turns the microphone off. The check waits a moment because React's
  // development mode unmounts and remounts once, which must not stop the listening.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.setTimeout(() => {
        if (!mounted.current) dictation.current?.stop();
      });
    };
  }, []);

  useEffect(() => () => void (picture && URL.revokeObjectURL(picture)), [picture]);

  // The sheet stays on screen until the browser confirms the step back; a second tap meanwhile
  // must not add the whole list again.
  const added = useRef(false);
  const add = () => {
    if (added.current) return;
    added.current = true;
    stopVoice();
    useApp.getState().addFreeText(lines);
    toast(lines.length === 1 ? 'מוצר אחד נוסף לרשימה' : `${lines.length} מוצרים נוספו לרשימה`);
    close();
  };

  return (
    <Sheet
      title="הוספת רשימה"
      subtitle="אפשר לומר, לצלם, להדביק או לכתוב. כל שורה היא מוצר."
      onClose={close}
      footer={
        <Button variant="tag" className="w-full" disabled={lines.length === 0 || reading} onClick={add}>
          {lines.length === 0 ? 'הוסף לרשימה' : lines.length === 1 ? 'הוסף מוצר אחד לרשימה' : `הוסף ${lines.length} מוצרים לרשימה`}
        </Button>
      }
    >
      <div className={cx('grid gap-2', voice ? 'grid-cols-3' : 'grid-cols-2')}>
        {voice ? (
          <Way label={listening ? 'מקשיב…' : 'דיבור'} active={listening} onClick={listening ? stopVoice : startVoice}>
            <Mic className="size-6" />
          </Way>
        ) : null}
        <Way label="צילום" active={reading} disabled={reading} onClick={() => pickPhoto((image) => void readPhoto(image))}>
          <Camera className="size-6" />
        </Way>
        <Way label="הדבקה" onClick={() => void paste()}>
          <ClipboardList className="size-6" />
        </Way>
      </div>

      {activity.kind === 'listening' ? (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-ink p-3 ps-4 text-surface" role="status">
          <span className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-tag text-tag-ink">
            <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-tag opacity-60" />
            <Mic className="relative size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">מקשיב…</p>
            <p className="text-sm opacity-80">
              {activity.current ? `${activity.current}…` : 'אמור את המוצרים אחד אחרי השני, למשל: חלב, לחם פרוס, שתי עגבניות.'}
            </p>
          </div>
          <Button variant="tag" className="min-h-11 shrink-0 px-4" onClick={stopVoice}>
            סיימתי
          </Button>
        </div>
      ) : null}

      {activity.kind === 'reading' ? (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-sunken p-3" role="status">
          {picture ? <img src={picture} alt="" className="size-14 shrink-0 rounded-lg object-cover" /> : null}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {activity.stage === 'loading' ? 'מכין את קורא התמונות…' : 'קורא את הרשימה מהתמונה…'}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-ink transition-[width] duration-300"
                style={{ width: `${Math.round((activity.stage === 'loading' ? activity.share * 0.3 : 0.3 + activity.share * 0.7) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {note && activity.kind === 'idle' ? (
        <div className={cx('mt-3 flex items-center gap-3 rounded-2xl p-3 text-sm', note.alert ? 'bg-alert/10 text-alert' : 'bg-sunken')}>
          {picture ? <img src={picture} alt="התמונה שצילמת" className="size-12 shrink-0 rounded-lg object-cover" /> : null}
          <p className="min-w-0 flex-1 leading-snug font-medium">{note.text}</p>
        </div>
      ) : null}

      <textarea
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        // Typing while listening would fight with the words still arriving.
        onFocus={stopVoice}
        rows={7}
        placeholder={'חלב 3%\n2 קוטג\'\nלחם אחיד\nעגבניות'}
        aria-label="הרשימה, מוצר בכל שורה"
        className="mt-3 w-full resize-none rounded-xl bg-sunken p-4 text-[1.05rem] leading-relaxed outline-none focus:ring-2 focus:ring-ink"
      />
      <p className="mt-1 text-sm text-muted">
        כמות כותבים או אומרים לפני המוצר, למשל "2 חלב" או "שתי עגבניות". אחרי ההוספה תאשר לכל שורה את המוצר המדויק.
      </p>
    </Sheet>
  );
}

function Way({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cx(
        'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] px-2 font-semibold transition-colors disabled:opacity-60',
        active ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink active:bg-sunken',
      )}
    >
      {children}
      <span className="text-sm leading-tight">{label}</span>
    </button>
  );
}
