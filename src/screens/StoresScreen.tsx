import { Check, CircleHelp, LoaderCircle, MapPin, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { InstallHint } from '../components/InstallHint';
import { TextSizeChoice } from '../components/TextSizeChoice';
import { BackButton, Button, cx, EmptyState, FullScreen, IconButton, ScreenHeader, Stepper, toast, Toggle } from '../components/ui';
import { normalize } from '../lib/text';
import { chainLabel, freshness, storePlace, storeTitle, useChosenStores } from '../lib/view';
import { MAX_STORES, useApp } from '../state/app';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import type { StoreInfo } from '../types';

/** Chosen stores, data freshness and the few preferences that change the comparison. */
export function StoresScreen() {
  const stores = useChosenStores();
  const index = useData((s) => s.index);
  const loading = useData((s) => s.loading);
  const refreshing = useData((s) => s.refreshing);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const open = useNav((s) => s.open);

  const refresh = async () => {
    const r = await useData.getState().refresh();
    toast(
      r.offline
        ? 'אין חיבור כרגע. ממשיכים עם המחירים השמורים'
        : r.failed
          ? 'חלק מהסניפים לא התעדכנו. נסה שוב'
          : r.updated
            ? 'המחירים עודכנו'
            : 'המחירים כבר מעודכנים',
    );
  };

  return (
    <div className="pb-6">
      <ScreenHeader title="הסניפים שלי">הסופרים שאנחנו משווים ביניהם, והגדרות.</ScreenHeader>

      <ul className="perforated mx-4 rounded-2xl bg-surface">
        {stores.map((s) => {
          const state = loading[s.id];
          const age = freshness(s.updatedAt);
          return (
            <li key={s.id} className="flex items-center gap-2 py-3 ps-4 pe-2">
              <div className="min-w-0 flex-1">
                <p className="leading-snug font-bold">{storeTitle(s, index)}</p>
                <p className="truncate text-sm text-muted">{storePlace(s)}</p>
                <p
                  className={cx(
                    'mt-0.5 flex flex-wrap gap-x-3 text-sm',
                    state === 'error' || age.stale ? 'text-alert' : 'text-muted',
                  )}
                >
                  {state === 'loading' ? (
                    <span className="inline-flex items-center gap-1.5">
                      <LoaderCircle className="size-4 animate-spin" /> מוריד מחירים
                    </span>
                  ) : state === 'error' ? (
                    'ההורדה נכשלה. בדוק את החיבור ורענן'
                  ) : (
                    <>
                      <span>{age.text}</span>
                      <span className="text-muted">
                        <span className="num">{s.itemCount.toLocaleString('en-US')}</span> מוצרים
                      </span>
                    </>
                  )}
                </p>
              </div>
              <IconButton label={`הסר את ${storeTitle(s, index)}`} onClick={() => useData.getState().removeStore(s.id)}>
                <Trash2 className="size-5 text-muted" />
              </IconButton>
            </li>
          );
        })}
      </ul>

      <div className="mx-4 mt-3 flex gap-2">
        <Button className="flex-1" onClick={() => open({ kind: 'stores' })} disabled={stores.length >= MAX_STORES}>
          <Plus className="size-5" />
          הוסף סניף
        </Button>
        <Button variant="outline" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={cx('size-5', refreshing && 'animate-spin')} />
          רענן מחירים
        </Button>
      </div>
      {stores.length >= MAX_STORES ? (
        <p className="mx-6 mt-2 text-sm text-muted">אפשר להשוות עד {MAX_STORES} סניפים. הסר אחד כדי להוסיף אחר.</p>
      ) : (
        <Button variant="quiet" className="mx-4 mt-1 w-[calc(100%-2rem)]" onClick={() => open({ kind: 'nearby' })}>
          <MapPin className="size-5" />
          הצע לי סופרים באזור שלי
        </Button>
      )}

      <section className="mx-4 mt-6 rounded-2xl bg-surface">
        <div className="perforated">
          <div className="p-4">
            <p className="font-semibold">גודל הטקסט</p>
            <TextSizeChoice />
          </div>
          <div className="flex items-center gap-4 p-4">
            <div className="flex-1">
              <p className="font-semibold">לכלול מחירי מועדון</p>
              <p className="text-sm text-muted">מבצעים שמגיעים רק לחברי מועדון או לבעלי כרטיס האשראי של הרשת.</p>
            </div>
            <Toggle
              label="לכלול מחירי מועדון"
              checked={settings.includeClub}
              onChange={(includeClub) => setSettings({ includeClub })}
            />
          </div>
          <div className="flex items-center gap-4 p-4">
            <div className="flex-1">
              <p className="font-semibold">מתי שווה לפצל קנייה</p>
              <p className="text-sm text-muted">נציע לקנות בשני סניפים רק כשזה חוסך לפחות את הסכום הזה.</p>
            </div>
            <Stepper
              value={settings.splitThreshold}
              step={10}
              unit="₪"
              onChange={(v) => setSettings({ splitThreshold: Math.min(200, Math.max(0, v)) })}
            />
          </div>
        </div>
      </section>

      <InstallHint always />

      <Button variant="outline" className="mx-4 mt-4 w-[calc(100%-2rem)]" onClick={() => open({ kind: 'help' })}>
        <CircleHelp className="size-5" />
        איך זה עובד ואיך לקרוא את המחירים
      </Button>

      <p className="mx-6 mt-5 text-sm leading-relaxed text-muted">
        המחירים והמבצעים נלקחים מהקבצים שהרשתות מחויבות לפרסם לפי חוק שקיפות המחירים, ומתעדכנים פעם ביום. ייתכנו
        הבדלים מהמחיר על המדף; המחיר בקופה הוא הקובע. הרשימה והסניפים נשמרים רק במכשיר הזה.
      </p>
    </div>
  );
}

const NO_CITY = 'אחר';

/** Pick stores: choose a city, then tap the branches you actually shop at. */
export function StorePicker({ quick = false }: { quick?: boolean }) {
  const close = useNav((s) => s.close);
  const open = useNav((s) => s.open);
  const index = useData((s) => s.index);
  const indexError = useData((s) => s.indexError);
  const chosen = useApp((s) => s.storeIds);
  const [city, setCity] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Every store with the text it can be found by.
  const searchable = useMemo(
    () =>
      (index?.stores ?? []).map((store) => ({
        store,
        norm: normalize(`${storeTitle(store, index)} ${store.sub} ${store.address} ${store.city}`),
      })),
    [index],
  );

  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of index?.stores ?? []) counts.set(s.city, (counts.get(s.city) ?? 0) + 1);
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, norm: normalize(name) }))
      .sort(
        (a, b) =>
          Number(a.name === NO_CITY) - Number(b.name === NO_CITY) || b.count - a.count || a.name.localeCompare(b.name, 'he'),
      );
  }, [index]);

  const q = normalize(query);
  const words = q.split(' ').filter(Boolean);
  const matches = (norm: string) => words.every((w) => norm.includes(w));

  const cityMatches = q ? cities.filter((c) => c.name !== NO_CITY && matches(c.norm)) : cities;
  // Typing a chain or branch name on the first step finds stores directly, in any city.
  const storeMatches = useMemo(
    () => (q && !city ? searchable.filter((s) => matches(s.norm)).slice(0, 40).map((s) => s.store) : []),
    [q, city, searchable],
  );

  const storesInCity = useMemo(() => {
    if (!city) return [];
    const list = searchable.filter((s) => s.store.city === city && (!q || matches(s.norm))).map((s) => s.store);
    const groups = new Map<string, StoreInfo[]>();
    for (const s of list) {
      const key = chainLabel(s, index);
      const g = groups.get(key);
      if (g) g.push(s);
      else groups.set(key, [s]);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [city, index, q, searchable]);

  const back = () => {
    if (!city) return close();
    setCity(null);
    setQuery('');
  };

  return (
    <FullScreen onClose={close} label="בחירת סניפים">
      <div className="border-b-[1.5px] border-line bg-surface px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-1">
          <BackButton onClick={back} label={city ? 'כל הערים' : 'חזרה'} />
          <h2 className="flex-1 truncate text-lg font-bold">
            {city === NO_CITY ? 'סניפים בלי עיר רשומה' : (city ?? 'איפה אתה קונה?')}
          </h2>
        </div>
        <div className="relative mt-2 px-1">
          <Search className="pointer-events-none absolute start-4 top-3.5 size-5 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={city ? 'סינון לפי שם סניף או רחוב' : 'עיר, רשת או שם סניף'}
            aria-label={city ? 'סינון סניפים' : 'חיפוש עיר או סניף'}
            className="h-12 w-full rounded-xl bg-sunken ps-11 pe-11 text-[1.05rem] outline-none focus:ring-2 focus:ring-ink"
          />
          {query ? (
            <IconButton label="נקה" onClick={() => setQuery('')} className="absolute end-1.5 top-0.5">
              <X className="size-5 text-muted" />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-28">
        {!index ? (
          <EmptyState
            title={indexError ? 'אין חיבור לאינטרנט' : 'טוען סניפים'}
            action={
              indexError ? (
                <Button onClick={() => void useData.getState().refresh()}>נסה שוב</Button>
              ) : undefined
            }
          >
            {indexError
              ? 'כדי לבחור סניפים בפעם הראשונה צריך חיבור לאינטרנט. התחבר לרשת ולחץ "נסה שוב".'
              : 'רגע, מביאים את רשימת הסניפים המעודכנת.'}
          </EmptyState>
        ) : !city ? (
          cityMatches.length + storeMatches.length > 0 ? (
            <>
              {!q && chosen.length === 0 ? (
                <p className="px-5 py-3 text-sm text-muted">
                  {quick
                    ? 'בחר את העיר שלך, ונציע לך את הסופרים המובילים בה ובסביבתה. אפשר גם לחפש רשת או סניף בשם.'
                    : 'בחר עיר, ואז שניים עד ארבעה סניפים שנוח לך להגיע אליהם. אפשר גם לחפש רשת או סניף בשם, ולשנות את הבחירה בכל רגע.'}
                </p>
              ) : null}
              {cityMatches.length > 0 ? (
                <ul className="perforated bg-surface">
                  {cityMatches.map((c) => (
                    <li key={c.name}>
                      <button
                        type="button"
                        className="flex min-h-14 w-full items-center justify-between gap-3 px-5 text-start active:bg-sunken"
                        onClick={() => {
                          // First run: go straight to the leading chains around this city.
                          if (quick && c.name !== NO_CITY && index.geo[c.name]) {
                            open({ kind: 'nearby', city: c.name });
                            return;
                          }
                          setCity(c.name);
                          setQuery('');
                        }}
                      >
                        <span className="text-[1.05rem] font-medium">
                          {c.name === NO_CITY ? 'סניפים בלי עיר רשומה' : c.name}
                        </span>
                        <span className="text-sm text-muted">{c.count === 1 ? 'סניף אחד' : `${c.count} סניפים`}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {storeMatches.length > 0 ? (
                <section>
                  <h3 className="px-5 pt-4 pb-1.5 text-sm font-bold text-muted">סניפים</h3>
                  <ul className="perforated bg-surface">
                    {storeMatches.map((s) => (
                      <StoreOption key={s.id} store={s} title={storeTitle(s, index)} place={storePlace(s)} />
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : (
            <p className="px-6 pt-10 text-center text-muted">
              לא מצאנו עיר או סניף בשם "{query.trim()}". נסה עיר סמוכה שאתה קונה בה.
            </p>
          )
        ) : storesInCity.length > 0 ? (
          storesInCity.map(([chain, list]) => (
            <section key={chain}>
              <h3 className="px-5 pt-4 pb-1.5 text-sm font-bold text-muted">{chain}</h3>
              <ul className="perforated bg-surface">
                {list.map((s) => (
                  <StoreOption key={s.id} store={s} title={s.name} place={s.address || s.city} />
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="px-6 pt-10 text-center text-muted">אין סניף שמתאים ל"{query.trim()}" בעיר הזו.</p>
        )}
      </div>

      {chosen.length > 0 || city ? (
        <div className="absolute inset-x-0 bottom-0 border-t-[1.5px] border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {chosen.length === 0 ? (
            <p className="pb-2 text-center text-sm text-muted">לחץ על סניף כדי לסמן אותו.</p>
          ) : null}
          <Button
            variant="tag"
            className="w-full"
            disabled={chosen.length === 0}
            onClick={() => {
              // Opened from the suggestions screen: continue to the list, not back to it.
              if (useNav.getState().stack.some((o) => o.kind === 'nearby')) useNav.getState().go('list');
              else close();
            }}
          >
            {chosen.length === 0 ? 'עוד לא נבחר סניף' : chosen.length === 1 ? 'המשך עם סניף אחד' : `המשך עם ${chosen.length} סניפים`}
          </Button>
        </div>
      ) : null}
    </FullScreen>
  );
}

function StoreOption({ store, title, place }: { store: StoreInfo; title: string; place: string }) {
  const selected = useApp((s) => s.storeIds.includes(store.id));
  const busy = useData((s) => s.loading[store.id] === 'loading');

  const toggle = async () => {
    const data = useData.getState();
    if (selected) return data.removeStore(store.id);
    if (useApp.getState().storeIds.length >= MAX_STORES) return toast(`אפשר לבחור עד ${MAX_STORES} סניפים`);
    const ok = await data.addStore(store.id);
    if (!ok) toast('הורדת המחירים נכשלה. בדוק את החיבור ונסה שוב');
  };

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={toggle}
        className="flex min-h-16 w-full items-center gap-3 px-5 py-2.5 text-start active:bg-sunken"
      >
        <span className="min-w-0 flex-1">
          <span className="block leading-snug font-medium">{title}</span>
          <span className="block truncate text-sm text-muted">{place}</span>
        </span>
        <span
          className={cx(
            'flex size-8 shrink-0 items-center justify-center rounded-full border-2',
            selected ? 'border-ink bg-ink text-surface' : 'border-line',
          )}
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : selected ? (
            <Check className="size-4" strokeWidth={3.5} />
          ) : null}
        </span>
      </button>
    </li>
  );
}
