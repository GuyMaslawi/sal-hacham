import { Check, ChevronDown, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, cx, EmptyState, FullScreen, toast , BackButton } from '../components/ui';
import { cityPoint, nearestCity, suggestStores, type Point, type Suggestion } from '../engine/nearby';
import { isNativeApp, nativeLocate } from '../lib/native';
import { chainLabel, storePlace } from '../lib/view';
import { MAX_STORES, useApp } from '../state/app';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import type { StoreInfo } from '../types';

type Origin =
  | { state: 'locating' }
  | { state: 'unavailable'; reason: string }
  | { state: 'ready'; point: Point; city: string };

/** Ask the device where it is. The answer stays here; it is only compared with city locations. */
function locate(): Promise<Point> {
  // Inside the iPhone app the system asks once, in the app's name, instead of twice.
  if (isNativeApp) return nativeLocate();
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  });
}

/**
 * The shortest way to a useful comparison: the leading chains around the shopper, already
 * ticked. One tap accepts them; every choice can still be changed.
 */
export function NearbyScreen({ city }: { city?: string }) {
  const close = useNav((s) => s.close);
  const open = useNav((s) => s.open);
  const index = useData((s) => s.index);
  const alreadyChosen = useApp((s) => s.storeIds);
  const [origin, setOrigin] = useState<Origin>({ state: 'locating' });
  // Per chain: the branch picked instead of the suggested one.
  const [swapped, setSwapped] = useState<Record<string, StoreInfo>>({});
  const [unticked, setUnticked] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!index) return;
    if (city) {
      const point = cityPoint(index, city);
      setOrigin(point ? { state: 'ready', point, city } : { state: 'unavailable', reason: 'אין לנו מיקום לעיר הזו.' });
      return;
    }
    let cancelled = false;
    locate()
      .then((point) => {
        if (cancelled) return;
        const near = nearestCity(index, point);
        // Far from every city we know (abroad, or location is off): do not guess.
        if (!near || near.distanceKm > 60) {
          setOrigin({ state: 'unavailable', reason: 'לא מצאנו סופרים באזור שהמכשיר דיווח עליו.' });
        } else {
          setOrigin({ state: 'ready', point, city: near.city });
        }
      })
      .catch(() => {
        if (!cancelled) setOrigin({ state: 'unavailable', reason: 'לא קיבלנו גישה למיקום.' });
      });
    return () => {
      cancelled = true;
    };
  }, [index, city]);

  const suggestions = useMemo<Suggestion[]>(
    () => (index && origin.state === 'ready' ? suggestStores(index, origin.point) : []),
    [index, origin],
  );

  const chosenStore = (s: Suggestion) => swapped[s.store.chainId] ?? s.store;
  const isTicked = (s: Suggestion) =>
    unticked ? !unticked.has(s.store.chainId) : s.preselected;
  const toggle = (s: Suggestion) =>
    // Built from the latest state, so two quick taps on different rows both count.
    setUnticked((prev) => {
      const next = new Set(prev ?? suggestions.filter((x) => !x.preselected).map((x) => x.store.chainId));
      if (next.has(s.store.chainId)) next.delete(s.store.chainId);
      else next.add(s.store.chainId);
      return next;
    });

  const picked = suggestions.filter(isTicked).map(chosenStore).filter((s) => !alreadyChosen.includes(s.id));
  const room = MAX_STORES - alreadyChosen.length;

  const start = () => {
    const data = useData.getState();
    // Downloads run side by side; the list is usable as soon as the first one lands.
    void Promise.all(picked.map((s) => data.addStore(s.id))).then((results) => {
      if (results.some((ok) => !ok)) toast('חלק מהסניפים לא ירדו. אפשר לרענן בלשונית "סניפים"');
    });
    useNav.getState().go('list');
  };

  const chooseManually = () => open({ kind: 'stores' });

  return (
    <FullScreen onClose={close} label="סופרים באזור שלך">
      <div className="border-b-[1.5px] border-line bg-surface px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-1">
          <BackButton onClick={close} />
          <h2 className="flex-1 truncate text-lg font-bold">
            {origin.state === 'ready' ? `הסופרים באזור ${origin.city}` : 'סופרים באזור שלך'}
          </h2>
        </div>
        {origin.state === 'ready' && suggestions.length > 0 ? (
          <p className="px-2 pt-1 text-sm text-muted">
            סימנו סניף אחד מכל רשת מובילה באזור. אפשר להוריד סימון, להוסיף, או להחליף לסניף שאתה קונה בו.
          </p>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain pb-40">
        {!index || origin.state === 'locating' ? (
          <div className="flex flex-col items-center gap-3 px-6 pt-16 text-center text-muted">
            <LoaderCircle className="size-8 animate-spin text-ink" />
            <p className="text-lg font-semibold text-ink">מחפשים סופרים באזור שלך</p>
            <p>אם הטלפון שואל אם לאשר גישה למיקום, לחץ "אישור". המיקום נשאר אצלך ולא נשלח לאף אחד.</p>
          </div>
        ) : origin.state === 'unavailable' || suggestions.length === 0 ? (
          <EmptyState
            title="נבחר עיר במקום"
            action={<Button onClick={() => open({ kind: 'stores', quick: true })}>בחר עיר</Button>}
          >
            {origin.state === 'unavailable' ? origin.reason : 'לא מצאנו רשתות מובילות באזור הזה.'} בחר את העיר שלך,
            ונציע לך את הסופרים המובילים בה.
          </EmptyState>
        ) : (
          <ul className="perforated bg-surface">
            {suggestions.map((s) => {
              const store = chosenStore(s);
              const ticked = isTicked(s);
              const already = alreadyChosen.includes(store.id);
              const options = [s.store, ...s.alternatives];
              const open_ = expanded === s.store.chainId;
              return (
                <li key={s.store.chainId}>
                  <div className="flex items-stretch">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={ticked || already}
                      disabled={already}
                      onClick={() => toggle(s)}
                      className="flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 py-3 ps-5 pe-2 text-start active:bg-sunken"
                    >
                      <span
                        className={cx(
                          'flex size-8 shrink-0 items-center justify-center rounded-full border-2',
                          ticked || already ? 'border-ink bg-ink text-surface' : 'border-line',
                        )}
                      >
                        {ticked || already ? <Check className="size-4" strokeWidth={3.5} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[1.05rem] leading-tight font-bold">{chainLabel(store, index)}</span>
                        <span className="block truncate text-sm">{store.name}</span>
                        <span className="block truncate text-sm text-muted">
                          {already ? 'כבר ברשימת הסניפים שלך' : storePlace(store)}
                        </span>
                      </span>
                    </button>
                    {options.length > 1 ? (
                      <button
                        type="button"
                        aria-expanded={open_}
                        onClick={() => setExpanded(open_ ? null : s.store.chainId)}
                        className="flex shrink-0 items-center gap-0.5 px-4 text-sm font-semibold text-muted active:bg-sunken"
                      >
                        סניף אחר
                        <ChevronDown className={cx('size-4 transition-transform', open_ && 'rotate-180')} />
                      </button>
                    ) : null}
                  </div>
                  {open_ ? (
                    <ul className="mx-4 mb-3 rounded-xl bg-sunken px-1 py-1">
                      {options.map((o) => (
                        <li key={o.id}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={o.id === store.id}
                            onClick={() => {
                              setSwapped((prev) => ({ ...prev, [s.store.chainId]: o }));
                              setExpanded(null);
                              if (!ticked) toggle(s);
                            }}
                            className={cx(
                              'flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-start text-sm',
                              o.id === store.id && 'bg-surface font-semibold',
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate">{o.name}</span>
                              <span className="block truncate font-normal text-muted">{storePlace(o)}</span>
                            </span>
                            {o.id === store.id ? <Check className="size-4 shrink-0" strokeWidth={3} /> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {origin.state === 'ready' && suggestions.length > 0 ? (
        <div className="absolute inset-x-0 bottom-0 border-t-[1.5px] border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {picked.length > room ? (
            <p className="pb-2 text-center text-sm text-alert">
              {room > 0
                ? `יש מקום לעוד ${room === 1 ? 'סניף אחד' : `${room} סניפים`} (עד ${MAX_STORES} בסך הכול). הורד סימון כדי לבחור אילו.`
                : `כבר בחרת ${MAX_STORES} סניפים. הסר סניף בלשונית "סניפים" כדי להוסיף אחר.`}
            </p>
          ) : null}
          <Button variant="tag" className="w-full" disabled={picked.length === 0 || picked.length > room} onClick={start}>
            {picked.length === 0
              ? 'סמן לפחות סניף אחד'
              : `${alreadyChosen.length > 0 ? 'הוסף' : 'המשך עם'} ${picked.length === 1 ? 'סניף אחד' : `${picked.length} סניפים`}`}
          </Button>
          <Button variant="quiet" className="mt-1 min-h-10 w-full text-[0.95rem]" onClick={chooseManually}>
            לבחור סניפים בעצמי
          </Button>
        </div>
      ) : null}
    </FullScreen>
  );
}
