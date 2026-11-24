import { ListChecks, LoaderCircle, MapPin, Scale, ShoppingCart, Store } from 'lucide-react';
import { useEffect } from 'react';
import { Button, cx, Toaster } from './components/ui';
import type { TextSize } from './types';
import { CompareScreen } from './screens/CompareScreen';
import { FinishSheet } from './screens/FinishSheet';
import { HelpSheet } from './screens/HelpSheet';
import { ItemSheet } from './screens/ItemSheet';
import { ListScreen } from './screens/ListScreen';
import { NearbyScreen } from './screens/NearbyScreen';
import { AddListSheet } from './screens/AddListSheet';
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
  const textSize = useApp((s) => s.settings.textSize);
  const tab = useNav((s) => s.tab);
  const overlay = useNav((s) => s.stack[s.stack.length - 1]);

  // Text size applies to the whole page (everything is sized relative to it).
  useEffect(() => {
    if (textSize === 'normal') delete document.documentElement.dataset.text;
    else document.documentElement.dataset.text = textSize;
  }, [textSize]);

  // Load the saved data. Keyed on `ready` so a store that was re-created (hot reload) loads too.
  useEffect(() => {
    if (!ready) void useData.getState().init();
  }, [ready]);

  useEffect(() => {
    // Coming back to the app after a while (the next shopping trip), or back online after the
    // first start failed: look for the store list and newer prices.
    const maybeRefresh = () => {
      const missingIndex = !useData.getState().index;
      if (document.visibilityState !== 'visible') return;
      if (missingIndex || Date.now() - lastRefresh > 60 * 60 * 1000) {
        lastRefresh = Date.now();
        void useData.getState().refresh();
      }
    };
    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('online', maybeRefresh);
    return () => {
      document.removeEventListener('visibilitychange', maybeRefresh);
      window.removeEventListener('online', maybeRefresh);
    };
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
        <div className="frame min-h-dvh pb-[calc(4.75rem+env(safe-area-inset-bottom))]">
          <DownloadStatus />
          {/* A short fade marks that the screen changed, without moving anything around. */}
          <main key={tab} className="animate-fade">
            {tab === 'list' ? <ListScreen /> : null}
            {tab === 'compare' ? <CompareScreen /> : null}
            {tab === 'shop' ? <ShopScreen /> : null}
            {tab === 'stores' ? <StoresScreen /> : null}
          </main>
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
    case 'addList':
      return <AddListSheet start={overlay.start} photo={overlay.photo} clipboard={overlay.clipboard} />;
    case 'scan':
      return <Scanner />;
    case 'item':
      return <ItemSheet itemId={overlay.itemId} />;
    case 'stores':
      return <StorePicker quick={overlay.quick} />;
    case 'nearby':
      return <NearbyScreen key={overlay.city ?? 'here'} city={overlay.city} />;
    case 'help':
      return <HelpSheet />;
    case 'finish':
      return <FinishSheet />;
  }
}

function DownloadStatus() {
  const loading = useData((s) => s.loading);
  const problem = useData((s) => s.problem);
  const states = Object.values(loading);
  const failed = states.filter((s) => s === 'error').length;
  const busy = states.filter((s) => s === 'loading').length;
  if (problem && !busy) {
    return (
      <div role="alert" className="bg-alert px-4 py-2.5 text-center text-[0.95rem] font-semibold text-on-alert">
        {problem}
      </div>
    );
  }
  if (!failed && !busy) return null;
  return (
    <div
      role="status"
      className={cx(
        'flex flex-wrap items-center justify-center gap-x-2 px-4 py-2.5 text-center text-[0.95rem] font-semibold',
        busy ? 'bg-tag text-tag-ink' : 'bg-alert text-on-alert',
      )}
    >
      {busy ? (
        <>
          <LoaderCircle className="size-4 animate-spin" />
          רגע, מורידים את המחירים של הסניפים שלך
        </>
      ) : (
        <>
          לא הצלחנו להוריד מחירים ל{failed === 1 ? 'סניף אחד' : `-${failed} סניפים`}. בדוק את האינטרנט.
          <button
            type="button"
            className="min-h-11 px-2 underline underline-offset-4"
            onClick={() => void useData.getState().refresh()}
          >
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
                'flex h-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 text-[0.9rem]',
                active ? 'font-bold text-ink' : 'font-medium text-muted',
              )}
            >
              <span className={cx('relative flex h-8 w-14 items-center justify-center rounded-full', active && 'bg-tag text-tag-ink')}>
                <Icon className="size-[1.4rem]" strokeWidth={active ? 2.4 : 2} />
                {id === 'list' && pending > 0 && !active ? (
                  <span className="num absolute -top-1 end-0.5 min-w-[1.4rem] rounded-full bg-ink px-1 text-center text-[0.8rem] leading-[1.4rem] font-bold text-surface">
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

const NEXT_SIZE: Record<TextSize, TextSize> = { normal: 'large', large: 'xl', xl: 'normal' };

/** One tap on the first screen makes everything bigger; the full choice is under "stores". */
function TextSizeToggle() {
  const textSize = useApp((s) => s.settings.textSize);
  const setSettings = useApp((s) => s.setSettings);
  return (
    <button
      type="button"
      onClick={() => setSettings({ textSize: NEXT_SIZE[textSize] })}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 border-tag-ink px-3.5 font-bold"
    >
      <span aria-hidden className="text-sm">א</span>
      <span aria-hidden className="text-xl leading-none">א</span>
      {textSize === 'xl' ? 'טקסט רגיל' : 'הגדל טקסט'}
    </button>
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
      <div className="rounded-b-[2.5rem] bg-tag px-6 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8 text-tag-ink">
        <div className="flex items-center justify-between gap-3">
          <p className="text-lg font-bold">סל חכם</p>
          <TextSizeToggle />
        </div>
        <h1 className="mt-6 font-display text-[4.75rem] leading-[0.82] font-bold">
          אותו סל.
          <br />
          סופר אחר.
          <br />
          מחיר אחר.
        </h1>
      </div>
      <div className="flex flex-1 flex-col px-6 pt-7 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <ol className="space-y-3.5">
          {[
            ['בוחרים סניפים', 'אנחנו מציעים את הרשתות המובילות באזור שלך.'],
            ['בונים רשימה', 'אומרים אותה בקול, מצלמים, מדביקים מוואטסאפ או מקלידים.'],
            ['רואים איפה הכי זול', 'מחיר הסל כולו בכל סניף, לפי המחירים של היום.'],
          ].map(([title, text], i) => (
            <li key={title} className="flex items-start gap-3">
              <span className="num flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-lg leading-none font-bold text-surface">
                {i + 1}
              </span>
              <span>
                <span className="block text-lg leading-tight font-bold">{title}</span>
                <span className="block text-muted">{text}</span>
              </span>
            </li>
          ))}
        </ol>
        {index ? (
          <p className="mt-5 text-sm text-muted">
            <span className="num font-semibold text-ink">{index.stores.length.toLocaleString('en-US')}</span> סניפים של{' '}
            <span className="num font-semibold text-ink">{index.chains.length}</span> רשתות ב-
            <span className="num font-semibold text-ink">{cities}</span> ערים. חינם, בלי הרשמה, והרשימה נשארת אצלך בטלפון.
          </p>
        ) : indexError ? (
          <div className="mt-4">
            <p className="text-alert">
              כדי להתחיל צריך חיבור לאינטרנט, פעם אחת. אחר כך האפליקציה עובדת גם בלי קליטה.
            </p>
            <Button variant="outline" className="mt-2" onClick={() => void useData.getState().refresh()}>
              נסה שוב
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-muted">טוען את רשימת הסניפים.</p>
        )}
        <div className="mt-auto pt-6">
          <Button className="w-full" disabled={!index} onClick={() => open({ kind: 'nearby' })}>
            <MapPin className="size-5" />
            מצא סופרים לידי
          </Button>
          <p className="mt-1.5 text-center text-sm text-muted">
            הטלפון ישאל אם לאשר גישה למיקום. המיקום נשאר אצלך ולא נשלח לאף אחד.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="outline" className="flex-1" disabled={!index} onClick={() => open({ kind: 'stores', quick: true })}>
              בחר עיר
            </Button>
            <Button variant="quiet" className="flex-1" onClick={() => open({ kind: 'help' })}>
              איך זה עובד?
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
