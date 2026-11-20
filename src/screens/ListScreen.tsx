import { ChevronLeft, ClipboardList, ScanBarcode, Search, Share2, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { InstallHint } from '../components/InstallHint';
import { Button, DealChip, LabeledIconButton, Price, PriceTag, QtyBadge, ScreenHeader, Stepper } from '../components/ui';
import { searchProducts } from '../data/catalog';
import { changeQty, clearListWithUndo, shareList } from '../lib/actions';
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
  const open = useNav((s) => s.open);
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

  return (
    <div className="pb-4">
      <ScreenHeader title="הרשימה שלי">
        {items.length ? 'מה שצריך לקנות. ליד כל מוצר: כמה הוא עולה בסניפים שלך.' : null}
      </ScreenHeader>

      <div className="sticky top-0 z-20 bg-paper px-4 pt-1 pb-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => open({ kind: 'search', mode: { kind: 'add' } })}
            className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl border-[1.5px] border-ink bg-surface px-4 text-start"
          >
            <Search className="size-5 shrink-0" strokeWidth={2.25} />
            <span className="truncate text-muted">הוסף מוצר</span>
          </button>
          <LabeledIconButton label="ברקוד" onClick={() => open({ kind: 'scan' })}>
            <ScanBarcode className="size-6" />
          </LabeledIconButton>
          <LabeledIconButton label="הדבקה" onClick={() => open({ kind: 'paste' })}>
            <ClipboardList className="size-6" />
          </LabeledIconButton>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyList />
      ) : (
        <>
          <BestStoreBanner />
          <ul className="perforated mx-4 mt-3 rounded-2xl bg-surface">
            {items.map((item) =>
              item.pids.length === 0 ? (
                <UnmatchedRow key={item.id} item={item} />
              ) : (
                <ListRow key={item.id} item={item} prices={prices.get(item.id)} />
              ),
            )}
          </ul>

          {comparison.pricedCount > 0 ? (
            <Button className="mx-4 mt-3 w-[calc(100%-2rem)]" onClick={() => go('compare')}>
              הבא: איפה הכי זול?
              <ChevronLeft className="size-5" />
            </Button>
          ) : null}

          <div className="mx-4 mt-2 flex flex-wrap">
            <Button variant="quiet" className="flex-1 text-[0.95rem] whitespace-nowrap" onClick={() => void shareList()}>
              <Share2 className="size-[1.1rem]" />
              שתף רשימה
            </Button>
            <Button variant="quiet" className="flex-1 text-[0.95rem] whitespace-nowrap" onClick={clearListWithUndo}>
              <Trash2 className="size-[1.1rem]" />
              נקה הכול
            </Button>
          </div>

          <p className="mt-1 px-6 text-sm text-muted">
            ליד כל מוצר: המחיר בסניף הזול ובסניף היקר מבין אלה שבחרת. המחירים לפי מה שהרשתות פרסמו; בקופה קובע
            המחיר שם.
          </p>
        </>
      )}

      <InstallHint />
    </div>
  );
}

function EmptyList() {
  const open = useNav((s) => s.open);
  return (
    <div className="px-5 pt-6">
      <h2 className="font-display text-4xl leading-none font-bold">מתחילים מרשימה</h2>
      <p className="mt-2 text-muted">
        הוסף מה שצריך לקנות, ומיד תראה כמה כל מוצר עולה בכל אחד מהסניפים שבחרת.
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

      <div className="mt-7 space-y-2">
        <Button className="w-full" onClick={() => open({ kind: 'search', mode: { kind: 'add' } })}>
          <Search className="size-5" />
          חפש מוצר
        </Button>
        {/* Wraps to one button per line when the text is large. */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-w-[45%] flex-1 whitespace-nowrap" onClick={() => open({ kind: 'paste' })}>
            <ClipboardList className="size-5" />
            הדבק רשימה
          </Button>
          <Button variant="outline" className="min-w-[45%] flex-1 whitespace-nowrap" onClick={() => open({ kind: 'scan' })}>
            <ScanBarcode className="size-5" />
            סרוק ברקוד
          </Button>
        </div>
      </div>
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
