import { ChevronDown, ChevronRight, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Button, cx, DealChip, EmptyState, Price, PriceTag, QtyBadge, ScreenHeader } from '../components/ui';
import type { Line, SplitPlan, StoreQuote } from '../engine/optimizer';
import { formatPrice, promoLabel } from '../lib/pricing';
import { freshness, storePlace, storeTitle, useComparison, useStoreLookup } from '../lib/view';
import { useApp } from '../state/app';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import type { ListItem } from '../types';

export function CompareScreen() {
  const comparison = useComparison();
  const items = useApp((s) => s.items);
  const go = useNav((s) => s.go);
  const open = useNav((s) => s.open);
  const splitThreshold = useApp((s) => s.settings.splitThreshold);
  const { quotes, split, unmatched, unavailable, pricedCount } = comparison;

  const header = (
    <ScreenHeader title="איפה הכי זול?" />
  );

  if (pricedCount === 0) {
    return (
      <>
        {header}
        <EmptyState
          title={items.length === 0 ? 'אין מה להשוות עדיין' : unavailable.length ? 'אין מחירים להשוואה' : 'צריך לבחור מוצרים'}
          action={<Button onClick={() => go('list')}>{items.length === 0 ? 'בנה רשימה' : 'חזרה לרשימה'}</Button>}
        >
          {items.length === 0
            ? 'הוסף מוצרים לרשימה, ונחשב כמה כל הסל עולה בכל אחד מהסניפים שבחרת.'
            : unavailable.length
              ? 'המוצרים שברשימה לא נמכרים בסניפים שבחרת. אפשר להוסיף סניף בלשונית "סניפים", או לבחור מוצר דומה ברשימה.'
              : 'השורות ברשימה הן עדיין תזכורות בלי מוצר מסוים. בחר מוצר לכל שורה כדי לקבל מחיר.'}
        </EmptyState>
      </>
    );
  }

  const best = quotes[0];
  const dearest = quotes[quotes.length - 1];
  const spread = dearest.estimate - best.estimate;
  const byId = new Map(items.map((i) => [i.id, i]));
  // When the cheapest store lacks items, also point out the cheapest store that has them all.
  const bestComplete = best.missing.length > 0 ? quotes.find((q) => q.missing.length === 0) : undefined;
  const splitWorthIt = split && split.saving >= splitThreshold;

  return (
    <div className="pb-6">
      {header}

      <p className="-mt-1 px-5 pb-3 text-muted">
        {pricedCount === 1 ? 'מוצר אחד' : `${pricedCount} מוצרים`} {quotes.length === 1 ? 'בסניף אחד' : `ב-${quotes.length} סניפים`}.{' '}
        {quotes.length > 1 ? (
          spread >= 0.5 ? (
            <>
              ההפרש בין הזול ליקר: <Price value={spread} className="font-bold text-ink" />.{' '}
            </>
          ) : (
            <>המחיר כמעט זהה בכולם. </>
          )
        ) : null}
        המחיר הגדול בכל כרטיס הוא כמה תשלם על כל הרשימה באותו סניף.{' '}
        <button
          type="button"
          className="-my-2 inline-block py-2.5 font-semibold text-ink underline underline-offset-4"
          onClick={() => open({ kind: 'help' })}
        >
          איך זה מחושב?
        </button>
      </p>

      <ol className="mx-4 space-y-2.5">
        {quotes.map((q, rank) => (
          <StoreCard
            key={q.storeId}
            quote={q}
            rank={rank}
            best={best}
            hasEverything={q === bestComplete}
            items={byId}
            pricedCount={pricedCount}
          />
        ))}
      </ol>

      {quotes.length < 2 ? (
        <p className="mx-6 mt-4 text-sm text-muted">
          יש לך סניף אחד בלבד. הוסף עוד סניף בלשונית "סניפים" כדי להשוות ביניהם.
        </p>
      ) : null}

      {split ? (
        splitWorthIt ? (
          <SplitCard split={split} items={byId} />
        ) : (
          <p className="mx-6 mt-5 text-sm text-muted">
            פיצול הקנייה בין שני סניפים היה חוסך רק <Price value={split.saving} />, פחות מהרף שהגדרת (
            <span className="num">₪{splitThreshold}</span>), אז לא שווה את העצירה הנוספת.
          </p>
        )
      ) : null}

      {unmatched.length + unavailable.length > 0 ? (
        <section className="mx-4 mt-5 rounded-2xl border-[1.5px] border-dashed border-line p-4">
          <h2 className="font-bold">לא נכנסו לחישוב</h2>
          <ul className="mt-2 space-y-2">
            {unmatched.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{i.label}</span>
                <button
                  type="button"
                  className="min-h-11 shrink-0 px-1 text-sm font-semibold underline underline-offset-4"
                  onClick={() => open({ kind: 'search', mode: { kind: 'match', itemId: i.id, query: i.label } })}
                >
                  בחר מוצר
                </button>
              </li>
            ))}
            {unavailable.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">{i.label}</span>
                <span className="shrink-0 text-sm text-muted">לא נמכר בסניפים שבחרת</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mx-4 mt-6 space-y-2">
        <Button
          variant="tag"
          className="w-full"
          onClick={() => {
            useApp.getState().setShopStore(best.storeId);
            go('shop');
          }}
        >
          <ShoppingCart className="size-5" />
          הבא: יוצאים לקנות
        </Button>
        <Button variant="outline" className="w-full" onClick={() => go('list')}>
          <ChevronRight className="size-5" />
          חזרה לרשימה
        </Button>
      </div>
    </div>
  );
}

function StoreCard({
  quote,
  rank,
  best,
  hasEverything,
  items,
  pricedCount,
}: {
  quote: StoreQuote;
  rank: number;
  best: StoreQuote;
  /** The cheapest store among those that sell the whole list (shown when it is not rank 0). */
  hasEverything: boolean;
  items: Map<string, ListItem>;
  pricedCount: number;
}) {
  const index = useData((s) => s.index);
  const lookup = useStoreLookup();
  const go = useNav((s) => s.go);
  const [expanded, setExpanded] = useState(false);
  const store = lookup(quote.storeId);
  if (!store) return null;

  const isBest = rank === 0;
  const gap = quote.estimate - best.estimate;
  const age = freshness(store.updatedAt);
  const shopHere = () => {
    useApp.getState().setShopStore(quote.storeId);
    go('shop');
  };

  return (
    <li className={cx('rounded-2xl bg-surface', isBest && 'border-[2.5px] border-ink')}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 p-4 pb-3 text-start"
      >
        <span className="min-w-0 flex-1">
          {isBest ? <span className="mb-1 block text-sm font-bold text-save">הסל הזול ביותר</span> : null}
          {hasEverything ? <span className="mb-1 block text-sm font-bold text-save">הזול ביותר שיש בו הכול</span> : null}
          <span className="block text-lg leading-tight font-bold">{storeTitle(store, index)}</span>
          <span className="mt-0.5 block truncate text-sm text-muted">{storePlace(store)}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          {/* The comparable number: this store's total plus an allowance for what it lacks. */}
          <PriceTag value={quote.estimate} plain={!isBest} size={isBest ? 'md' : 'sm'} />
          {!isBest && gap >= 0.05 ? <span className="num text-sm font-semibold text-alert">+{formatPrice(gap)}</span> : null}
          <span className="inline-flex items-center gap-0.5 text-sm font-semibold text-muted">
            {expanded ? 'הסתר' : 'מה בסל'}
            <ChevronDown className={cx('size-4 transition-transform', expanded && 'rotate-180')} />
          </span>
        </span>
      </button>

      {quote.missing.length > 0 ? (
        <p className="px-4 pb-2 text-sm leading-snug">
          <span className="font-semibold text-alert">
            {quote.missing.length === 1 ? 'מוצר אחד חסר כאן.' : `${quote.missing.length} מוצרים חסרים כאן.`}
          </span>{' '}
          <Price value={quote.total} /> בקופה, ועוד בערך <Price value={quote.estimate - quote.total} /> כדי להשלים{' '}
          {quote.missing.length === 1 ? 'אותו' : 'אותם'} במקום אחר.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 text-sm text-muted">
        {quote.missing.length === 0 ? <span>{pricedCount === 1 ? 'המוצר נמכר כאן' : `כל ${pricedCount} המוצרים`}</span> : null}
        {quote.promoSaving >= 0.5 ? (
          <span>
            מבצעים חוסכים <Price value={quote.promoSaving} className="font-normal" />
          </span>
        ) : null}
        <span className={cx(age.stale && 'text-alert')}>{age.text}</span>
      </div>

      {isBest && !expanded ? (
        <div className="px-4 pb-4">
          <Button variant="tag" className="w-full" onClick={shopHere}>
            <ShoppingCart className="size-5" />
            אני קונה כאן
          </Button>
        </div>
      ) : null}

      {expanded ? (
        <div className="border-t-[1.5px] border-dashed border-line px-4 pt-1 pb-4">
          <LineList lines={quote.lines} items={items} />
          {quote.missing.length > 0 ? (
            <ul className="mt-1">
              {quote.missing.map((id) => (
                <li key={id} className="flex justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate text-muted line-through">{items.get(id)?.label}</span>
                  <span className="shrink-0 text-alert">לא נמכר כאן</span>
                </li>
              ))}
            </ul>
          ) : null}
          <Button variant={isBest ? 'tag' : 'outline'} className="mt-3 w-full" onClick={shopHere}>
            <ShoppingCart className="size-5" />
            אני קונה כאן
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function LineList({ lines, items }: { lines: Line[]; items: Map<string, ListItem> }) {
  return (
    <ul>
      {lines.map((line) => {
        const item = items.get(line.itemId);
        if (!item) return null;
        return (
          <li key={line.itemId} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0">
              <span className="line-clamp-1">
                <QtyBadge qty={item.qty} />
                {item.label}
              </span>
              {line.promo ? <DealChip club={line.promo.club}>{promoLabel(line.promo)}</DealChip> : null}
            </span>
            <Price value={line.total} className="shrink-0" />
          </li>
        );
      })}
    </ul>
  );
}

function SplitCard({ split, items }: { split: SplitPlan; items: Map<string, ListItem> }) {
  const index = useData((s) => s.index);
  const lookup = useStoreLookup();
  return (
    <section className="mx-4 mt-5 overflow-hidden rounded-2xl bg-tag text-tag-ink">
      <div className="flex items-end justify-between gap-3 px-4 pt-4 pb-3">
        <div>
          <h2 className="font-display text-3xl leading-none font-bold">שווה לפצל לשניים</h2>
          <p className="mt-1.5 text-sm leading-snug font-medium">
            שתי עצירות במקום אחת, וחוסכים <Price value={split.saving} /> לעומת הסניף הזול ביותר.
          </p>
        </div>
        <PriceTag value={split.total} />
      </div>
      <div className="perforated bg-surface text-ink">
        {split.stores.map((part) => {
          const store = lookup(part.storeId);
          return (
            <div key={part.storeId} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-bold">{store ? storeTitle(store, index) : part.storeId}</h3>
                <Price value={part.total} />
              </div>
              <LineList lines={part.lines} items={items} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
