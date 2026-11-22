/**
 * Minimal document-store abstraction. In a published artifact it is backed by the shared `db`
 * capability (so two people on different accounts see the same game); everywhere else it falls
 * back to an in-memory store, which is enough for Pass & Play on one device.
 */

export interface Doc {
  id: string;
  data: any;
}
export type Unsub = () => void;

export interface Store {
  /** True when documents are shared with other viewers (online play possible). */
  readonly shared: boolean;
  getDoc(path: string): Promise<any | null>;
  setDoc(path: string, data: any): Promise<void>;
  delDoc(path: string): Promise<void>;
  listCol(path: string): Promise<Doc[]>;
  watchDoc(path: string, cb: (data: any | null) => void, err?: (e: any) => void): Unsub;
  watchCol(path: string, cb: (docs: Doc[]) => void, err?: (e: any) => void): Unsub;
}

const clone = <T,>(v: T): T => (v == null ? v : (JSON.parse(JSON.stringify(v)) as T));

/** In-memory store. Used for tests and as the offline fallback. */
export class MemStore implements Store {
  readonly shared: boolean;
  private docs = new Map<string, any>();
  private watchers = new Set<{ path: string; col: boolean; fire: () => void }>();

  constructor(shared = false) {
    this.shared = shared;
  }

  private parent(path: string) {
    return path.slice(0, path.lastIndexOf('/'));
  }
  private notify(path: string) {
    // Deliver asynchronously, like a real store, so callers never re-enter themselves.
    queueMicrotask(() => {
      for (const w of [...this.watchers]) if (w.path === path || (w.col && w.path === this.parent(path))) w.fire();
    });
  }
  private colDocs(path: string): Doc[] {
    const out: Doc[] = [];
    for (const [k, v] of this.docs) if (this.parent(k) === path) out.push({ id: k.slice(path.length + 1), data: clone(v) });
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async getDoc(path: string) {
    return this.docs.has(path) ? clone(this.docs.get(path)) : null;
  }
  async setDoc(path: string, data: any) {
    this.docs.set(path, clone(data));
    this.notify(path);
  }
  async delDoc(path: string) {
    this.docs.delete(path);
    this.notify(path);
  }
  async listCol(path: string) {
    return this.colDocs(path);
  }
  watchDoc(path: string, cb: (d: any | null) => void) {
    const w = { path, col: false, fire: () => cb(this.docs.has(path) ? clone(this.docs.get(path)) : null) };
    this.watchers.add(w);
    queueMicrotask(() => this.watchers.has(w) && w.fire());
    return () => void this.watchers.delete(w);
  }
  watchCol(path: string, cb: (docs: Doc[]) => void) {
    const w = { path, col: true, fire: () => cb(this.colDocs(path)) };
    this.watchers.add(w);
    queueMicrotask(() => this.watchers.has(w) && w.fire());
    return () => void this.watchers.delete(w);
  }
}

/** Store over the artifact `db` capability. */
class DbStore implements Store {
  readonly shared = true;
  constructor(private db: any) {}

  async getDoc(path: string) {
    const s = await this.db.doc(path).get();
    return s.exists ? clone(s.data()) : null;
  }
  async setDoc(path: string, data: any) {
    await this.db.doc(path).set(clone(data));
  }
  async delDoc(path: string) {
    await this.db.doc(path).delete();
  }
  async listCol(path: string) {
    const s = await this.db.collection(path).get();
    return s.docs.map((d: any) => ({ id: d.id, data: clone(d.data()) }));
  }
  watchDoc(path: string, cb: (d: any | null) => void, err?: (e: any) => void) {
    return this.db.doc(path).onSnapshot((s: any) => cb(s.exists ? clone(s.data()) : null), err);
  }
  watchCol(path: string, cb: (docs: Doc[]) => void, err?: (e: any) => void) {
    return this.db.collection(path).onSnapshot((s: any) => cb(s.docs.map((d: any) => ({ id: d.id, data: clone(d.data()) }))), err);
  }
}

/**
 * Store over the Cloudflare worker's `/ws` endpoint (worker/index.js). Reconnects by itself and
 * re-sends watches and presence, so a dropped connection heals without the game noticing.
 */
export class WsStore implements Store {
  readonly shared = true;
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, { msg: any; resolve: (v: any) => void; reject: (e: any) => void; sent: boolean }>();
  private subs = new Map<string, { path: string; col: boolean; cb: (d: any) => void }>();
  private rooms = new Map<string, { cid: string; cb: (cids: string[]) => void }>();
  private retry = 0;

  constructor(private url: string) {}

  /** Resolves once the first connection is open; rejects if it cannot connect in time. */
  connect(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      this.open(() => {
        clearTimeout(t);
        resolve();
      }, () => {
        clearTimeout(t);
        reject(new Error('connect failed'));
      });
    });
  }

  private open(onOpen?: () => void, onFail?: () => void) {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.retry = 0;
      for (const [sub, w] of this.subs) this.raw({ op: 'watch', sub, path: w.path, col: w.col });
      for (const [room, r] of this.rooms) this.raw({ op: 'presence', room, cid: r.cid });
      for (const p of this.pending.values()) if (!p.sent) {
        p.sent = true;
        this.raw(p.msg);
      }
      onOpen?.();
    };
    ws.onmessage = (e) => this.onMessage(e.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      // get/set/del/list are all idempotent, so unanswered requests are simply re-sent after reconnecting.
      for (const p of this.pending.values()) p.sent = false;
      if (!opened && onFail) return onFail();
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    };
  }

  private raw(msg: any) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(raw: any) {
    let m: any;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (m.t === 'snap') this.subs.get(String(m.sub))?.cb(m.data);
    else if (m.t === 'peers') this.rooms.get(m.room)?.cb(m.cids ?? []);
    else if (m.id != null) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.ok ? p.resolve(m.data) : p.reject(new Error(m.error ?? 'Request failed'));
    }
  }

  private req(op: string, path: string, data?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const msg = { id, op, path, data };
      const open = this.ws?.readyState === WebSocket.OPEN;
      this.pending.set(id, { msg, resolve, reject, sent: open });
      if (open) this.raw(msg);
    });
  }

  async getDoc(path: string) {
    return clone(await this.req('get', path));
  }
  async setDoc(path: string, data: any) {
    await this.req('set', path, clone(data));
  }
  async delDoc(path: string) {
    await this.req('del', path);
  }
  async listCol(path: string) {
    return (await this.req('list', path)) as Doc[];
  }
  private watch(path: string, col: boolean, cb: (d: any) => void): Unsub {
    const sub = String(++this.seq);
    this.subs.set(sub, { path, col, cb });
    this.raw({ op: 'watch', sub, path, col });
    return () => {
      this.subs.delete(sub);
      this.raw({ op: 'unwatch', sub });
    };
  }
  watchDoc(path: string, cb: (d: any | null) => void) {
    return this.watch(path, false, (d) => cb(d ?? null));
  }
  watchCol(path: string, cb: (docs: Doc[]) => void) {
    return this.watch(path, true, (d) => cb(Array.isArray(d) ? d : []));
  }
  /** Announces `cid` in `room` and reports everyone present there. */
  presence(room: string, cid: string, cb: (cids: string[]) => void): Unsub {
    this.rooms.set(room, { cid, cb });
    this.raw({ op: 'presence', room, cid });
    return () => {
      this.rooms.delete(room);
      this.raw({ op: 'unpresence', room });
    };
  }
}

export async function openStore(): Promise<Store> {
  try {
    const claude = (globalThis as any).claude;
    const db = claude?.use ? await claude.use('db') : null;
    if (db) return new DbStore(db);
  } catch {
    /* fall through */
  }
  try {
    const loc = (globalThis as any).location;
    if (loc && /^https?:$/.test(loc.protocol)) {
      const ws = new WsStore(`${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`);
      await ws.connect();
      return ws;
    }
  } catch {
    /* no game server here: fall back to the local store */
  }
  return new MemStore(false);
}
