import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, FullScreen, Price, toast , BackButton } from '../components/ui';
import { findByBarcode } from '../data/catalog';
import { costFor, sizeLabel } from '../lib/pricing';
import { storeTitle, useChosenStores, usePricingOptions } from '../lib/view';
import { useApp } from '../state/app';
import { buzz } from '../lib/actions';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import type { Product } from '../types';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

interface Detector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

/** The browser's own barcode reader when it has one (Android), a bundled reader otherwise (iPhone). */
async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: any }).BarcodeDetector;
  if (Native) {
    try {
      const supported: string[] = await Native.getSupportedFormats();
      if (supported.includes('ean_13')) return new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
    } catch {
      // Fall through to the bundled reader.
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  // Serve the reader from the app itself so scanning also works offline.
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
  return new BarcodeDetector({ formats: [...FORMATS] });
}

type Result = { code: string; product: Product | null };

export function Scanner() {
  const close = useNav((s) => s.close);
  const catalog = useData((s) => s.catalog);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [manual, setManual] = useState('');
  const paused = useRef(false);

  // Read the catalog through a ref so a data refresh does not restart the camera.
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const lookup = useCallback((code: string) => {
    paused.current = true;
    buzz(40);
    setResult({ code, product: findByBarcode(catalogRef.current, code) });
  }, []);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('הדפדפן לא מאפשר גישה למצלמה כאן. אפשר להקליד את הברקוד למטה.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
      } catch {
        setCameraError('אין גישה למצלמה. אשר גישה בהגדרות הדפדפן, או הקלד את הברקוד למטה.');
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      let detector: Detector;
      try {
        detector = await createDetector();
      } catch {
        setCameraError('קורא הברקודים לא נטען. אפשר להקליד את הברקוד למטה.');
        return;
      }
      const tick = async () => {
        if (stopped) return;
        if (!paused.current && video.readyState >= 2) {
          try {
            const found = await detector.detect(video);
            if (found[0]?.rawValue) lookup(found[0].rawValue);
          } catch {
            // A frame that cannot be read is not an error; try the next one.
          }
        }
        timer = setTimeout(tick, 180);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [lookup]);

  const [added, setAdded] = useState(0);
  const again = () => {
    setResult(null);
    paused.current = false;
  };

  return (
    <FullScreen onClose={close} label="סריקת ברקוד">
      <div className="flex items-center gap-1 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <BackButton onClick={close} />
        <h2 className="text-lg font-bold">סריקת ברקוד</h2>
      </div>

      <div className="relative mx-4 aspect-[4/3] overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} playsInline muted className="size-full object-cover" />
        {cameraError ? (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-white">{cameraError}</p>
        ) : (
          <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-[3px] border-tag" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {result ? (
          <ScanResult result={result} onAgain={again} onAdded={() => setAdded((n) => n + 1)} />
        ) : (
          <>
            {cameraError ? null : (
              <p className="text-center text-muted">כוון את המצלמה אל הפסים השחורים שעל האריזה. הסריקה קורית לבד.</p>
            )}
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (manual.trim().length >= 6) lookup(manual);
                else toast('ברקוד קצר מדי');
              }}
            >
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={manual}
                onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))}
                placeholder="או הקלד מספר ברקוד"
                aria-label="מספר ברקוד"
                className="num h-12 min-w-0 flex-1 rounded-xl bg-surface px-4 text-start outline-none focus:ring-2 focus:ring-ink"
              />
              <Button type="submit" variant="outline">
                חפש
              </Button>
            </form>
          </>
        )}
      </div>

      {added > 0 ? (
        <div className="border-t-[1.5px] border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="tag" className="w-full" onClick={close}>
            סיימתי לסרוק ({added === 1 ? 'נוסף מוצר אחד' : `נוספו ${added}`})
          </Button>
        </div>
      ) : null}
    </FullScreen>
  );
}

function ScanResult({ result, onAgain, onAdded }: { result: Result; onAgain: () => void; onAdded: () => void }) {
  const index = useData((s) => s.index);
  const stores = useChosenStores();
  const opts = usePricingOptions();
  const { product, code } = result;

  if (!product) {
    return (
      <div className="rounded-2xl bg-surface p-5 text-center">
        <p className="text-lg font-bold">המוצר לא נמכר בסניפים שבחרת</p>
        <p className="num mt-1 text-sm text-muted">{code}</p>
        <Button className="mt-4 w-full" onClick={onAgain}>
          סרוק מוצר אחר
        </Button>
      </div>
    );
  }

  const prices = stores
    .map((store) => {
      const offer = product.offers.get(store.id);
      return offer ? { store, total: costFor(offer, 1, product.weighted, opts).total } : null;
    })
    .filter((p) => p !== null)
    .sort((a, b) => a.total - b.total);

  return (
    <div className="rounded-2xl bg-surface p-5">
      <p className="text-lg leading-snug font-bold">{product.name}</p>
      <p className="text-sm text-muted">{[sizeLabel(product), product.manufacturer].filter(Boolean).join(', ')}</p>
      <ul className="perforated mt-3">
        {prices.map(({ store, total }, i) => (
          <li key={store.id} className="flex items-baseline justify-between gap-3 py-2">
            <span className="min-w-0 truncate">{storeTitle(store, index)}</span>
            <Price value={total} className={i === 0 && prices.length > 1 ? 'text-save' : undefined} />
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <Button
          variant="tag"
          className="flex-1"
          onClick={() => {
            useApp.getState().addProduct(product);
            toast(`נוסף לרשימה: ${product.name}`);
            onAdded();
            onAgain();
          }}
        >
          הוסף לרשימה
        </Button>
        <Button variant="outline" onClick={onAgain}>
          סרוק עוד
        </Button>
      </div>
    </div>
  );
}
