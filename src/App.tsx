import { ListChecks, LoaderCircle, Scale, ShoppingCart, Store } from 'lucide-react';
import { useEffect } from 'react';
import { Button, cx, Toaster } from './components/ui';
import { CompareScreen } from './screens/CompareScreen';
import { ItemSheet } from './screens/ItemSheet';
import { ListScreen } from './screens/ListScreen';
import { PasteSheet } from './screens/PasteSheet';
import { Scanner } from './screens/Scanner';
import { SearchScreen } from './screens/SearchScreen';
import { ShopScreen } from './screens/ShopScreen';
import { StorePicker, StoresScreen } from './screens/StoresScreen';
import { useApp } from './state/app';
import { useData } from './state/data';
import { useNav, type Overlay, type Tab } from './state/nav';

let lastRefresh = Date.now();

export default function App() {
  const ready = useData((s) => s.ready);
  const hasStores = useApp((s) => s.storeIds.length > 0);
  const tab = useNav((s) => s.tab);
  const overlay = useNav((s) => s.stack[s.stack.length - 1]);

  // Load the saved data. Keyed on `ready` so a store that was re-created (hot reload) loads too.
  useEffect(() => {
    if (!ready) void useData.getState().init();
  }, [ready]);

  useEffect(() => {
    // Coming back to the app after a while (the next shopping trip): look for newer prices.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 60 * 60 * 1000) {
        lastRefresh = Date.now();
        void useData.getState().refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-tag text-tag-ink">
        <p className="font-display text-6xl font-bold">סל חכם</p>
      </div>
    );
  }

  return (
    <>
      {hasStores ? (
        <div className="frame min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
          <DownloadStatus />
          {tab === 'list' ? <ListScreen /> : null}
          {tab === 'compare' ? <CompareScreen /> : null}
          {tab === 'shop' ? <ShopScreen /> : null}
          {tab === 'stores' ? <StoresScreen /> : null}
          <TabBar />
        </div>
      ) : (
        <Welcome />
      )}
      {overlay ? <OverlayView overlay={overlay} /> : null}
      <Toaster />
    </>
  );
}

function OverlayView({ overlay }: { overlay: Overlay }) {
  switch (overlay.kind) {
    case 'search':
      // A new key per target keeps the query from leaking between different lines.
      return <SearchScreen key={JSON.stringify(overlay.mode)} mode={overlay.mode} />;
    case 'paste':
      return <PasteSheet />;
    case 'scan':
      return <Scanner />;
    case 'item':
      return <ItemSheet itemId={overlay.itemId} />;
    case 'stores':
      return <StorePicker />;
  }
}

function DownloadStatus() {
  const loading = useData((s) => s.loading);
  const states = Object.values(loading);
  const failed = states.filter((s) => s === 'error').length;
  const busy = states.filter((s) => s === 'loading').length;
  if (!failed && !busy) return null;
  return (
    <div
      role="status"
      className={cx(
        'flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold',
        busy ? 'bg-tag text-tag-ink' : 'bg-alert text-white',
      )}
    >
      {busy ? (
        <>
          <LoaderCircle className="size-4 animate-spin" />
          מוריד מחירים עדכניים
        </>
      ) : (
        <>
          חסרים מחירים ל-{failed === 1 ? 'סניף אחד' : `${failed} סניפים`}.
          <button type="button" className="underline underline-offset-4" onClick={() => void useData.getState().refresh()}>
            נסה שוב
          </button>
        </>
      )}
    </div>
  );
}

const TABS: Array<{ id: Tab; label: string; icon: typeof Store }> = [
  { id: 'list', label: 'רשימה', icon: ListChecks },
  { id: 'compare', label: 'השוואה', icon: Scale },
  { id: 'shop', label: 'בסופר', icon: ShoppingCart },
  { id: 'stores', label: 'סניפים', icon: Store },
];

function TabBar() {
  const tab = useNav((s) => s.tab);
  const go = useNav((s) => s.go);
  const pending = useApp((s) => s.items.filter((i) => !i.checked).length);
  return (
    <nav
      aria-label="ניווט ראשי"
      className="fixed inset-x-0 bottom-0 z-30 border-t-[1.5px] border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="frame flex">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = id === tab;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => go(id)}
              className={cx(
                'flex h-[4.25rem] flex-1 flex-col items-center justify-center gap-0.5 text-[0.8rem]',
                active ? 'font-bold text-ink' : 'font-medium text-muted',
              )}
            >
              <span className={cx('relative flex h-8 w-14 items-center justify-center rounded-full', active && 'bg-tag text-tag-ink')}>
                <Icon className="size-[1.4rem]" strokeWidth={active ? 2.4 : 2} />
                {id === 'list' && pending > 0 && !active ? (
                  <span className="num absolute -top-0.5 end-1 min-w-5 rounded-full bg-ink px-1 text-center text-[0.7rem] leading-5 font-bold text-surface">
                    {pending}
                  </span>
                ) : null}
              </span>
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** First run: nothing to compare until the shopper says where they shop. */
function Welcome() {
  const index = useData((s) => s.index);
  const indexError = useData((s) => s.indexError);
  const open = useNav((s) => s.open);
  const cities = index ? new Set(index.stores.map((s) => s.city)).size : 0;

  return (
    <div className="frame flex min-h-dvh flex-col bg-paper">
      <div className="rounded-b-[2.5rem] bg-tag px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-10 text-tag-ink">
        <p className="text-lg font-bold">סל חכם</p>
        <h1 className="mt-10 font-display text-[5.25rem] leading-[0.82] font-bold">
          אותו סל.
          <br />
          סופר אחר.
          <br />
          מחיר אחר.
        </h1>
      </div>
      <div className="flex flex-1 flex-col px-6 pt-7 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <p className="text-lg leading-relaxed">
          בחר את הסניפים שאתה באמת קונה בהם, בנה רשימה, ותראה כמה היא עולה בכל אחד מהם לפי המחירים שהרשתות פרסמו היום.
        </p>
        {index ? (
          <p className="mt-4 text-muted">
            <span className="num font-semibold text-ink">{index.stores.length.toLocaleString('he-IL')}</span> סניפים ב-
            <span className="num font-semibold text-ink">{cities}</span> ערים, מתעדכן כל יום. בלי הרשמה.
          </p>
        ) : indexError ? (
          <p className="mt-4 text-alert">לא הצלחנו להוריד את רשימת הסניפים. בדוק את החיבור לאינטרנט ופתח שוב.</p>
        ) : (
          <p className="mt-4 text-muted">טוען את רשימת הסניפים.</p>
        )}
        <Button className="mt-auto w-full" disabled={!index} onClick={() => open({ kind: 'stores' })}>
          בחר סניפים
        </Button>
      </div>
    </div>
  );
}
