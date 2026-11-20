// Small HTTP helpers for the sync pipeline: retries, timeouts, and a concurrency pool.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} for ${url.slice(0, 120)}`);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function request(url: string, opts: RequestOptions = {}): Promise<Buffer> {
  const { method = 'GET', body, headers = {}, retries = 3, timeoutMs = 90_000 } = opts;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: {
          'User-Agent': UA,
          Accept: '*/*',
          ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // 4xx responses will not get better by retrying (except 429).
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw Object.assign(new HttpError(res.status, url), { fatal: true });
        }
        throw new HttpError(res.status, url);
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      if ((err as { fatal?: boolean }).fatal) break;
      if (attempt < retries) await sleep(600 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function getText(url: string, opts: RequestOptions = {}): Promise<string> {
  return (await request(url, opts)).toString('utf8');
}

/** Run `fn` over `items` with at most `limit` running at once. Never rejects: errors are returned. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results = new Array<{ ok: true; value: R } | { ok: false; error: unknown }>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
