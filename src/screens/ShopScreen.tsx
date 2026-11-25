import { Check } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Button, cx, DealChip, EmptyState, Price, QtyBadge, ScreenHeader } from '../components/ui';
import { finishShopping } from '../lib/actions';
import { quoteLine, type Line } from '../engine/optimizer';
import { nextDeal, promoLabel } from '../lib/pricing';
import { storeTitle, useChosenStores, useComparison, usePricingOptions } from '../lib/view';
import { useApp } from '../state/app';
import { buzz } from '../lib/actions';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import type { ListItem, Promo, StoreInfo } from '../types';

interface ShopRow {
  item: ListItem;
  line: Line | null;
  /** A multi-buy deal the shopper is one step away from. */
  hint: Promo | null;
  /** Cheapest other chosen store that does sell the item, when this one does not. */
  elsewhere: { store: StoreInfo; total: number } | null;
  /** This store's prices have not downloaded yet, so "not sold here" would be a guess. */
  pending: boolean;
  /** The product to take off the shelf here, when it is not what the line is called. */
  chosen: string | null;
  /** Sold by weight here: deals are prices per kilo. */
  weighted: boolean;
}

/** The list as a checklist for one store, built for one-handed use in the aisle. */
export function ShopScreen() {
  const items = useApp((s) => s.items);
  const shopStoreId = useApp((s) => s.shopStoreId);
  const catalog = useData((s) => s.catalog);
  const index = useData((s) => s.index);
  const stores = useChosenStores();
  const comparison = useComparison();
  const opts = usePricingOptions();
  const go = useNav((s) => s.go);
  const open = useNav((s) => s.open);

  // In the aisle the phone is glanced at, not touched: keep the screen from going dark.
  useEffect(() => {
    type Sentinel = { release(): Promise<void> };
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
    if (!wakeLock) return;
    let sentinel: Sentinel | undefined;
    let cancelled = false;
    const acquire = () =>
      wakeLock
        .request('screen')
        .then((s) => {
          if (cancelled) void s.release();
          else sentinel = s;
        })
        .catch(() => undefined);
    void acquire();
    // The lock is dropped when the app goes to the background; take it again on return.
    const onVisible = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  // Keep the current store's chip in view, moving only the chip row, never the page.
  const chipRow = useRef<HTMLDivElement>(null);
  const storeIdForScroll = shopStoreId;
  useEffect(() => {
    const row = chipRow.current;
    const chip = row?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!row || !chip) return;
    row.scrollTo({ left: chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
  }, [storeIdForScroll]);

  // Default to the cheapest store until the shopper says where they are.
  const storeId = shopStoreId ?? comparison.quotes[0]?.storeId ?? stores[0]?.id;
  const store = stores.find((s) => s.id === storeId);

  const rows = useMemo<ShopRow[]>(() => {
    if (!storeId) return [];
    return items.map((item) => {
      const line = quoteLine(item, storeId, catalog, opts);
      let hint: Promo | null = null;
      let elsewhere: ShopRow['elsewhere'] = null;
      if (line) {
        const product = catalog.products.get(line.pid);
        const offer = product?.offers.get(storeId);
        if (product && offer) hint = nextDeal(offer, item.qty, opts, product.weighted);
      } else if (item.pids.length) {
        for (const other of stores) {
          if (other.id === storeId) continue;
          const l = quoteLine(item, other.id, catalog, opts);
          if (l && (!elsewhere || l.total < elsewhere.total)) elsewhere = { store: other, total: l.total };
        }
      }
      const name = line ? catalog.products.get(line.pid)?.name : undefined;
      return {
        item,
        line,
        hint,
        elsewhere,
        pending: !catalog.storeIds.includes(storeId),
        chosen: name && name !== item.label ? name : null,
        weighted: (line && catalog.products.get(line.pid)?.weighted) ?? false,
      };
    });
  }, [items, storeId, catalog, opts, stores]);

  const header = (
    <ScreenHeader title="בסופר">
      {items.length ? 'סמן כל מוצר כשהוא נכנס לעגלה. בחר למעלה באיזה סניף אתה נמצא.' : null}
    </ScreenHeader>
  );

  if (items.length === 0) {
    return (
      <>
        {header}
        <EmptyState title="אין מה לאסוף" action={<Button onClick={() => go('list')}>בנה רשימה</Button>}>
          כשתהיה רשימה, כאן תסמן כל מוצר שנכנס לעגלה ותראה כמה הצטבר.
        </EmptyState>
      </>
    );
  }

  const todo = rows.filter((r) => !r.item.checked);
  const done = rows.filter((r) => r.item.checked);
  const inCart = done.reduce((n, r) => n + (r.line?.total ?? 0), 0);
  const expected = rows.reduce((n, r) => n + (r.line?.total ?? 0), 0);

  return (
    <div className="pb-48">
      {header}

      {stores.length > 1 ? (
        <div
          ref={chipRow}
          className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]"
          role="radiogroup"
          aria-label="באיזה סניף אתה?"
        >
          {stores.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === storeId}
              onClick={() => useApp.getState().setShopStore(s.id)}
              data-store={s.id}
              className={cx(
                'min-h-11 shrink-0 rounded-full border-[1.5px] px-4 text-sm font-semibold whitespace-nowrap',
                s.id === storeId ? 'border-ink bg-ink text-surface' : 'border-line bg-surface',
              )}
            >
              {storeTitle(s, index)}
            </button>
          ))}
        </div>
      ) : store ? (
        <p className="px-5 pb-3 font-semibold">{storeTitle(store, index)}</p>
      ) : null}

      {todo.length > 0 ? (
        <ul className="perforated mx-4 rounded-2xl bg-surface">
          {todo.map((r) => (
            <CheckRow key={r.item.id} row={r} />
          ))}
        </ul>
      ) : (
        <div className="mx-4 rounded-2xl bg-tag p-5 text-center text-tag-ink">
          <p className="font-display text-4xl leading-none font-bold">הכול בעגלה</p>
          <Button className="mt-4" onClick={finishShopping}>
            סיימתי לקנות
          </Button>
        </div>
      )}

      {done.length > 0 ? (
        <>
          <h2 className="mt-5 px-5 font-semibold text-muted">
            כבר בעגלה ({done.length}). לחץ שוב על העיגול אם סימנת בטעות.
          </h2>
          <ul className="perforated mx-4 mt-2 rounded-2xl bg-surface">
            {done.map((r) => (
              <CheckRow key={r.item.id} row={r} />
            ))}
          </ul>
        </>
      ) : null}

      {/* Running total, parked just above the tab bar. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30">
        <div className="frame px-4">
          <div className="pointer-events-auto rounded-2xl bg-ink px-4 pt-3 pb-3 text-surface shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">
              <span className="num font-bold">{done.length}</span> מתוך <span className="num font-bold">{rows.length}</span> בעגלה
            </span>
            <span className="text-end leading-tight">
              <Price value={inCart} className="text-xl" />
              <span className="block text-xs opacity-70">
                צפוי בקופה <Price value={expected} className="font-normal" />
              </span>
            </span>
          </div>
          {todo.length > 0 ? (
            <Button variant="tag" className="mt-2.5 min-h-11 w-full" onClick={() => open({ kind: 'finish' })}>
              סיימתי לקנות
            </Button>
          ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ row }: { row: ShopRow }) {
  const { item, line, hint, elsewhere, pending, chosen, weighted } = row;
  const index = useData((s) => s.index);
  const toggle = useApp((s) => s.toggleChecked);
  const open = useNav((s) => s.open);
  const more = hint ? hint.minQty - item.qty : 0;

  return (
    <li className="flex items-center gap-1 pe-4">
      <button
        type="button"
        role="checkbox"
        aria-checked={item.checked}
        aria-label={item.label}
        onClick={() => {
          buzz(12);
          toggle(item.id);
        }}
        className="flex size-16 shrink-0 items-center justify-center"
      >
        <span
          className={cx(
            'flex size-9 items-center justify-center rounded-full border-[2.5px]',
            item.checked ? 'animate-pop border-ink bg-ink text-surface' : 'border-ink',
          )}
        >
          {item.checked ? <Check className="size-5" strokeWidth={3.5} /> : null}
        </span>
      </button>
      <button type="button" className="min-w-0 flex-1 py-3 text-start" onClick={() => open({ kind: 'item', itemId: item.id })}>
        <span className={cx('line-clamp-2 text-[1.05rem] leading-snug font-medium', item.checked && 'text-muted line-through')}>
          <QtyBadge qty={item.qty} />
          {item.label}
        </span>
        {chosen && !item.checked ? <span className="mt-0.5 block text-sm text-muted">כאן: {chosen}</span> : null}
        {item.checked ? null : (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            {line?.promo ? <DealChip club={line.promo.club}>{promoLabel(line.promo, weighted)}</DealChip> : null}
            {hint && weighted ? <span>{promoLabel(hint, true)}</span> : null}
            {hint && !weighted && more > 0 && more <= 2 ? (
              <span>
                עוד {more === 1 ? 'אחד' : more} ויוצא {promoLabel(hint)}
              </span>
            ) : null}
            {!line && item.pids.length > 0 && pending ? <span>המחיר בסניף הזה עוד לא ירד</span> : null}
            {!line && item.pids.length > 0 && !pending ? (
              <span className="text-alert">
                לא נמכר כאן
                {elsewhere ? (
                  <span className="text-muted">
                    . יש ב{storeTitle(elsewhere.store, index)} ב-<Price value={elsewhere.total} className="font-normal" />
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        )}
      </button>
      {line ? <Price value={line.total} className={cx('shrink-0', item.checked && 'font-normal text-muted')} /> : null}
    </li>
  );
}
