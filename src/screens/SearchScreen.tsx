import { ArrowRight, Check, Plus, ScanBarcode, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { DealChip, FullScreen, IconButton, Price, Stepper, toast } from '../components/ui';
import { searchProducts } from '../data/catalog';
import { costFor, promoLabel, sizeLabel, unitPrice } from '../lib/pricing';
import { qtyUnit, storeTitle, usePricingOptions, useStoreLookup } from '../lib/view';
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
  const [query, setQuery] = useState(mode.kind === 'add' ? '' : mode.query);
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
      close();
    } else if (mode.kind === 'substitute') {
      app.attachProduct(mode.itemId, product, false);
      toast('התחליף נוסף');
      close();
    } else {
      app.addProduct(product);
    }
  };

  const trimmed = query.trim();

  return (
    <FullScreen onClose={close} label={HEADINGS[mode.kind]}>
      <div className="border-b-[1.5px] border-line bg-surface px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-1">
          <IconButton label="חזרה" onClick={close}>
            <ArrowRight className="size-6" />
          </IconButton>
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
            <IconButton label="סרוק ברקוד" onClick={() => open({ kind: 'scan' })}>
              <ScanBarcode className="size-6" />
            </IconButton>
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
            כתוב מה אתה מחפש. אפשר כמה מילים, למשל "חלב 3% תנובה" או "אורז בסמטי".
          </p>
        ) : (
          <>
            {results.length > 0 ? (
              <ul className="perforated bg-surface">
                {results.map((p) => (
                  <ResultRow key={p.pid} product={p} mode={mode} onPick={() => pick(p)} />
                ))}
              </ul>
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
                  toast(`"${trimmed}" נוסף לרשימה`);
                  setQuery('');
                }}
                className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl border-[1.5px] border-dashed border-line px-4 py-3 text-start"
              >
                <Plus className="size-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">הוסף "{trimmed}" כתזכורת</span>
                  <span className="block text-sm text-muted">בלי מחיר, עד שתבחר מוצר מסוים</span>
                </span>
              </button>
            ) : null}
          </>
        )}
      </div>
    </FullScreen>
  );
}

function ResultRow({ product, mode, onPick }: { product: Product; mode: SearchMode; onPick: () => void }) {
  const opts = usePricingOptions();
  const storeCount = useData((s) => s.catalog.storeIds.length);
  const inList = useApp((s) => (mode.kind === 'add' ? s.items.find((i) => i.pids.includes(product.pid)) : undefined));
  const setQty = useApp((s) => s.setQty);

  // Cheapest single-unit price among the stores in scope, and the deal behind it if any.
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

  return (
    <li className="flex items-center gap-3 py-3 ps-4 pe-3">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 leading-snug font-medium">{product.name}</p>
        {meta ? <p className="truncate text-sm text-muted">{meta}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
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
          {mode.kind !== 'substitute' && storeCount > 1 ? (
            <span>
              ב-{product.offers.size} מתוך {storeCount} סניפים
            </span>
          ) : null}
        </p>
      </div>
      {inList ? (
        <Stepper
          value={inList.qty}
          step={stepFor(product.weighted)}
          unit={qtyUnit(product.weighted)}
          onChange={(q) => setQty(inList.id, q)}
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
    </li>
  );
}
