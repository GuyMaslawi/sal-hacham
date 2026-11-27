import { Check, ChevronDown, ChevronLeft, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackButton, Button, cx, EmptyState, FullScreen, toast } from '../components/ui';
import {
  autoRadiusKm,
  cityPoint,
  nearestCity,
  storesInArea,
  suggestStores,
  type Point,
  type SuggestOptions,
  type Suggestion,
} from '../engine/nearby';
import { citiesIn, cityRegions, REGIONS, regionCenter, type RegionId } from '../engine/regions';
import { isNativeApp, nativeLocate } from '../lib/native';
import { chainLabel, storePlace } from '../lib/view';
import { MAX_STORES, useApp } from '../state/app';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import type { StoreInfo } from '../types';

type Origin =
  | { state: 'idle' }
  | { state: 'locating' }
  | { state: 'unavailable'; reason: string }
  | { state: 'ready'; point: Point; city: string; device: boolean };

type Mode = 'distance' | 'region';

const MIN_KM = 1;
const MAX_KM = 60;

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
 * The shortest way to a useful comparison: the leading chains in an area, already ticked. The
 * area is a distance around the shopper (or a chosen city) or one of the regions of the country.
 * One tap accepts the suggestion; every choice can still be changed.
 */
export function NearbyScreen({ city, byRegion = false }: { city?: string; byRegion?: boolean }) {
  const close = useNav((s) => s.close);
  const open = useNav((s) => s.open);
  const index = useData((s) => s.index);
  const alreadyChosen = useApp((s) => s.storeIds);
  const [mode, setMode] = useState<Mode>(byRegion ? 'region' : 'distance');
  const [origin, setOrigin] = useState<Origin>({ state: 'idle' });
  // The distance the shopper set; until then, the smallest one that offers a real choice.
  const [radius, setRadius] = useState<number | null>(null);
  const [region, setRegion] = useState<RegionId | null>(null);
  // Per chain: ticked or not, where the shopper said so. The rest follow the suggestion.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  // Per chain: the branch picked instead of the suggested one.
  const [swapped, setSwapped] = useState<Record<string, StoreInfo>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const asked = useRef(false);
  const chips = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!index) return;
    if (city) {
      const point = cityPoint(index, city);
      setOrigin(
        point
          ? { state: 'ready', point, city, device: false }
          : { state: 'unavailable', reason: 'אין לנו מיקום לעיר הזו.' },
      );
      return;
    }
    // Only ask for the location when it is needed: choosing a region does without it.
    if (mode !== 'distance' || asked.current) return;
    asked.current = true;
    setOrigin({ state: 'locating' });
    locate()
      .then((point) => {
        const near = nearestCity(index, point);
        // Far from every city we know (abroad, or location is off): do not guess.
        if (!near || near.distanceKm > 60) {
          setOrigin({
            state: 'unavailable',
            reason: 'לא מצאנו סופרים באזור שהמכשיר דיווח עליו.',
          });
        } else {
          setOrigin({ state: 'ready', point, city: near.city, device: true });
          // The region the shopper is in, ready for when they switch to choosing by region.
          setRegion((r) => r ?? cityRegions(index).get(near.city)?.[0] ?? null);
        }
      })
      .catch(() => setOrigin({ state: 'unavailable', reason: 'לא קיבלנו גישה למיקום.' }));
  }, [index, city, mode]);

  // A city chosen by name starts the region choice at that city's region.
  useEffect(() => {
    if (index && city) setRegion((r) => r ?? cityRegions(index).get(city)?.[0] ?? null);
  }, [index, city]);

  // A new area starts at the top of its list, with its chip in view even at the far end of the row.
  useEffect(() => {
    list.current?.scrollTo({ top: 0 });
    chips.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [region, mode]);

  const point = origin.state === 'ready' ? origin.point : null;
  const autoRadius = useMemo(() => (index && point ? autoRadiusKm(index, point) : null), [index, point]);
  const radiusKm = radius ?? autoRadius;
  const room = MAX_STORES - alreadyChosen.length;

  // Where to look, and from which point to rank branches of the same chain.
  const area = useMemo((): { from: Point; opts: SuggestOptions } | null => {
    if (!index) return null;
    if (mode === 'region') {
      if (!region) return null;
      const cities = citiesIn(index, region);
      // The nearest branches to the shopper when they are in the region; otherwise its middle.
      const from = point && origin.state === 'ready' && cities.has(origin.city) ? point : regionCenter(index, cities);
      return from ? { from, opts: { cities, stepKm: 10 } } : null;
    }
    if (!point || radiusKm === null) return null;
    return { from: point, opts: { radiusKm } };
  }, [index, mode, region, point, origin, radiusKm]);

  const suggestions = useMemo<Suggestion[]>(
    () =>
      index && area
        ? suggestStores(index, area.from, {
            ...area.opts,
            max: 40,
            alternatives: 40,
            preselect: Math.max(0, Math.min(5, room)),
          })
        : [],
    [index, area, room],
  );
  const coverage = useMemo(() => {
    if (!index || !area) return null;
    const list = storesInArea(index, area.from, area.opts);
    return {
      stores: list.length,
      chains: new Set(list.map((x) => x.store.chainId)).size,
    };
  }, [index, area]);

  const chosenStore = (s: Suggestion) => {
    const pick = swapped[s.store.chainId];
    return pick && (pick.id === s.store.id || s.alternatives.some((a) => a.id === pick.id)) ? pick : s.store;
  };
  const isTicked = (s: Suggestion) => ticks[s.store.chainId] ?? s.preselected;
  // Built from the latest state, so two quick taps on different rows both count.
  const toggle = (s: Suggestion) =>
    setTicks((prev) => ({
      ...prev,
      [s.store.chainId]: !(prev[s.store.chainId] ?? s.preselected),
    }));

  const picked = suggestions
    .filter(isTicked)
    .map(chosenStore)
    .filter((s) => !alreadyChosen.includes(s.id));

  const start = () => {
    const data = useData.getState();
    // Downloads run side by side; the list is usable as soon as the first one lands.
    void Promise.all(picked.map((s) => data.addStore(s.id))).then((results) => {
      if (results.some((ok) => !ok)) toast('חלק מהסניפים לא ירדו. אפשר לרענן בלשונית "סניפים"');
    });
    useNav.getState().go('list');
  };

  const chooseManually = () => open({ kind: 'stores' });
  const regionInfo = REGIONS.find((r) => r.id === region);

  const title =
    mode === 'region'
      ? regionInfo
        ? `הסופרים ${regionInfo.in}`
        : 'באיזה אזור אתה קונה?'
      : origin.state === 'ready'
        ? `הסופרים באזור ${origin.city}`
        : 'סופרים באזור שלך';

  const showList = suggestions.length > 0;

  return (
    <FullScreen onClose={close} label="סופרים באזור שלך">
      <div className="border-b-[1.5px] border-line bg-surface px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-1">
          <BackButton onClick={close} />
          <h2 className="flex-1 truncate text-lg font-bold">{title}</h2>
        </div>

        <div
          role="radiogroup"
          aria-label="איך לבחור"
          className="mx-1 mt-2 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1"
        >
          {(
            [
              ['distance', 'לפי מרחק'],
              ['region', 'לפי אזור'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              onClick={() => {
                setMode(id);
                setExpanded(null);
              }}
              className={cx(
                'min-h-10 rounded-lg text-[0.95rem] font-semibold',
                mode === id ? 'bg-surface text-ink shadow-sm' : 'text-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'distance' && origin.state === 'ready' && radiusKm !== null ? (
          <div className="px-2 pt-3">
            <label htmlFor="radius" className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">
                עד <span className="num text-lg">{radiusKm}</span> ק"מ {origin.device ? 'ממך' : `מ${origin.city}`}
              </span>
              {coverage ? (
                <span className="text-sm text-muted">
                  {coverage.chains === 1 ? 'רשת אחת' : `${coverage.chains} רשתות`}, {coverage.stores} סניפים
                </span>
              ) : null}
            </label>
            <input
              id="radius"
              type="range"
              min={MIN_KM}
              max={MAX_KM}
              step={1}
              value={radiusKm}
              onChange={(e) => setRadius(Number(e.target.value))}
              aria-valuetext={`${radiusKm} קילומטר`}
              className="mt-1 h-8 w-full accent-[var(--color-ink)]"
            />
          </div>
        ) : null}

        {mode === 'region' && region ? (
          <div ref={chips} className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={r.id === region}
                onClick={() => {
                  setRegion(r.id);
                  setExpanded(null);
                }}
                className={cx(
                  'min-h-10 shrink-0 rounded-full border-[1.5px] px-3.5 text-[0.95rem] font-medium',
                  r.id === region ? 'border-ink bg-ink text-surface' : 'border-line bg-surface active:bg-sunken',
                )}
              >
                {r.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={list} className="flex-1 overflow-y-auto overscroll-contain pb-40">
        {!index ? (
          <Loading />
        ) : mode === 'region' && !region ? (
          <RegionList onPick={setRegion} />
        ) : mode === 'distance' && (origin.state === 'locating' || origin.state === 'idle') ? (
          <Loading />
        ) : mode === 'distance' && origin.state === 'unavailable' ? (
          <EmptyState
            title="נבחר עיר או אזור במקום"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => open({ kind: 'stores', quick: true })}>בחר עיר</Button>
                <Button variant="outline" onClick={() => setMode('region')}>
                  בחר אזור
                </Button>
              </div>
            }
          >
            {origin.reason} בחר את העיר או האזור שלך, ונציע לך את הסופרים המובילים בהם.
          </EmptyState>
        ) : !showList ? (
          <EmptyState
            title="אין כאן רשתות מובילות"
            action={
              mode === 'distance' ? (
                <Button onClick={() => setRadius(Math.min(MAX_KM, (radiusKm ?? 10) + 10))}>הרחב את הטווח</Button>
              ) : (
                <Button onClick={chooseManually}>לבחור סניפים בעצמי</Button>
              )
            }
          >
            {mode === 'distance' ? 'בטווח הזה לא מצאנו סופרים. הגדל את המרחק.' : 'לא מצאנו סופרים באזור הזה.'}
          </EmptyState>
        ) : (
          <>
            {/* Scrolls away with the list, so the controls above keep their room on a small screen. */}
            <p className="px-5 py-3 text-sm text-muted">
              {mode === 'region' && coverage
                ? `${coverage.chains} רשתות ו-${coverage.stores} סניפים ${regionInfo?.in ?? ''}. `
                : ''}
              סימנו סניף אחד מכל רשת מובילה. אפשר להוריד סימון, להוסיף, או להחליף לסניף שאתה קונה בו.
              {mode === 'distance' ? ' המרחק נמדד עד מרכז העיר של כל סניף.' : ''}
            </p>
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
                          <span className="block text-[1.05rem] leading-tight font-bold">
                            {chainLabel(store, index)}
                          </span>
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
                                setSwapped((prev) => ({
                                  ...prev,
                                  [s.store.chainId]: o,
                                }));
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
          </>
        )}
      </div>

      {showList ? (
        <div className="absolute inset-x-0 bottom-0 border-t-[1.5px] border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {picked.length > room ? (
            <p className="pb-2 text-center text-sm text-alert">
              {room > 0
                ? `יש מקום לעוד ${room === 1 ? 'סניף אחד' : `${room} סניפים`} (עד ${MAX_STORES} בסך הכול). הורד סימון כדי לבחור אילו.`
                : `כבר בחרת ${MAX_STORES} סניפים. הסר סניף בלשונית "סניפים" כדי להוסיף אחר.`}
            </p>
          ) : null}
          <Button
            variant="tag"
            className="w-full"
            disabled={picked.length === 0 || picked.length > room}
            onClick={start}
          >
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

function Loading() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-16 text-center text-muted">
      <LoaderCircle className="size-8 animate-spin text-ink" />
      <p className="text-lg font-semibold text-ink">מחפשים סופרים באזור שלך</p>
      <p>אם הטלפון שואל אם לאשר גישה למיקום, לחץ "אישור". המיקום נשאר אצלך ולא נשלח לאף אחד.</p>
    </div>
  );
}

/** The regions of the country, each with a few of its towns so the name is clear. */
function RegionList({ onPick }: { onPick: (r: RegionId) => void }) {
  return (
    <ul className="perforated bg-surface">
      {REGIONS.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onPick(r.id)}
            className="flex min-h-16 w-full items-center gap-3 px-5 py-2.5 text-start active:bg-sunken"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[1.05rem] font-bold">{r.name}</span>
              <span className="block truncate text-sm text-muted">{r.hint}</span>
            </span>
            <ChevronLeft className="size-5 shrink-0 text-muted" />
          </button>
        </li>
      ))}
    </ul>
  );
}
