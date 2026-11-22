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

export async function openStore(): Promise<Store> {
  try {
    const claude = (globalThis as any).claude;
    const db = claude?.use ? await claude.use('db') : null;
    if (db) return new DbStore(db);
  } catch {
    /* fall through to the local store */
  }
  return new MemStore(false);
}
