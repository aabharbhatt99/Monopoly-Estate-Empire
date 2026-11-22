// Estate Empire worker. Static files (dist/) are served by Workers assets; this routes /ws to the
// StoreHub Durable Object, a small shared document store the browser game uses for online rooms.
//
// Protocol (JSON over one WebSocket):
//   client -> { id, op: 'get'|'set'|'del'|'list', path, data? }     server -> { id, ok, data?, error? }
//   client -> { op: 'watch', sub, path, col }                         server -> { t: 'snap', sub, data }
//   client -> { op: 'unwatch', sub }
//   client -> { op: 'presence', room, cid } / { op: 'unpresence', room }   server -> { t: 'peers', room, cids }

const CODE = '[A-Z0-9]{5}';
const DOC_PATH = new RegExp(`^(rooms/${CODE}(/intents/[A-Za-z0-9_-]{1,64})?|games/${CODE})$`);
const COL_PATH = new RegExp(`^(rooms/${CODE}/intents|games)$`);
const MAX_DOC_BYTES = 1_500_000;
const STALE_MS = 60 * 24 * 60 * 60 * 1000; // rooms untouched for 60 days are removed

const parentOf = (p) => p.slice(0, p.lastIndexOf('/'));

export class StoreHub {
  constructor(ctx) {
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, parent TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent)`);
    /** @type {Map<WebSocket, {subs: Map<string, {path: string, col: boolean}>, rooms: Map<string, string>}>} */
    this.conns = new Map();
  }

  async fetch(req) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const conn = { subs: new Map(), rooms: new Map() };
    this.conns.set(server, conn);
    server.addEventListener('message', (e) => this.onMessage(server, conn, e.data));
    const close = () => this.onClose(server, conn);
    server.addEventListener('close', close);
    server.addEventListener('error', close);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 24 * 3600 * 1000);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ── storage ──
  getDoc(path) {
    const r = this.sql.exec('SELECT data FROM docs WHERE path = ?', path).toArray()[0];
    return r ? JSON.parse(r.data) : null;
  }
  listCol(path) {
    return this.sql
      .exec('SELECT path, data FROM docs WHERE parent = ? ORDER BY path', path)
      .toArray()
      .map((r) => ({ id: r.path.slice(path.length + 1), data: JSON.parse(r.data) }));
  }

  // ── messages ──
  onMessage(ws, conn, raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    const reply = (body) => send(ws, { id: m.id, ...body });
    try {
      switch (m.op) {
        case 'get':
          checkDoc(m.path);
          return reply({ ok: true, data: this.getDoc(m.path) });
        case 'list':
          checkCol(m.path);
          return reply({ ok: true, data: this.listCol(m.path) });
        case 'set': {
          checkDoc(m.path);
          const text = JSON.stringify(m.data ?? null);
          if (text.length > MAX_DOC_BYTES) throw new Error('Document too large.');
          this.sql.exec(
            'INSERT INTO docs (path, parent, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, updated = excluded.updated',
            m.path, parentOf(m.path), text, Date.now(),
          );
          reply({ ok: true });
          return this.changed(m.path);
        }
        case 'del':
          checkDoc(m.path);
          this.sql.exec('DELETE FROM docs WHERE path = ?', m.path);
          reply({ ok: true });
          return this.changed(m.path);
        case 'watch': {
          const col = !!m.col;
          col ? checkCol(m.path) : checkDoc(m.path);
          conn.subs.set(String(m.sub), { path: m.path, col });
          return send(ws, { t: 'snap', sub: m.sub, data: col ? this.listCol(m.path) : this.getDoc(m.path) });
        }
        case 'unwatch':
          conn.subs.delete(String(m.sub));
          return;
        case 'presence':
          conn.rooms.set(String(m.room).slice(0, 32), String(m.cid).slice(0, 64));
          return this.peers(String(m.room).slice(0, 32));
        case 'unpresence':
          conn.rooms.delete(String(m.room));
          return this.peers(String(m.room));
      }
    } catch (e) {
      if (m.id != null) reply({ ok: false, error: e.message || 'Request failed.' });
    }
  }

  /** Pushes the new state of `path` (and of its parent collection) to every watcher. */
  changed(path) {
    const parent = parentOf(path);
    let doc, col;
    for (const [ws, conn] of this.conns) {
      for (const [sub, w] of conn.subs) {
        if (!w.col && w.path === path) send(ws, { t: 'snap', sub, data: doc === undefined ? (doc = this.getDoc(path)) : doc });
        else if (w.col && w.path === parent) send(ws, { t: 'snap', sub, data: col === undefined ? (col = this.listCol(parent)) : col });
      }
    }
  }

  peers(room) {
    const cids = new Set();
    for (const conn of this.conns.values()) if (conn.rooms.has(room)) cids.add(conn.rooms.get(room));
    const msg = { t: 'peers', room, cids: [...cids] };
    for (const [ws, conn] of this.conns) if (conn.rooms.has(room)) send(ws, msg);
  }

  onClose(ws, conn) {
    if (!this.conns.delete(ws)) return;
    for (const room of conn.rooms.keys()) this.peers(room);
  }

  async alarm() {
    const cutoff = Date.now() - STALE_MS;
    for (const r of this.sql.exec("SELECT path FROM docs WHERE parent = 'games' AND updated < ?", cutoff).toArray()) {
      const code = r.path.slice('games/'.length);
      this.sql.exec("DELETE FROM docs WHERE path = ? OR path = ? OR parent = ?", `games/${code}`, `rooms/${code}`, `rooms/${code}/intents`);
    }
    await this.ctx.storage.setAlarm(Date.now() + 24 * 3600 * 1000);
  }
}

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    /* socket already closed */
  }
}
function checkDoc(p) {
  if (typeof p !== 'string' || !DOC_PATH.test(p)) throw new Error('Bad path.');
}
function checkCol(p) {
  if (typeof p !== 'string' || !COL_PATH.test(p)) throw new Error('Bad path.');
}

export default {
  fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname !== '/ws') return env.ASSETS.fetch(req);
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    return env.HUB.get(env.HUB.idFromName('global')).fetch(req);
  },
};
