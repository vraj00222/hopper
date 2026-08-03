/**
 * G7 — defensive redaction.
 *
 * Credential values live in the Guild credential store and are never placed in an
 * agent context object. This module is the second line of defence: everything that
 * leaves the package (transcript entries, verdicts, approval bodies, graph writes,
 * bus payloads, log lines) is walked once and any credential value found is replaced
 * with a named placeholder. Belt, then braces.
 */

export interface Redactor {
  /** replace any known secret value inside a string */
  text(s: string): string;
  /** deep-walk any JSON-shaped value, redacting every string it contains */
  deep<T>(value: T): T;
  /** true when the value would have been redacted — used by tests, never by agents */
  leaks(value: unknown): boolean;
}

/** shorter than this and a "secret" is too generic to substitute safely */
const MIN_SECRET_LENGTH = 8;

export function createRedactor(read: () => Record<string, string>): Redactor {
  const pairs = (): Array<[string, string]> =>
    Object.entries(read())
      .filter(([, v]) => typeof v === 'string' && v.length >= MIN_SECRET_LENGTH)
      // longest first so overlapping values redact completely
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, value]) => [name, value]);

  const text = (s: string): string => {
    let out = s;
    for (const [name, value] of pairs()) {
      if (out.includes(value)) out = out.split(value).join(`[redacted:${name}]`);
    }
    return out;
  };

  const deep = <T>(value: T): T => {
    if (typeof value === 'string') return text(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => deep(v)) as unknown as T;
    if (value && typeof value === 'object') {
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src)) out[k] = deep(src[k]);
      return out as unknown as T;
    }
    return value;
  };

  const leaks = (value: unknown): boolean => {
    const json = JSON.stringify(value) ?? '';
    return pairs().some(([, v]) => json.includes(v));
  };

  return { text, deep, leaks };
}
