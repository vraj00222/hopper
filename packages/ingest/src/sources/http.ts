/** Small fetch wrapper: timeouts, a real User-Agent, never throws. */

export const USER_AGENT = 'hopper-ingest/1.0 (+https://github.com/hopper; supply-chain triage)';

export interface HttpResult<T> {
  ok: boolean;
  status: number;
  body: T | null;
  error: string | null;
  /** 403/429 from a rate limiter rather than a hard failure */
  rateLimited: boolean;
}

export async function getJson<T>(url: string, timeoutMs = 12_000): Promise<HttpResult<T>> {
  return request<T>(url, { method: 'GET' }, timeoutMs);
}

export async function postJson<T>(url: string, payload: unknown, timeoutMs = 15_000): Promise<HttpResult<T>> {
  return request<T>(
    url,
    { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } },
    timeoutMs,
  );
}

async function request<T>(url: string, init: RequestInit, timeoutMs: number): Promise<HttpResult<T>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
    });
    const rateLimited = res.status === 403 || res.status === 429;
    if (!res.ok) {
      return { ok: false, status: res.status, body: null, error: `HTTP ${res.status} ${res.statusText}`, rateLimited };
    }
    const body = (await res.json()) as T;
    return { ok: true, status: res.status, body, error: null, rateLimited: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: null, error: msg, rateLimited: false };
  } finally {
    clearTimeout(timer);
  }
}

/** run `jobs` with at most `n` in flight */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
