/**
 * A minimal FalkorDB client, for the gate only.
 *
 * @hopper/graph owns the real driver; nothing else in the repo may import it.
 * But the meta layer's central claim - "Q7 runs in FalkorDB and the graph picks
 * the pipeline" - is worth proving against the actual database rather than only
 * against a stub. So this is a ~150-line RESP2 client over a raw socket, used
 * by src/testing/falkor-graph.ts and by nothing that ships.
 */
import net from 'node:net';

type Reply = string | number | null | Error | Reply[];

const CRLF = 2;

class RespParser {
  private buf: Buffer = Buffer.alloc(0);

  feed(chunk: Buffer): Reply[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const out: Reply[] = [];
    for (;;) {
      const r = this.parse(0);
      if (!r) break;
      out.push(r.value);
      this.buf = this.buf.subarray(r.next);
    }
    return out;
  }

  private lineEnd(from: number): number {
    const i = this.buf.indexOf('\r\n', from, 'utf8');
    return i;
  }

  private parse(i: number): { value: Reply; next: number } | null {
    if (i >= this.buf.length) return null;
    const end = this.lineEnd(i);
    if (end === -1) return null;
    const type = String.fromCharCode(this.buf[i]);
    const line = this.buf.toString('utf8', i + 1, end);
    const after = end + CRLF;

    switch (type) {
      case '+':
        return { value: line, next: after };
      case '-':
        return { value: new Error(line), next: after };
      case ':':
        return { value: Number(line), next: after };
      case ',':
        return { value: Number(line), next: after };
      case '$': {
        const len = Number(line);
        if (len === -1) return { value: null, next: after };
        if (this.buf.length < after + len + CRLF) return null;
        return { value: this.buf.toString('utf8', after, after + len), next: after + len + CRLF };
      }
      case '*': {
        const n = Number(line);
        if (n === -1) return { value: null, next: after };
        const items: Reply[] = [];
        let cursor = after;
        for (let k = 0; k < n; k += 1) {
          const r = this.parse(cursor);
          if (!r) return null;
          items.push(r.value);
          cursor = r.next;
        }
        return { value: items, next: cursor };
      }
      default:
        throw new Error(`falkor-client: unknown RESP type "${type}"`);
    }
  }
}

function encode(args: string[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`, 'utf8')];
  for (const a of args) {
    const b = Buffer.from(a, 'utf8');
    parts.push(Buffer.from(`$${b.length}\r\n`, 'utf8'), b, Buffer.from('\r\n', 'utf8'));
  }
  return Buffer.concat(parts);
}

export class FalkorClient {
  private socket: net.Socket | null = null;
  private parser = new RespParser();
  private queue: Array<{ resolve: (r: Reply) => void; reject: (e: Error) => void }> = [];

  constructor(
    private readonly host = process.env.FALKOR_HOST ?? '127.0.0.1',
    private readonly port = Number(process.env.FALKOR_PORT ?? 6379),
  ) {}

  connect(timeoutMs = 1500): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.port });
      const onError = (e: Error) => {
        s.destroy();
        reject(e);
      };
      s.setTimeout(timeoutMs, () => onError(new Error('falkor-client: connect timeout')));
      s.once('error', onError);
      s.once('connect', () => {
        s.setTimeout(0);
        s.off('error', onError);
        s.on('error', (e) => {
          const waiter = this.queue.shift();
          if (waiter) waiter.reject(e);
        });
        s.on('data', (chunk) => {
          for (const reply of this.parser.feed(chunk)) {
            const waiter = this.queue.shift();
            if (!waiter) continue;
            if (reply instanceof Error) waiter.reject(reply);
            else waiter.resolve(reply);
          }
        });
        this.socket = s;
        resolve();
      });
    });
  }

  command(...args: string[]): Promise<Reply> {
    const s = this.socket;
    if (!s) return Promise.reject(new Error('falkor-client: not connected'));
    return new Promise<Reply>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      s.write(encode(args));
    });
  }

  close(): void {
    this.socket?.end();
    this.socket = null;
  }
}

/** Cypher literal for a bound parameter — quoted and escaped */
export function literal(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** strip the `// hopper.meta.<tag>` dispatch comment; the DB does not need it */
export function stripTag(cypher: string): string {
  return cypher.replace(/^\s*\/\/[^\n]*\n/, '');
}

export function withParams(cypher: string, params: Record<string, unknown>): string {
  const keys = Object.keys(params);
  const prefix = keys.length === 0 ? '' : `CYPHER ${keys.map((k) => `${k}=${literal(params[k])}`).join(' ')} `;
  return prefix + stripTag(cypher).replace(/\s+/g, ' ').trim();
}

/**
 * GRAPH.QUERY in non-compact mode replies with [header, rows, stats] when the
 * query returns anything, and [stats] when it does not.
 */
export function rowsToObjects(reply: Reply): Array<Record<string, unknown>> {
  if (!Array.isArray(reply) || reply.length < 3) return [];
  const header = (reply[0] as Reply[]).map((h) => String(Array.isArray(h) ? h[h.length - 1] : h));
  const rows = reply[1] as Reply[];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const cells = r as Reply[];
    const obj: Record<string, unknown> = {};
    header.forEach((name, i) => {
      obj[name] = cells[i] as unknown;
    });
    return obj;
  });
}
