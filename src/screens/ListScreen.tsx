import { Camera, ChevronDown, ChevronLeft, ClipboardList, Mic, ScanBarcode, Search, Share2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { InstallHint } from '../components/InstallHint';
import { Button, DealChip, Price, PriceTag, QtyBadge, ScreenHeader, Stepper, cx, toast } from '../components/ui';
import { searchProducts } from '../data/catalog';
import { changeQty, clearListWithUndo, shareList } from '../lib/actions';
import { startList } from '../lib/listInput';
import { canDictate } from '../lib/speech';
import { costFor, promoLabel } from '../lib/pricing';
import { qtyUnit, storeTitle, useComparison, usePricingOptions, useStoreLookup } from '../lib/view';
import { stepFor, useApp } from '../state/app';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import type { ListItem, Promo } from '../types';

interface RowPrices {
  min: number;
  max: number;
  /** Chosen stores that sell none of the line's products. */
  missingIn: number;
  promo: Promo | null;
}

// Things nearly every household buys: one tap opens the search already filled in.
const STAPLES = ['חלב', 'לחם', 'ביצים', "קוטג'", 'עגבניות', 'מלפפונים', 'אורז', 'פסטה', 'שמן', 'קפה', 'נייר טואלט', 'חיתולים'];

export function ListScreen() {
  const items = useApp((s) => s.items);
  const textSize = useApp((s) => s.settings.textSize);
  const go = useNav((s) => s.go);
  const comparison = useComparison();

  // Per line: the cheapest and dearest store, and whether a deal is in play.
  const prices = useMemo(() => {
    const map = new Map<string, RowPrices>();
    for (const q of comparison.quotes) {
      for (const line of q.lines) {
        const row = map.get(line.itemId);
        if (!row) map.set(line.itemId, { min: line.total, max: line.total, missingIn: 0, promo: line.promo });
        else {
          if (line.total < row.min) {
            row.min = line.total;
            row.promo = line.promo;
          }
          if (line.total > row.max) row.max = line.total;
        }
      }
      for (const id of q.missing) {
        const row = map.get(id);
        if (row) row.missingIn++;
        else map.set(id, { min: Infinity, max: -Infinity, missingIn: 1, promo: null });
      }
    }
    return map;
  }, [comparison]);

  const searchBar = <AddBar />;

  if (items.length === 0) {
    return (
      <div className="pb-4">
        <ScreenHeader title="הרשימה שלי" />
        {searchBar}
        <EmptyList />
        <InstallHint />
      </div>
    );
  }

  // The page itself stays put: the products scroll inside their own box, so the search bar,
  // the cheapest store and the way to the next step are always on screen.
  return (
    <div className="flex h-[calc(100dvh-4.75rem-env(safe-area-inset-bottom))] flex-col">
      <div className="shrink-0">
        {/* With large text the explanation would leave little room for the products themselves. */}
        <ScreenHeader title="הרשימה שלי">
          {textSize === 'normal' ? 'מה שצריך לקנות. ליד כל מוצר: כמה הוא עולה בסניפים שלך.' : null}
        </ScreenHeader>
      </div>
      {searchBar}
      <div className="shrink-0">
        <BestStoreBanner />
        <ConfirmAllBanner />
      </div>

      <ScrollBox
        count={items.length}
        actions={
          // At the top of the box, so they never need a scroll to the end of a long list.
          <>
            <button
              type="button"
              onClick={() => void shareList()}
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-2.5 text-sm font-semibold whitespace-nowrap text-ink active:bg-sunken"
            >
              <Share2 className="size-4" />
              שתף
            </button>
            <button
              type="button"
              onClick={clearListWithUndo}
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-2.5 text-sm font-semibold whitespace-nowrap text-alert active:bg-sunken"
            >
              <Trash2 className="size-4" />
              נקה הכול
            </button>
          </>
        }
      >
        <ul className="perforated">
          {items.map((item) =>
            item.pids.length === 0 ? (
              <UnmatchedRow key={item.id} item={item} />
            ) : (
              <ListRow key={item.id} item={item} prices={prices.get(item.id)} />
            ),
          )}
        </ul>

        <div className="border-t-[1.5px] border-dashed border-line px-2 pt-2 pb-3">
          <p className="mt-1 px-2 text-sm text-muted">
            ליד כל מוצר: המחיר בסניף הזול ובסניף היקר מבין אלה שבחרת. המחירים לפי מה שהרשתות פרסמו; בקופה קובע
            המחיר שם.
          </p>
          <InstallHint />
        </div>
      </ScrollBox>

      {comparison.pricedCount > 0 ? (
        <div className="shrink-0 px-4 pt-3 pb-3">
          <Button className="w-full" onClick={() => go('compare')}>
            הבא: איפה הכי זול?
            <ChevronLeft className="size-5" />
          </Button>
        </div>
      ) : (
        <div className="h-3 shrink-0" />
      )}
    </div>
  );
}

/**
 * The list's own scrolling area. It says how many products there are, shows when more are
 * hidden below (with a button that scrolls, for anyone who does not think to swipe), and moves
 * to a newly added product so it is seen.
 */
function ScrollBox({ count, actions, children }: { count: number; actions: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const [moreAbove, setMoreAbove] = useState(false);
  const previousCount = useRef(count);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 8);
    setMoreAbove(el.scrollTop > 8);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A product was added (usually from the search screen): bring the end of the list into view.
    if (count > previousCount.current) {
      const list = el.querySelector('ul');
      const last = list?.lastElementChild as HTMLElement | null;
      if (last) el.scrollTo({ top: last.offsetTop + last.offsetHeight - el.clientHeight + 16, behavior: 'smooth' });
    }
    previousCount.current = count;
    measure();
  }, [count, measure]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <section
      aria-label="המוצרים ברשימה"
      className="relative mx-4 mt-3 flex min-h-[13rem] flex-1 flex-col overflow-hidden rounded-2xl bg-surface"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-1 border-b-[1.5px] border-line ps-4 pe-1">
        <p className="me-auto py-2 text-sm font-semibold text-muted">
          {count === 1 ? 'מוצר אחד' : `${count} מוצרים`}
        </p>
        {actions}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={ref} onScroll={measure} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div>{children}</div>
        </div>
        {moreAbove ? (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-surface to-transparent" />
        ) : null}
        {moreBelow ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-t from-surface via-surface/80 to-transparent pb-2">
            <button
              type="button"
              onClick={() => ref.current?.scrollBy({ top: ref.current.clientHeight * 0.8, behavior: 'smooth' })}
              className="pointer-events-auto inline-flex min-h-10 items-center gap-1 rounded-full bg-ink px-4 text-sm font-semibold text-surface shadow"
            >
              <ChevronDown className="size-4" />
              עוד מוצרים למטה
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function EmptyList() {
  const open = useNav((s) => s.open);
  return (
    <div className="px-5 pt-6">
      <h2 className="font-display text-4xl leading-none font-bold">מתחילים מרשימה</h2>
      <p className="mt-2 text-muted">
        הקלד מוצר, אמור את הרשימה בקול, צלם אותה או הדבק אותה מוואטסאפ, בכפתורים שלמעלה. מיד תראה כמה כל מוצר
        עולה בכל אחד מהסניפים שבחרת.
      </p>

      <h3 className="mt-6 mb-2 text-sm font-semibold text-muted">התחלה מהירה</h3>
      <div className="flex flex-wrap gap-2">
        {STAPLES.map((word) => (
          <button
            key={word}
            type="button"
            onClick={() => open({ kind: 'search', mode: { kind: 'add', query: word } })}
            className="min-h-11 rounded-full border-[1.5px] border-line bg-surface px-4 font-medium active:bg-sunken"
          >
            {word}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Every way to add products, always in the same place: type a name, say the list, photograph
 * it, paste it, or scan a barcode. Each button names what it does, so nobody has to guess.
 */
function AddBar() {
  const open = useNav((s) => s.open);
  const textSize = useApp((s) => s.settings.textSize);
  const voice = canDictate();
  return (
    <div className="shrink-0 px-4 pt-1 pb-3">
      <button
        type="button"
        onClick={() => open({ kind: 'search', mode: { kind: 'add' } })}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border-[1.5px] border-ink bg-surface px-4 text-start"
      >
        <Search className="size-5 shrink-0" strokeWidth={2.25} />
        <span className="truncate text-muted">הקלד שם של מוצר</span>
      </button>
      {/* Larger text gets two buttons per row, so no label is cut. */}
      <div className={cx('mt-2 grid gap-2', textSize !== 'normal' ? 'grid-cols-2' : voice ? 'grid-cols-4' : 'grid-cols-3')}>
        {voice ? (
          <AddWay label="דיבור" onClick={() => startList('voice')}>
            <Mic className="size-5" />
          </AddWay>
        ) : null}
        <AddWay label="צילום" onClick={() => startList('photo')}>
          <Camera className="size-5" />
        </AddWay>
        <AddWay label="הדבקה" onClick={() => startList('paste')}>
          <ClipboardList className="size-5" />
        </AddWay>
        <AddWay label="ברקוד" onClick={() => open({ kind: 'scan' })}>
          <ScanBarcode className="size-5" />
        </AddWay>
      </div>
    </div>
  );
}

function AddWay({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-12 min-w-0 items-center justify-center gap-1 rounded-xl border-[1.5px] border-line bg-surface px-1 font-semibold whitespace-nowrap active:bg-sunken [&>svg]:shrink-0"
    >
      {children}
      <span className="text-[0.9rem]">{label}</span>
    </button>
  );
}

/**
 * After a list was said, photographed or pasted, each line waits for its product. When several
 * do, one tap takes the suggested product for all of them (and can be undone).
 */
function ConfirmAllBanner() {
  const items = useApp((s) => s.items);
  const catalog = useData((s) => s.catalog);
  const waiting = useMemo(
    () =>
      items
        .filter((i) => i.pids.length === 0)
        .map((item) => ({ item, guess: searchProducts(catalog, item.label, { limit: 1 })[0] }))
        .filter((w) => w.guess),
    [items, catalog],
  );
  if (waiting.length < 2) return null;

  const confirmAll = () => {
    const { attachProduct } = useApp.getState();
    const before = new Map(waiting.map((w) => [w.item.id, w.item]));
    for (const { item, guess } of waiting) attachProduct(item.id, guess, true);
    toast(`${waiting.length} מוצרים אושרו לפי ההצעות`, {
      label: 'בטל',
      run: () => useApp.setState((s) => ({ items: s.items.map((i) => before.get(i.id) ?? i) })),
    });
  };

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl bg-tag p-3 ps-4 text-tag-ink">
      <p className="min-w-0 flex-1 text-sm leading-snug font-semibold">
        {waiting.length} מוצרים מחכים לאישור. ההצעה שלנו מופיעה בכל שורה.
      </p>
      <Button className="min-h-11 shrink-0 px-4" onClick={confirmAll}>
        אשר הכול
      </Button>
    </div>
  );
}

function BestStoreBanner() {
  const comparison = useComparison();
  const index = useData((s) => s.index);
  const lookup = useStoreLookup();
  const go = useNav((s) => s.go);
  const best = comparison.quotes[0];
  const store = best && lookup(best.storeId);
  if (!best || !store || comparison.pricedCount === 0) return null;

  const dearest = comparison.quotes[comparison.quotes.length - 1];
  const gap = dearest.estimate - best.estimate;
  return (
    <button
      type="button"
      onClick={() => go('compare')}
      className="mx-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl bg-ink p-3 ps-4 text-start text-surface"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm opacity-75">הסל הכי זול ב</span>
        <span className="block text-lg leading-tight font-bold">{storeTitle(store, index)}</span>
        <span className="mt-0.5 block text-sm opacity-75">
          {best.missing.length > 0 ? (
            <>כולל הערכה {best.missing.length === 1 ? 'למוצר אחד שחסר' : `ל-${best.missing.length} מוצרים שחסרים`} שם</>
          ) : comparison.quotes.length > 1 && gap >= 0.5 ? (
            <>
              <Price value={gap} /> פחות מהיקר ביותר
            </>
          ) : comparison.quotes.length > 1 ? (
            <>כמעט אותו מחיר בכל הסניפים</>
          ) : (
            <>הוסף עוד סניף כדי להשוות</>
          )}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-center gap-1">
        <PriceTag value={best.estimate} />
        <span className="inline-flex items-center text-sm font-semibold">
          להשוואה
          <ChevronLeft className="size-4" />
        </span>
      </span>
    </button>
  );
}

/**
 * A line typed or pasted as free text. It cannot be priced until it points at a product, so the
 * row offers the likeliest one: a single tap confirms it.
 */
function UnmatchedRow({ item }: { item: ListItem }) {
  const open = useNav((s) => s.open);
  const catalog = useData((s) => s.catalog);
  const opts = usePricingOptions();
  const guess = useMemo(() => searchProducts(catalog, item.label, { limit: 1 })[0], [catalog, item.label]);
  const guessPrice = useMemo(
    () => (guess ? Math.min(...[...guess.offers.values()].map((o) => costFor(o, 1, guess.weighted, opts).total)) : 0),
    [guess, opts],
  );
  const choose = () => open({ kind: 'search', mode: { kind: 'match', itemId: item.id, query: item.label } });

  return (
    <li className="py-3 ps-4 pe-3">
      <button type="button" className="block w-full text-start" onClick={() => open({ kind: 'item', itemId: item.id })}>
        <span className="line-clamp-2 leading-snug font-medium">
          <QtyBadge qty={item.qty} />
          {item.label}
        </span>
        <span className="mt-0.5 block text-sm text-alert">
          {guess ? 'כדי לקבל מחיר, אשר לאיזה מוצר התכוונת' : 'כדי לקבל מחיר צריך לבחור מוצר מסוים'}
        </span>
      </button>
      {guess ? (
        <div className="mt-2 rounded-xl bg-sunken p-3">
          <p className="line-clamp-2 text-sm leading-snug">
            {guess.name} <Price value={guessPrice} className="text-ink" />
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="tag"
              className="min-h-10 flex-1 rounded-full px-3 text-sm"
              onClick={() => useApp.getState().attachProduct(item.id, guess, true)}
            >
              כן, זה המוצר
            </Button>
            <Button variant="outline" className="min-h-10 flex-1 rounded-full px-3 text-sm" onClick={choose}>
              מוצר אחר
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="tag" className="mt-2 min-h-10 rounded-full px-4 text-sm" onClick={choose}>
          בחר מוצר
        </Button>
      )}
    </li>
  );
}

function ListRow({ item, prices }: { item: ListItem; prices: RowPrices | undefined }) {
  const open = useNav((s) => s.open);
  const product = useData((s) => (item.pids[0] ? s.catalog.products.get(item.pids[0]) : undefined));
  const storeCount = useData((s) => s.catalog.storeIds.length);
  const weighted = product?.weighted ?? false;
  const priced = prices && Number.isFinite(prices.min);

  return (
    // With large text the quantity buttons move under the name instead of squeezing it.
    <li className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 py-3 ps-4 pe-3">
      <button
        type="button"
        className="min-w-[9.5rem] flex-1 text-start"
        onClick={() => open({ kind: 'item', itemId: item.id })}
      >
        <span className="line-clamp-3 leading-snug font-medium">{item.label}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {priced ? (
            <>
              <span className="text-muted">
                <Price value={prices.min} className="text-ink" />
                {prices.max - prices.min >= 0.05 ? (
                  <>
                    {' עד '}
                    <Price value={prices.max} className="font-normal" />
                  </>
                ) : null}
              </span>
              {prices.promo ? <DealChip club={prices.promo.club}>{promoLabel(prices.promo)}</DealChip> : null}
              {prices.missingIn > 0 ? (
                <span className="text-muted">
                  חסר ב-{prices.missingIn} מתוך {storeCount}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-alert">לא נמכר בסניפים שבחרת</span>
          )}
        </span>
      </button>
      <Stepper
        value={item.qty}
        step={stepFor(weighted)}
        unit={qtyUnit(weighted)}
        onChange={(q) => changeQty(item.id, q)}
      />
    </li>
  );
}
