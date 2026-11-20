import { ChevronLeft, ClipboardList, ScanBarcode, Search } from 'lucide-react';
import { useMemo } from 'react';
import { Button, DealChip, EmptyState, IconButton, Price, PriceTag, QtyBadge, Stepper } from '../components/ui';
import { promoLabel } from '../lib/pricing';
import { qtyUnit, storeTitle, useComparison, useStoreLookup } from '../lib/view';
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

export function ListScreen() {
  const items = useApp((s) => s.items);
  const open = useNav((s) => s.open);
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
      <header className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <h1 className="font-display text-[2.75rem] leading-none font-bold">הרשימה שלי</h1>
      </header>

      <div className="sticky top-0 z-20 bg-paper px-4 pt-3 pb-3">
        <div className="flex items-center gap-1 rounded-2xl border-[1.5px] border-ink bg-surface ps-1 pe-1.5">
          <button
            type="button"
            onClick={() => open({ kind: 'search', mode: { kind: 'add' } })}
            className="flex min-h-13 flex-1 items-center gap-3 rounded-xl px-3 text-start text-muted"
          >
            <Search className="size-5 shrink-0 text-ink" strokeWidth={2.25} />
            <span>מה צריך לקנות?</span>
          </button>
          <IconButton label="הדבק רשימה" onClick={() => open({ kind: 'paste' })}>
            <ClipboardList className="size-[1.35rem]" />
          </IconButton>
          <IconButton label="סרוק ברקוד" onClick={() => open({ kind: 'scan' })}>
            <ScanBarcode className="size-[1.35rem]" />
          </IconButton>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="הרשימה ריקה"
          action={
            <>
              <Button onClick={() => open({ kind: 'search', mode: { kind: 'add' } })}>הוסף מוצר ראשון</Button>
              <Button variant="quiet" onClick={() => open({ kind: 'paste' })}>
                הדבק רשימה מוואטסאפ
              </Button>
            </>
          }
        >
          חפש מוצר, סרוק ברקוד או הדבק רשימה שכתבת. נראה לך כמה כל מוצר עולה בכל אחד מהסניפים שבחרת.
        </EmptyState>
      ) : (
        <>
          <BestStoreBanner />
          <ul className="perforated mx-4 mt-3 rounded-2xl bg-surface">
            {items.map((item) => (
              <ListRow key={item.id} item={item} prices={prices.get(item.id)} />
            ))}
          </ul>
          <p className="mt-3 px-6 text-sm text-muted">
            {items.length === 1 ? 'מוצר אחד ברשימה' : `${items.length} מוצרים ברשימה`}. המחירים לפי הקבצים
            שהרשתות מפרסמות; המחיר בקופה הוא הקובע.
          </p>
        </>
      )}
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
        <span className="block text-sm opacity-75">הכי זול ב</span>
        <span className="block truncate text-lg leading-tight font-bold">{storeTitle(store, index)}</span>
        <span className="mt-0.5 block text-sm opacity-75">
          {best.missing.length > 0 ? (
            <>כולל הערכה {best.missing.length === 1 ? 'למוצר אחד שחסר' : `ל-${best.missing.length} מוצרים שחסרים`} שם</>
          ) : comparison.quotes.length > 1 && gap >= 0.5 ? (
            <>
              <Price value={gap} /> פחות מהיקר ביותר
            </>
          ) : (
            <>כל המוצרים שברשימה</>
          )}
        </span>
      </span>
      <PriceTag value={best.estimate} />
      <ChevronLeft className="size-5 shrink-0 opacity-60" />
    </button>
  );
}

function ListRow({ item, prices }: { item: ListItem; prices: RowPrices | undefined }) {
  const setQty = useApp((s) => s.setQty);
  const open = useNav((s) => s.open);
  const product = useData((s) => (item.pids[0] ? s.catalog.products.get(item.pids[0]) : undefined));
  const storeCount = useData((s) => s.catalog.storeIds.length);
  const weighted = product?.weighted ?? false;
  const unmatched = item.pids.length === 0;
  const priced = prices && Number.isFinite(prices.min);

  return (
    <li className="flex items-center gap-3 py-3 ps-4 pe-3">
      <button type="button" className="min-w-0 flex-1 text-start" onClick={() => open({ kind: 'item', itemId: item.id })}>
        <span className="line-clamp-2 leading-snug font-medium">
          {unmatched ? <QtyBadge qty={item.qty} /> : null}
          {item.label}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {unmatched ? (
            <span className="text-alert">עוד לא נבחר מוצר</span>
          ) : priced ? (
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
      {unmatched ? (
        <Button
          variant="tag"
          className="min-h-10 shrink-0 rounded-full px-4 text-sm"
          onClick={() => open({ kind: 'search', mode: { kind: 'match', itemId: item.id, query: item.label } })}
        >
          בחר מוצר
        </Button>
      ) : (
        <Stepper
          value={item.qty}
          step={stepFor(weighted)}
          unit={qtyUnit(weighted)}
          onChange={(q) => setQty(item.id, q)}
        />
      )}
    </li>
  );
}
