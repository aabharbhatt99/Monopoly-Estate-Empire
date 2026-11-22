/**
 * Replaces the old Socket.IO server. Every room is one shared document (`rooms/<code>`).
 *
 *  - The room's HOST browser keeps the authoritative state in memory, applies every move with the
 *    rules engine, runs the auction / game clocks and saves the result to the document.
 *  - GUESTS never write game state. A guest writes a numbered request to `rooms/<code>/intents/<me>`;
 *    the host applies it and answers in `room.acks[me]`.
 *
 * The engine is deterministic and the host is the single writer of the room document, so there is
 * no merge logic: the document always shows exactly what the host computed.
 */
import {
  handleEvent,
  newRoom,
  nextDeadline,
  runSystem,
  summary,
  takeover,
  toStored,
  toView,
  type Env,
  type StoredRoom,
} from './hostCore';
import { GameError, applyAction, botDelay, nextBotAction, type ActorAction } from '../engine';
import type { RoomMode, RoomView } from '../engine/room';
import type { Store, Unsub } from './store';

export const roomPath = (code: string) => `rooms/${code}`;
export const intentsPath = (code: string) => `rooms/${code}/intents`;
export const gamePath = (code: string) => `games/${code}`;

const STALE_INTENT_MS = 30_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomId(): string {
  const c: any = (globalThis as any).crypto;
  return c?.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function randomCode(): string {
  let out = '';
  const c: any = (globalThis as any).crypto;
  for (let i = 0; i < 5; i++) {
    const r = c?.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 2 ** 32);
    out += CODE_ALPHABET[r % CODE_ALPHABET.length];
  }
  return out;
}

export async function createRoom(store: Store, clientId: string, mode: RoomMode): Promise<string> {
  for (let tries = 0; tries < 20; tries++) {
    const code = randomCode();
    if (await store.getDoc(roomPath(code))) continue;
    const room = newRoom(code, mode, clientId, Date.now());
    await store.setDoc(roomPath(code), toStored(room));
    await store.setDoc(gamePath(code), indexDoc(room));
    return code;
  }
  throw new Error('Could not create a room. Try again.');
}

export async function roomExists(store: Store, code: string): Promise<boolean> {
  return !!(await store.getDoc(roomPath(code)));
}

export interface GameRow {
  code: string;
  mode: string;
  status: string;
  summary: ReturnType<typeof summary>;
  createdAt: number;
  updatedAt: number;
}

function indexDoc(room: StoredRoom): GameRow {
  return { code: room.code, mode: room.mode, status: room.status, summary: summary(room), createdAt: room.createdAt, updatedAt: room.updatedAt };
}

export async function listGames(store: Store): Promise<GameRow[]> {
  const docs = await store.listCol('games');
  return docs.map((d) => d.data as GameRow).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteGame(store: Store, code: string): Promise<void> {
  for (const d of await store.listCol(intentsPath(code))) await store.delDoc(`${intentsPath(code)}/${d.id}`);
  await store.delDoc(roomPath(code));
  await store.delDoc(gamePath(code));
}

// ───────────────────────────── host ─────────────────────────────

/** Runs the game for everyone. Exactly one of these exists per room (in the host's browser). */
export class HostSession {
  room: StoredRoom;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private botFailures = 0;
  /** Called after the host changes the room by itself (computer moves, timers). */
  onChange: () => void = () => {};
  private unsub: Unsub | null = null;
  private saving = false;
  private dirty = false;
  private stopped = false;
  private lastIndex = '';

  constructor(
    private store: Store,
    room: StoredRoom,
    private me: string,
    private env: Env,
    private onError: (e: unknown) => void = () => {},
  ) {
    this.room = JSON.parse(JSON.stringify(room));
  }

  start() {
    this.unsub = this.store.watchCol(intentsPath(this.room.code), (docs) => this.onIntents(docs), this.onError);
    this.afterChange();
    return this;
  }

  stop() {
    this.stopped = true;
    this.unsub?.();
    if (this.timer) clearTimeout(this.timer);
    if (this.botTimer) clearTimeout(this.botTimer);
  }

  /** The host's own device acts directly, without going through the intent document. */
  exec(clientId: string, event: string, payload: any): void {
    const err = handleEvent(this.room, clientId, event, payload, this.env);
    if (err) throw new Error(err);
    this.commit();
  }

  private onIntents(docs: { id: string; data: any }[]) {
    if (this.stopped) return;
    let changed = false;
    for (const d of docs) {
      const n = Number(d.data?.n);
      if (!Number.isFinite(n) || n <= (this.room.processed[d.id] ?? 0)) continue;
      // A request left over from a host that went away is not applied later; its sender was told it timed out.
      const stale = this.env.now() - Number(d.data.ts ?? 0) > STALE_INTENT_MS;
      const err = stale ? 'That request expired. Please try again.' : handleEvent(this.room, d.id, String(d.data.event), d.data.payload, this.env);
      this.room.processed[d.id] = n;
      this.room.acks[d.id] = err ? { n, ok: false, error: err } : { n, ok: true };
      changed = true;
    }
    if (changed) this.commit();
  }

  private commit() {
    this.room.rev++;
    this.room.updatedAt = this.env.now();
    this.afterChange();
    this.requestSave();
  }

  private afterChange() {
    const g = this.room.game;
    if (g && g.status === 'finished') this.room.status = 'finished';
    this.schedule();
    this.scheduleBot();
  }

  /** Lets the computer players take their next move after a short, human-friendly pause. */
  private scheduleBot() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    if (this.stopped || this.botFailures >= 3) return;
    const g = this.room.game;
    const bots = new Set(this.room.seats.filter((s) => s.bot).map((s) => s.id));
    if (!g || !bots.size) return;
    const move = nextBotAction(g, bots);
    if (!move) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const cur = this.room.game;
      const m = cur && nextBotAction(cur, bots);
      if (!cur || !m) return this.scheduleBot();
      try {
        this.room.game = applyAction(cur, { ...m.action, actor: m.actor } as ActorAction, { now: this.env.now() });
        this.botFailures = 0;
      } catch (e) {
        if (!(e instanceof GameError)) console.error('Computer player crashed', e);
        this.botFailures++;
      }
      this.commit();
      this.onChange();
    }, botDelay(move));
  }

  /** Fires auction timeouts and the timed-game buzzer. */
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped) return;
    const next = nextDeadline(this.room);
    if (!next) return;
    const delay = Math.max(0, Math.min(next.at - this.env.now() + 50, 2 ** 31 - 1));
    this.timer = setTimeout(() => {
      runSystem(this.room, next.type, this.env.now());
      this.commit();
      this.onChange();
    }, delay);
  }

  private requestSave() {
    this.dirty = true;
    if (!this.saving) void this.flush();
  }

  /** One write at a time, always the newest state. */
  private async flush() {
    this.saving = true;
    try {
      while (this.dirty && !this.stopped) {
        this.dirty = false;
        const stored = toStored(this.room);
        await this.store.setDoc(roomPath(this.room.code), stored);
        const idx = indexDoc(this.room);
        const key = `${idx.status}|${idx.summary.turn}|${idx.summary.paused}|${idx.summary.players.length}`;
        if (key !== this.lastIndex) {
          this.lastIndex = key;
          await this.store.setDoc(gamePath(this.room.code), idx);
        }
      }
    } catch (e) {
      this.onError(e);
    } finally {
      this.saving = false;
    }
  }

  /** Resolves once everything applied so far has been written. */
  async flushed(): Promise<void> {
    while (this.saving || this.dirty) await new Promise((r) => setTimeout(r, 5));
  }
}

// ───────────────────────────── client ─────────────────────────────

type Listener = () => void;

/** One open room, as seen from this browser. Host or guest is decided by the document. */
export class RoomClient {
  room: StoredRoom | null = null;
  error: string | null = null;
  session: HostSession | null = null;
  /** Clients currently present in the room, or null when presence is unavailable. */
  connected: Set<string> | null = null;

  private listeners = new Set<Listener>();
  private waiters = new Set<() => void>();
  private unsub: Unsub | null = null;
  private counter = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private ackTimeoutMs: number;

  constructor(
    private store: Store,
    readonly code: string,
    private me: string,
    private onFatal: (e: unknown) => void = () => {},
    opts: { ackTimeoutMs?: number } = {},
  ) {
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 10_000;
  }

  get env(): Env {
    return {
      now: () => Date.now(),
      uid: () => randomId().slice(0, 8),
      isConnected: (id) => id === this.me || !this.connected || this.connected.has(id),
    };
  }

  start() {
    this.unsub = this.store.watchDoc(
      roomPath(this.code),
      (doc) => this.onDoc(doc),
      (e) => {
        this.error = 'Lost the connection to the shared game data.';
        this.notify();
        this.onFatal(e);
      },
    );
    return this;
  }

  stop() {
    this.unsub?.();
    this.session?.stop();
    this.session = null;
    this.listeners.clear();
  }

  subscribe(fn: Listener): Unsub {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  setConnected(set: Set<string> | null) {
    this.connected = set;
    this.notify();
  }

  view(): RoomView | null {
    return this.room ? toView(this.room, this.connected, this.me) : null;
  }

  private notify() {
    for (const l of [...this.listeners]) l();
  }

  private onDoc(doc: StoredRoom | null) {
    if (!doc) {
      this.room = null;
      this.error = `No room with code ${this.code}.`;
      this.session?.stop();
      this.session = null;
      this.notify();
      return;
    }
    this.error = null;
    if (doc.hostId === this.me) {
      // This browser is (or just became) the host: load the document once and own the state from then on.
      if (!this.session) {
        const session = new HostSession(this.store, doc, this.me, this.env, this.onFatal);
        session.onChange = () => {
          this.room = session.room;
          this.notify();
        };
        this.session = session.start();
      }
      this.room = this.session.room;
    } else {
      if (this.session) {
        this.session.stop();
        this.session = null;
      }
      this.room = doc;
    }
    for (const w of [...this.waiters]) w();
    this.notify();
  }

  /**
   * Sends a request. The host applies it directly; guests write an intent and wait for the host's ack.
   * Requests from one browser are strictly serialised.
   */
  call(event: string, payload: any): Promise<{ ok: true }> {
    const run = () => this.callNow(event, payload);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  private async callNow(event: string, payload: any): Promise<{ ok: true }> {
    if (event === 'room:takeover') return this.doTakeover();
    if (this.session) {
      this.session.exec(this.me, event, payload);
      this.room = this.session.room;
      this.notify();
      return { ok: true };
    }
    if (!this.room) throw new Error('Room not loaded yet.');
    const n = ++this.counter;
    await this.store.setDoc(`${intentsPath(this.code)}/${this.me}`, { n, event, payload: payload ?? {}, ts: Date.now() });
    const ack = await this.waitAck(n);
    if (!ack.ok) throw new Error(ack.error ?? 'Request failed');
    return { ok: true };
  }

  private waitAck(n: number): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const a = this.room?.acks?.[this.me];
        if (a && a.n >= n) {
          done();
          resolve(a);
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error('The host did not respond. They may have left the game. Try again, or use "Take over as host".'));
      }, this.ackTimeoutMs);
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
      };
      this.waiters.add(check);
      check();
    });
  }

  /** The current host is gone: this browser becomes the host and carries on from the saved state. */
  private async doTakeover(): Promise<{ ok: true }> {
    const doc: StoredRoom | null = await this.store.getDoc(roomPath(this.code));
    if (!doc) throw new Error(`No room with code ${this.code}.`);
    const err = takeover(doc, this.me, this.env);
    if (err) throw new Error(err);
    doc.rev++;
    doc.updatedAt = Date.now();
    await this.store.setDoc(roomPath(this.code), toStored(doc));
    return { ok: true };
  }
}
