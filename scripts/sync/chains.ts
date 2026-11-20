// One adapter per publishing portal. Each adapter only knows how to list today's files and how
// to download one of them; everything after that (parsing, normalizing) is shared.
//
// Included: portals that serve files openly, and the shared "Public Published Prices" server,
// where each chain has a public user name with no password. Chains whose access needs a real
// password are left out on purpose.

import { getText, request } from './http.ts';
import { decodeEntities } from './xml.ts';

export type FileKind = 'stores' | 'pricefull' | 'promofull';

export interface RemoteFile {
  kind: FileKind;
  name: string;
  url: string;
  /** Store id without leading zeros ('' for stores files). */
  storeId: string;
  /** Sortable timestamp taken from the file name, e.g. 20261120043100. */
  stamp: string;
}

export interface ChainAdapter {
  id: string;
  name: string;
  /** Merge every PriceFull of the day instead of trusting the newest one alone. */
  mergeAllPriceFiles?: boolean;
  list(): Promise<RemoteFile[]>;
  download(file: RemoteFile): Promise<Buffer>;
}

/** Today's date in Israel, where the files are published. */
export function israelDate(offsetDays = 0): { iso: string; dmy: string } {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
  const [y, m, day] = iso.split('-');
  return { iso, dmy: `${day}/${m}/${y}` };
}

/** Classify a transparency file by its name: `PriceFull<chain>-<sub>-<store>-<date>-<time>.gz`. */
export function describeFile(name: string, url: string): RemoteFile | null {
  const base = name.replace(/\?.*$/, '').replace(/(\.(gz|xml|zip))+$/i, '');
  const lower = base.toLowerCase();
  const kind: FileKind | null = lower.startsWith('pricefull')
    ? 'pricefull'
    : lower.startsWith('promofull')
      ? 'promofull'
      : lower.startsWith('stores')
        ? 'stores'
        : null;
  if (!kind) return null;
  const parts = base.split('-');
  if (kind === 'stores') {
    return { kind, name, url, storeId: '', stamp: parts.slice(1).join('').replace(/\D/g, '') };
  }
  let store: string;
  let stamp: string;
  if (parts.length >= 5) {
    store = parts[2];
    stamp = parts[3] + parts[4];
  } else if (parts.length === 4) {
    // Either chain-store-date-time or chain-sub-store-datetime.
    if (parts[2].length === 8) {
      store = parts[1];
      stamp = parts[2] + parts[3];
    } else {
      store = parts[2];
      stamp = parts[3];
    }
  } else if (parts.length === 3) {
    store = parts[1];
    stamp = parts[2];
  } else {
    return null;
  }
  const storeId = String(parseInt(store, 10));
  if (storeId === 'NaN') return null;
  return { kind, name, url, storeId, stamp: stamp.replace(/\D/g, '') };
}

const plainDownload = (file: RemoteFile) => request(file.url);

// ---- Shufersal ----------------------------------------------------------------------------

const SHUFERSAL = 'https://prices.shufersal.co.il/FileObject/UpdateCategory';
const SHUFERSAL_CATEGORY: Record<FileKind, number> = { stores: 5, pricefull: 2, promofull: 4 };

function shufersalLinks(html: string): RemoteFile[] {
  const out: RemoteFile[] = [];
  for (const m of html.matchAll(/href="(https:\/\/[^"]*blob\.core\.windows\.net\/[^"]+)"/g)) {
    const url = decodeEntities(m[1]);
    const name = new URL(url).pathname.split('/').pop() ?? '';
    const f = describeFile(name, url);
    if (f) out.push(f);
  }
  return out;
}

const shufersal: ChainAdapter = {
  id: 'shufersal',
  name: 'שופרסל',
  async list() {
    const out: RemoteFile[] = [];
    for (const kind of ['stores', 'pricefull', 'promofull'] as FileKind[]) {
      const pageUrl = (p: number) => `${SHUFERSAL}?catID=${SHUFERSAL_CATEGORY[kind]}&storeId=0&page=${p}`;
      const first = await getText(pageUrl(1));
      out.push(...shufersalLinks(first));
      const lastPage = Math.max(1, ...[...first.matchAll(/page=(\d+)/g)].map((m) => Number(m[1])));
      for (let p = 2; p <= lastPage; p++) out.push(...shufersalLinks(await getText(pageUrl(p))));
    }
    return out;
  },
  async download(file) {
    try {
      return await request(file.url, { retries: 1 });
    } catch (err) {
      // Download links are signed and short-lived; ask for a fresh one for this store.
      if (file.kind === 'stores') throw err;
      const html = await getText(`${SHUFERSAL}?catID=${SHUFERSAL_CATEGORY[file.kind]}&storeId=${file.storeId}&page=1`);
      const fresh = shufersalLinks(html)
        .filter((f) => f.kind === file.kind && f.storeId === file.storeId)
        .sort((a, b) => b.stamp.localeCompare(a.stamp))[0];
      if (!fresh) throw err;
      return request(fresh.url);
    }
  },
};

// ---- Carrefour ----------------------------------------------------------------------------

const CARREFOUR = 'https://prices.carrefour.co.il';

const carrefour: ChainAdapter = {
  id: 'carrefour',
  name: 'קרפור',
  async list() {
    const html = await getText(`${CARREFOUR}/`);
    const path = /const path\s*=\s*'([^']+)'/.exec(html)?.[1];
    const filesJson = /const files\s*=\s*(\[[\s\S]*?\]);/.exec(html)?.[1];
    if (!path || !filesJson) throw new Error('Carrefour page layout changed: file list not found');
    const files = JSON.parse(filesJson) as Array<{ name: string }>;
    return files
      .map((f) => describeFile(f.name, `${CARREFOUR}/${path}/${f.name}`))
      .filter((f): f is RemoteFile => f !== null);
  },
  download: plainDownload,
};

// ---- Hazi Hinam ---------------------------------------------------------------------------

const HAZI = 'https://shop.hazi-hinam.co.il/Prices';

const haziHinam: ChainAdapter = {
  id: 'hazihinam',
  name: 'חצי חינם',
  mergeAllPriceFiles: true,
  async list() {
    const out = new Map<string, RemoteFile>();
    for (let page = 1; page <= 40; page++) {
      const html = await getText(`${HAZI}?p=${page}&s=&f=&t=&d=`);
      const links = [...html.matchAll(/href="(https:\/\/[^"]*blob\.core\.windows\.net\/[^"]+)"/g)];
      if (!links.length) break;
      for (const m of links) {
        const url = decodeEntities(m[1]);
        const name = url.split('/').pop() ?? '';
        const f = describeFile(name, url);
        if (f) out.set(name, f);
      }
    }
    return [...out.values()];
  },
  download: plainDownload,
};

// ---- Bina Projects portals (several regional chains share this software) -------------------

function binaChain(id: string, name: string, subdomain: string): ChainAdapter {
  const base = `https://${subdomain}.binaprojects.com`;
  const listFor = async (dmy: string, fileType: number): Promise<RemoteFile[]> => {
    const body = new URLSearchParams({ WStore: '0', WDate: dmy, WFileType: String(fileType) }).toString();
    const text = await getText(`${base}/MainIO_Hok.aspx`, { method: 'POST', body });
    const rows = JSON.parse(text) as Array<{ FileNm: string }>;
    return rows
      .map((r) => describeFile(r.FileNm, `${base}/Download.aspx?FileNm=${encodeURIComponent(r.FileNm)}`))
      .filter((f): f is RemoteFile => f !== null);
  };
  return {
    id,
    name,
    async list() {
      for (const offset of [0, -1]) {
        const { dmy } = israelDate(offset);
        const prices = await listFor(dmy, 4);
        if (!prices.length) continue;
        const [stores, promos] = await Promise.all([listFor(dmy, 1), listFor(dmy, 5)]);
        return [...stores, ...prices, ...promos];
      }
      return [];
    },
    async download(file) {
      // The portal answers with the real location of the file.
      const text = await getText(file.url, { method: 'POST', body: '' });
      const location = (JSON.parse(text) as Array<{ SPath: string }>)[0]?.SPath;
      if (!location) throw new Error(`No download location for ${file.name}`);
      return request(location);
    },
  };
}

// ---- "Public Published Prices" server (NCR), shared by many chains -------------------------

const PUBLISHED = 'https://url.publishedprices.co.il';

/**
 * The server keeps a session cookie and wants a CSRF token on every form post. Each chain signs
 * in with the public user name it advertises for this purpose; there is no password.
 */
function publishedPricesChain(id: string, name: string, publicUser: string): ChainAdapter {
  const jar = new Map<string, string>();
  let session: Promise<void> | null = null;

  const call = async (path: string, form?: Record<string, string>): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${PUBLISHED}${path}`, {
          method: form ? 'POST' : 'GET',
          body: form ? new URLSearchParams(form).toString() : undefined,
          redirect: 'manual',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; price-transparency-reader)',
            Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
            ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' } : {}),
          },
          signal: AbortSignal.timeout(120_000),
        });
        for (const c of res.headers.getSetCookie()) {
          const [pair] = c.split(';');
          const eq = pair.indexOf('=');
          if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
        }
        if (res.status >= 500) throw new Error(`HTTP ${res.status} for ${path}`);
        return res;
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      }
    }
    throw lastError;
  };

  const csrfToken = async (path: string) => {
    const html = await (await call(path)).text();
    const token = /name="csrftoken" content="([^"]+)"/.exec(html)?.[1];
    if (!token) throw new Error(`no CSRF token on ${path}`);
    return token;
  };

  const signIn = async () => {
    jar.clear();
    const res = await call('/login/user', {
      username: publicUser,
      password: '',
      csrftoken: await csrfToken('/login'),
      Submit: 'Sign in',
    });
    await res.arrayBuffer();
    // Success redirects to the file browser; failure redirects back to the login page.
    const target = res.headers.get('location') ?? '';
    if (res.status !== 302 || /login/i.test(target)) throw new Error(`public user "${publicUser}" was not accepted`);
  };
  const ensureSession = () => (session ??= signIn());

  return {
    id,
    name,
    async list() {
      await ensureSession();
      const res = await call('/file/json/dir', {
        sEcho: '1',
        iColumns: '5',
        sColumns: ',,,,',
        iDisplayStart: '0',
        iDisplayLength: '100000',
        mDataProp_0: 'fname',
        mDataProp_1: 'typeLabel',
        mDataProp_2: 'size',
        mDataProp_3: 'ftime',
        mDataProp_4: '',
        sSearch: '',
        bRegex: 'false',
        iSortingCols: '0',
        cd: '/',
        csrftoken: await csrfToken('/file'),
      });
      const rows = ((await res.json()) as { aaData?: Array<{ fname: string; size: number }> }).aaData ?? [];
      return rows
        .filter((r) => r.size > 0)
        .map((r) => describeFile(r.fname, `/file/d/${encodeURIComponent(r.fname)}`))
        .filter((f): f is RemoteFile => f !== null);
    },
    async download(file) {
      for (let attempt = 0; attempt < 2; attempt++) {
        await ensureSession();
        const res = await call(file.url);
        if (res.status === 200) return Buffer.from(await res.arrayBuffer());
        await res.arrayBuffer();
        // A redirect means the session timed out mid-run: sign in again and retry once.
        session = null;
      }
      throw new Error(`could not download ${file.name}`);
    },
  };
}

// ---- Laib catalog API (Victory, Mahsanei HaShuk, H. Cohen) ---------------------------------

const LAIB = 'https://laibcatalog.co.il/webapi';

function laibChain(id: string, name: string, chainCode: string): ChainAdapter {
  return {
    id,
    name,
    async list() {
      const rows = JSON.parse(await getText(`${LAIB}/api/getfiles?edi=${chainCode}`)) as Array<{ fileName: string }>;
      return rows
        .map((r) => describeFile(r.fileName, `${LAIB}/${chainCode}/${encodeURIComponent(r.fileName)}`))
        .filter((f): f is RemoteFile => f !== null);
    },
    download: plainDownload,
  };
}

// ---- Super-Pharm --------------------------------------------------------------------------

const SUPER_PHARM = 'https://prices.super-pharm.co.il';

const superPharm: ChainAdapter = {
  id: 'superpharm',
  name: 'סופר-פארם',
  async list() {
    const out = new Map<string, RemoteFile>();
    const collect = async (category: string, date: string) => {
      const before = out.size;
      for (let page = 1; page <= 80; page++) {
        const query = new URLSearchParams({ 'Category-equals': category, page: String(page) });
        if (date) query.set('Date-equals', date);
        const html = await getText(`${SUPER_PHARM}/?${query}`);
        let fresh = 0;
        for (const m of html.matchAll(/href="(\/Download\/([^"?]+)\?[^"]*)"/g)) {
          if (out.has(m[2])) continue;
          const f = describeFile(m[2], SUPER_PHARM + decodeEntities(m[1]));
          if (f) {
            out.set(m[2], f);
            fresh++;
          }
        }
        if (!fresh) break;
      }
      return out.size - before;
    };
    await collect('Stores', '');
    const today = israelDate().dmy;
    // Before the morning files are out, fall back to the most recent ones on the site.
    if (!(await collect('PriceFull', today))) await collect('PriceFull', '');
    if (!(await collect('PromoFull', today))) await collect('PromoFull', '');
    return [...out.values()];
  },
  download: plainDownload,
};

// ---- Netiv HaHesed (also Barkol and Shira Market) -----------------------------------------

const NETIV = 'https://app.netiv-hesed.com';

const netivHahesed: ChainAdapter = {
  id: 'netivhahesed',
  name: 'נתיב החסד',
  async list() {
    const out = new Map<string, RemoteFile>();
    for (const type of ['Stores', 'PriceFull', 'PromoFull']) {
      const html = await getText(`${NETIV}/?FileType=${type}`);
      for (const m of html.matchAll(/href="(\/Prices\/Download\?fileName=([^"&]+)[^"]*)"/g)) {
        const name = decodeURIComponent(m[2]);
        const f = describeFile(name, NETIV + decodeEntities(m[1]));
        if (f) out.set(name, f);
      }
    }
    return [...out.values()];
  },
  download: plainDownload,
};

// ---- City Market franchise stores ---------------------------------------------------------

const CITY_MARKET = 'https://www.citymarket-shops.co.il';

const cityMarketShops: ChainAdapter = {
  id: 'citymarketshops',
  name: 'סיטי מרקט',
  mergeAllPriceFiles: true,
  async list() {
    const out = new Map<string, RemoteFile>();
    for (let page = 1; page <= 80; page++) {
      const html = await getText(`${CITY_MARKET}/?p=${page}&s=&f=&t=&d=`);
      let found = 0;
      for (const [, row] of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
        const name = /((?:Price|Promo|Stores)[A-Za-z]*\d[\w-]*\.(?:gz|xml|zip))/i.exec(row)?.[1];
        const href = /href="(\/downloadFile\/[^"]+)"/.exec(row)?.[1];
        if (!name || !href) continue;
        found++;
        const f = describeFile(name, CITY_MARKET + href);
        if (f) out.set(name, f);
      }
      if (!found) break;
    }
    return [...out.values()];
  },
  download: plainDownload,
};

// ---- Mishnat Yosef (KT) -------------------------------------------------------------------

const mishnatYosef: ChainAdapter = {
  id: 'mishnatyosef',
  name: 'משנת יוסף',
  async list() {
    const text = await getText('https://list-files.w5871031-kt.workers.dev/');
    const rows = JSON.parse(text) as Array<{ name: string; url: string }>;
    return rows
      // Only follow links to the storage bucket the chain's own page uses.
      .filter((r) => /^https:\/\/[\w.-]+\.backblazeb2\.com\//.test(r.url))
      .map((r) => describeFile(r.name, r.url))
      .filter((f): f is RemoteFile => f !== null);
  },
  download: plainDownload,
};

// The official list of chains and where each publishes is kept by the Consumer Protection
// Authority: https://www.gov.il/he/pages/cpfta_prices_regulations
export const CHAINS: ChainAdapter[] = [
  shufersal,
  publishedPricesChain('ramilevy', 'רמי לוי', 'RamiLevi'),
  publishedPricesChain('yohananof', 'יוחננוף', 'yohananof'),
  laibChain('victory', 'ויקטורי', '7290696200003'),
  publishedPricesChain('osherad', 'אושר עד', 'osherad'),
  carrefour,
  laibChain('mahsaneihashuk', 'מחסני השוק', '7290661400001'),
  haziHinam,
  publishedPricesChain('tivtaam', 'טיב טעם', 'TivTaam'),
  publishedPricesChain('keshet', 'קשת טעמים', 'Keshet'),
  publishedPricesChain('stopmarket', 'סטופ מרקט', 'Stop_Market'),
  publishedPricesChain('politzer', 'פוליצר', 'politzer'),
  publishedPricesChain('freshmarket', 'פרש מרקט', 'freshmarket'),
  publishedPricesChain('doralon', 'דור אלון', 'doralon'),
  binaChain('kingstore', 'קינג סטור', 'kingstore'),
  binaChain('maayan2000', 'מעיין 2000', 'maayan2000'),
  binaChain('shukhair', 'שוק העיר', 'shuk-hayir'),
  binaChain('zolvebegadol', 'זול ובגדול', 'zolvebegadol'),
  binaChain('shefa', 'שפע ברכת השם', 'shefabirkathashem'),
  binaChain('supersapir', 'סופר ספיר', 'supersapir'),
  binaChain('citymarket', 'סיטי מרקט', 'citymarketkiryatgat'),
  binaChain('ktshivuk', 'משנת יוסף', 'ktshivuk'),
  mishnatYosef,
  netivHahesed,
  laibChain('hcohen', 'ח. כהן', '7290455000004'),
  binaChain('bareket', 'סופר ברקת', 'superbareket'),
  cityMarketShops,
  superPharm,
  binaChain('goodpharm', 'גוד פארם', 'goodpharm'),
];
