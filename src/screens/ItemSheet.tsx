import { Trash2, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Button, DealChip, IconButton, Price, Sheet, Stepper } from '../components/ui';
import { suggestSubstitutes } from '../data/catalog';
import { quoteLine } from '../engine/optimizer';
import { changeQty, removeWithUndo } from '../lib/actions';
import { costFor, formatPrice, nextDeal, promoLabel, sizeLabel, unitPrice } from '../lib/pricing';
import { qtyUnit, storeTitle, useChosenStores, usePricingOptions } from '../lib/view';
import { stepFor, useApp } from '../state/app';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import type { ListItem, Product, StoreInfo } from '../types';

/** Everything about one line of the list: quantity, price in every store, stand-ins. */
export function ItemSheet({ itemId }: { itemId: string }) {
  const close = useNav((s) => s.close);
  const open = useNav((s) => s.open);
  const item = useApp((s) => s.items.find((i) => i.id === itemId));
  const catalog = useData((s) => s.catalog);
  const index = useData((s) => s.index);
  const stores = useChosenStores();
  const opts = usePricingOptions();

  // The line was removed (quantity stepped down to zero): nothing left to show.
  useEffect(() => {
    if (!item) close();
  }, [item, close]);

  const rows = useMemo(() => {
    if (!item) return [];
    return stores
      .map((store) => ({ store, line: quoteLine(item, store.id, catalog, opts) }))
      .sort((a, b) => (a.line?.total ?? Infinity) - (b.line?.total ?? Infinity));
  }, [item, stores, catalog, opts]);

  if (!item) return null;

  const products = item.pids.map((pid) => catalog.products.get(pid)).filter((p): p is Product => !!p);
  const main = products[0];
  const weighted = main?.weighted ?? false;
  const cheapest = rows[0]?.line?.total;

  return (
    <Sheet
      title={item.label}
      subtitle={main ? [sizeLabel(main), main.manufacturer].filter(Boolean).join(', ') : undefined}
      onClose={close}
    >
      <div className="mt-1 flex items-center justify-between gap-3">
        <span className="font-medium">{weighted ? 'כמה ק"ג?' : 'כמה יחידות?'}</span>
        <Stepper
          size="lg"
          value={item.qty}
          step={stepFor(weighted)}
          unit={qtyUnit(weighted)}
          onChange={(q) => changeQty(item.id, q)}
        />
      </div>

      {item.pids.length === 0 ? (
        <div className="mt-5 rounded-xl bg-sunken p-4">
          <p className="text-sm text-muted">
            זו תזכורת בלבד. כדי לראות מחיר ולהשוות בין סניפים צריך לבחור מוצר מסוים.
          </p>
          <Button
            variant="tag"
            className="mt-3 w-full"
            onClick={() => open({ kind: 'search', mode: { kind: 'match', itemId: item.id, query: item.label } })}
          >
            בחר מוצר
          </Button>
        </div>
      ) : (
        <>
          <h3 className="mt-6 mb-1 text-sm font-semibold text-muted">
            המחיר ל-{item.qty} {weighted ? 'ק"ג' : item.qty === 1 ? 'יחידה' : 'יחידות'} בכל סניף
          </h3>
          <ul className="perforated">
            {rows.map(({ store, line }) => (
              <li key={store.id} className="py-3">
                {line ? (
                  <PricedRow
                    store={store}
                    title={storeTitle(store, index)}
                    product={catalog.products.get(line.pid)!}
                    showProduct={products.length > 1}
                    line={line}
                    qty={item.qty}
                    extra={cheapest !== undefined ? line.total - cheapest : 0}
                  />
                ) : (
                  <MissingRow item={item} store={store} title={storeTitle(store, index)} main={main} />
                )}
              </li>
            ))}
          </ul>

          {products.length > 1 ? (
            <>
              <h3 className="mt-5 mb-1 text-sm font-semibold text-muted">מוצרים שמתאימים לשורה הזו</h3>
              <ul className="perforated">
                {products.map((p) => (
                  <li key={p.pid} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                    <IconButton
                      label={`הסר את ${p.name}`}
                      onClick={() => useApp.getState().detachProduct(item.id, p.pid)}
                      className="size-9"
                    >
                      <X className="size-4 text-muted" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}

      <Button
        variant="danger"
        className="mt-4 w-full"
        onClick={() => removeWithUndo(item.id)}
      >
        <Trash2 className="size-[1.15rem]" />
        הסר מהרשימה
      </Button>
    </Sheet>
  );
}

function PricedRow({
  store,
  title,
  product,
  showProduct,
  line,
  qty,
  extra,
}: {
  store: StoreInfo;
  title: string;
  product: Product;
  showProduct: boolean;
  line: NonNullable<ReturnType<typeof quoteLine>>;
  qty: number;
  extra: number;
}) {
  const opts = usePricingOptions();
  const per = unitPrice(product, line.total / qty);
  // A multi-buy deal this store offers that the current quantity does not reach yet.
  const offer = product.offers.get(store.id);
  const hint = offer ? nextDeal(offer, qty, opts) : null;
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="leading-snug font-medium">{title}</p>
        {showProduct ? <p className="truncate text-sm text-muted">{product.name}</p> : null}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          {line.promo ? <DealChip club={line.promo.club}>{promoLabel(line.promo)}</DealChip> : null}
          {hint ? (
            <span>
              בקניית {hint.minQty}: {promoLabel(hint)}
            </span>
          ) : null}
          {per ? (
            <span>
              <Price value={per.value} className="font-normal" /> {per.per}
            </span>
          ) : null}
        </p>
      </div>
      <div className="text-end">
        <Price value={line.total} className="text-lg" />
        {extra >= 0.05 ? (
          <p className="num text-sm text-alert">+{formatPrice(extra)}</p>
        ) : (
          <p className="text-sm font-semibold text-save">הכי זול</p>
        )}
      </div>
    </div>
  );
}

function MissingRow({ item, store, title, main }: { item: ListItem; store: StoreInfo; title: string; main: Product | undefined }) {
  const catalog = useData((s) => s.catalog);
  const open = useNav((s) => s.open);
  const opts = usePricingOptions();
  const suggestions = useMemo(
    () => (main ? suggestSubstitutes(catalog, main, store.id, 2) : []),
    [catalog, main, store.id],
  );
  // Start the manual search from the product's first two words: specific enough, not too narrow.
  const seed = item.label.split(/\s+/).slice(0, 2).join(' ');

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="leading-snug font-medium">{title}</p>
        <p className="shrink-0 text-sm text-alert">לא נמכר כאן</p>
      </div>
      {suggestions.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {suggestions.map((s) => {
            const price = costFor(s.offers.get(store.id)!, item.qty, s.weighted, opts).total;
            return (
              <li key={s.pid} className="flex items-center gap-2 rounded-xl bg-sunken py-2 ps-3 pe-2">
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm leading-snug">{s.name}</span>
                  <span className="text-sm text-muted">
                    {sizeLabel(s)} <Price value={price} className="text-ink" />
                  </span>
                </span>
                <Button
                  variant="outline"
                  className="min-h-9 shrink-0 rounded-full px-3 text-sm"
                  onClick={() => useApp.getState().attachProduct(item.id, s, false)}
                >
                  זה מתאים
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <button
        type="button"
        className="mt-2 text-sm font-semibold underline underline-offset-4"
        onClick={() =>
          open({ kind: 'search', mode: { kind: 'substitute', itemId: item.id, storeId: store.id, query: seed } })
        }
      >
        {suggestions.length > 0 ? 'חפש תחליף אחר' : 'חפש תחליף בסניף הזה'}
      </button>
    </div>
  );
}
