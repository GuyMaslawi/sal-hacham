import { Check, ChevronDown, Plus, ScanBarcode, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { BackButton, Button, cx, DealChip, FullScreen, IconButton, LabeledIconButton, Price, Stepper, toast } from '../components/ui';
import { searchProducts } from '../data/catalog';
import { changeQty } from '../lib/actions';
import { costFor, promoLabel, sizeLabel, unitPrice } from '../lib/pricing';
import { qtyUnit, storeTitle, useChosenStores, usePricingOptions, useStoreLookup } from '../lib/view';
import { stepFor, useApp } from '../state/app';
import { useData } from '../state/data';
import { useNav, type SearchMode } from '../state/nav';
import type { Product, Promo } from '../types';

const HEADINGS: Record<SearchMode['kind'], string> = {
  add: 'הוספת מוצרים',
  match: 'איזה מוצר התכוונת?',
  substitute: 'בחירת תחליף',
};

export function SearchScreen({ mode }: { mode: SearchMode }) {
  const close = useNav((s) => s.close);
  const open = useNav((s) => s.open);
  const catalog = useData((s) => s.catalog);
  const index = useData((s) => s.index);
  const lookup = useStoreLookup();
  const [query, setQuery] = useState(mode.query ?? '');
  const [expanded, setExpanded] = useState<string | null>(null);
  // How many things were added since this screen opened, for the "done" button.
  const [added, setAdded] = useState(0);
  const deferred = useDeferredValue(query);

  const onlyStore = mode.kind === 'substitute' ? mode.storeId : undefined;
  const results = useMemo(
    () => searchProducts(catalog, deferred, { storeId: onlyStore }),
    [catalog, deferred, onlyStore],
  );
  const onlyStoreInfo = onlyStore ? lookup(onlyStore) : undefined;

  const pick = (product: Product) => {
    const app = useApp.getState();
    if (mode.kind === 'match') {
      app.attachProduct(mode.itemId, product, true);
      toast(`נבחר: ${product.name}`);
      close();
    } else if (mode.kind === 'substitute') {
      app.attachProduct(mode.itemId, product, false);
      toast('התחליף נוסף');
      close();
    } else {
      app.addProduct(product);
      setAdded((n) => n + 1);
      toast(`נוסף לרשימה: ${product.name}`);
    }
  };

  const trimmed = query.trim();

  return (
    <FullScreen onClose={close} label={HEADINGS[mode.kind]}>
      <div className="border-b-[1.5px] border-line bg-surface px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-2">
          <BackButton onClick={close} />
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold">{HEADINGS[mode.kind]}</h2>
        </div>
        <div className="mt-2 flex items-center gap-1 ps-1">
          <div className="relative flex-1">
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="שם מוצר, מותג או ברקוד"
              aria-label="חיפוש מוצר"
              className="h-12 w-full rounded-xl bg-sunken ps-4 pe-11 text-[1.05rem] outline-none focus:ring-2 focus:ring-ink"
            />
            {query ? (
              <IconButton label="נקה חיפוש" onClick={() => setQuery('')} className="absolute end-0.5 top-0.5">
                <X className="size-5 text-muted" />
              </IconButton>
            ) : null}
          </div>
          {mode.kind === 'add' ? (
            <LabeledIconButton label="ברקוד" onClick={() => open({ kind: 'scan' })}>
              <ScanBarcode className="size-6" />
            </LabeledIconButton>
          ) : null}
        </div>
        {mode.kind !== 'add' ? (
          <p className="px-2 pt-2 text-sm text-muted">
            {mode.kind === 'match'
              ? 'בחר את המוצר שמתאים לשורה ברשימה, כדי שנוכל להשוות את המחיר שלו.'
              : `מוצרים שנמכרים ב${onlyStoreInfo ? storeTitle(onlyStoreInfo, index) : 'סניף הזה'}. התחליף ייחשב רק במקום שבו המוצר המקורי חסר או יקר יותר.`}
          </p>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]">
        {!trimmed ? (
          <p className="px-6 pt-10 text-center text-muted">
            כתוב מה אתה מחפש, למשל "חלב" או "אורז". אפשר להוסיף מילים כדי לדייק, כמו "חלב 3% תנובה".
          </p>
        ) : (
          <>
            {results.length > 0 ? (
              <>
                {mode.kind !== 'substitute' ? (
                  <p className="px-5 pt-3 pb-2 text-sm text-muted">
                    המחיר הוא הזול ביותר בין הסניפים שלך. לחץ על מוצר כדי לראות את המחיר בכל סניף.
                  </p>
                ) : null}
                <ul className="perforated bg-surface">
                  {results.map((p) => (
                    <ResultRow
                      key={p.pid}
                      product={p}
                      mode={mode}
                      expanded={expanded === p.pid}
                      onToggle={() => setExpanded((cur) => (cur === p.pid ? null : p.pid))}
                      onPick={() => pick(p)}
                    />
                  ))}
                </ul>
              </>
            ) : (
              <p className="px-6 pt-10 text-center text-muted">
                לא מצאנו "{trimmed}" בסניפים שבחרת. נסה מילה אחת פחות, או כתיב אחר.
              </p>
            )}
            {mode.kind === 'add' ? (
              <button
                type="button"
                onClick={() => {
                  useApp.getState().addFreeText([{ label: trimmed, qty: 1 }]);
                  toast(`נוסף לרשימה: ${trimmed}`);
                  setAdded((n) => n + 1);
                  setQuery('');
                }}
                className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl border-[1.5px] border-dashed border-line px-4 py-3 text-start"
              >
                <Plus className="size-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block font-medium">הוסף לרשימה את המילה "{trimmed}"</span>
                  <span className="block text-sm text-muted">בלי מחיר בינתיים. אפשר לבחור את המוצר המדויק אחר כך.</span>
                </span>
              </button>
            ) : null}
          </>
        )}
      </div>
      {mode.kind === 'add' && added > 0 ? (
        <div className="border-t-[1.5px] border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="tag" className="w-full" onClick={close}>
            <Check className="size-5" strokeWidth={2.75} />
            סיימתי, חזרה לרשימה ({added === 1 ? 'נוסף מוצר אחד' : `נוספו ${added}`})
          </Button>
        </div>
      ) : null}
    </FullScreen>
  );
}

function ResultRow({
  product,
  mode,
  expanded,
  onToggle,
  onPick,
}: {
  product: Product;
  mode: SearchMode;
  expanded: boolean;
  onToggle: () => void;
  onPick: () => void;
}) {
  const opts = usePricingOptions();
  const storeCount = useData((s) => s.catalog.storeIds.length);
  const inList = useApp((s) => (mode.kind === 'add' ? s.items.find((i) => i.pids.includes(product.pid)) : undefined));

  // Cheapest single-unit price among the stores in scope, and the best deal on offer.
  let min = Infinity;
  let deal: Promo | null = null;
  const offers =
    mode.kind === 'substitute'
      ? [product.offers.get(mode.storeId)].filter((o) => o !== undefined)
      : [...product.offers.values()];
  for (const offer of offers) {
    const cost = costFor(offer, 1, product.weighted, opts);
    if (cost.total < min) min = cost.total;
    for (const p of offer.promos) {
      if ((!p.club || opts.includeClub) && (!p.end || p.end >= opts.today)) {
        if (!deal || p.price / p.minQty < deal.price / deal.minQty) deal = p;
      }
    }
  }
  const per = unitPrice(product, min);
  const meta = [sizeLabel(product), product.manufacturer].filter(Boolean).join(', ');
  const canExpand = mode.kind !== 'substitute' && storeCount > 1;

  return (
    <li>
      <div className="flex items-center gap-3 py-3 ps-4 pe-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-start"
          onClick={canExpand ? onToggle : undefined}
          aria-expanded={canExpand ? expanded : undefined}
          disabled={!canExpand}
        >
          <span className="line-clamp-2 leading-snug font-medium">{product.name}</span>
          {meta ? <span className="block truncate text-sm text-muted">{meta}</span> : null}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>
              {offers.length > 1 ? 'מ-' : ''}
              <Price value={min} className="text-ink" />
            </span>
            {per ? (
              <span>
                <Price value={per.value} className="font-normal" /> {per.per}
              </span>
            ) : null}
            {deal ? <DealChip club={deal.club}>{promoLabel(deal)}</DealChip> : null}
            {canExpand ? (
              <span className="inline-flex items-center gap-0.5">
                ב-{product.offers.size} מתוך {storeCount} סניפים
                <ChevronDown className={cx('size-4 transition-transform', expanded && 'rotate-180')} />
              </span>
            ) : null}
          </span>
        </button>
        {inList ? (
          <Stepper
            value={inList.qty}
            step={stepFor(product.weighted)}
            unit={qtyUnit(product.weighted)}
            onChange={(q) => changeQty(inList.id, q)}
          />
        ) : (
          <button
            type="button"
            onClick={onPick}
            aria-label={mode.kind === 'add' ? `הוסף את ${product.name}` : `בחר את ${product.name}`}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-tag text-tag-ink active:brightness-95"
          >
            {mode.kind === 'add' ? <Plus className="size-5" strokeWidth={2.75} /> : <Check className="size-5" strokeWidth={2.75} />}
          </button>
        )}
      </div>
      {expanded ? <StorePrices product={product} /> : null}
    </li>
  );
}

/** What each chosen store charges for one unit, cheapest first. */
function StorePrices({ product }: { product: Product }) {
  const stores = useChosenStores();
  const loaded = useData((s) => s.catalog.storeIds);
  const index = useData((s) => s.index);
  const opts = usePricingOptions();
  const rows = stores
    .map((store) => {
      const offer = product.offers.get(store.id);
      if (!offer) return { store, price: null, deal: null as Promo | null };
      const usable = offer.promos.filter((p) => (!p.club || opts.includeClub) && (!p.end || p.end >= opts.today));
      const deal = usable.sort((a, b) => a.price / a.minQty - b.price / b.minQty)[0] ?? null;
      return { store, price: costFor(offer, 1, product.weighted, opts).total, deal };
    })
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  const cheapest = rows[0]?.price;

  return (
    <ul className="mx-4 mb-3 animate-fade rounded-xl bg-sunken px-3 py-1">
      {rows.map(({ store, price, deal }) => (
        <li key={store.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
          <span className="min-w-0 truncate">{storeTitle(store, index)}</span>
          <span className="flex shrink-0 items-center gap-2">
            {deal && deal.minQty > 1 ? <DealChip club={deal.club}>{promoLabel(deal)}</DealChip> : null}
            {price === null ? (
              <span className="text-muted">{loaded.includes(store.id) ? 'לא נמכר' : 'עוד לא ירד'}</span>
            ) : (
              <Price value={price} className={price === cheapest && rows.length > 1 ? 'font-bold text-save' : undefined} />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
