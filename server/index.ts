import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import {
  DEFAULT_CONFIG,
  GameError,
  applyAction,
  createGame,
  type ActorAction,
  type GameConfig,
  type GameState,
} from '../src/engine/index';
import { MAX_SEATS, MIN_SEATS, type Ack, type ClientToServer, type RoomMode, type RoomView, type Seat, type ServerToClient } from '../src/engine/room';
import { store } from './db';

const PORT = Number(process.env.PORT ?? 3001);

interface Room {
  code: string;
  mode: RoomMode;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  seats: Seat[];
  config: GameConfig;
  game: GameState | null;
  createdAt: number;
  updatedAt: number;
}

const rooms = new Map<string, Room>();
/** code -> clientId -> number of live sockets */
const presence = new Map<string, Map<string, number>>();
const timers = new Map<string, NodeJS.Timeout>();
const saveTimers = new Map<string, NodeJS.Timeout>();

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server<ClientToServer, ServerToClient>(server, { cors: { origin: true }, maxHttpBufferSize: 5e6 });

// ───────────────────────────── helpers ─────────────────────────────

function newCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += alphabet[crypto.randomInt(alphabet.length)];
    if (!rooms.has(c) && !store.load(c)) return c;
  }
}

function isConnected(code: string, clientId: string) {
  return (presence.get(code)?.get(clientId) ?? 0) > 0;
}

function view(room: Room): RoomView {
  return {
    code: room.code,
    mode: room.mode,
    hostId: room.hostId,
    hostConnected: isConnected(room.code, room.hostId),
    status: room.status,
    seats: room.seats.map((s) => ({ ...s, connected: isConnected(room.code, s.controllerId) })),
    config: room.config,
    game: room.game,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}

function summary(room: Room) {
  const g = room.game;
  return {
    players: room.seats.map((s) => ({ name: s.name, token: s.token, color: s.color })),
    winner: g?.winner ? g.players.find((p) => p.id === g.winner)?.name : null,
    turn: g?.turn.number ?? 0,
    gameMode: room.config.mode,
    paused: !!g?.paused,
  };
}

function persist(room: Room, immediate = false) {
  room.updatedAt = Date.now();
  const doSave = () => {
    saveTimers.delete(room.code);
    store.save({
      code: room.code,
      mode: room.mode,
      status: room.status,
      hostId: room.hostId,
      summary: summary(room),
      data: room,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    });
  };
  clearTimeout(saveTimers.get(room.code));
  if (immediate) doSave();
  else saveTimers.set(room.code, setTimeout(doSave, 200));
}

function broadcast(room: Room) {
  io.to(room.code).emit('room:state', view(room));
}

function getRoom(code: string): Room | null {
  const c = String(code ?? '').toUpperCase().trim();
  let room = rooms.get(c);
  if (!room) {
    const data = store.load(c) as Room | null;
    if (!data) return null;
    room = { ...data, config: { ...DEFAULT_CONFIG, ...data.config } };
    rooms.set(c, room);
    scheduleTimers(room);
  }
  return room;
}

function updated(room: Room, immediate = false) {
  if (room.game && room.game.status === 'finished') room.status = 'finished';
  persist(room, immediate);
  broadcast(room);
  scheduleTimers(room);
}

/** Runs time-based system actions (auction close, timed game end). */
function scheduleTimers(room: Room) {
  clearTimeout(timers.get(room.code));
  timers.delete(room.code);
  const g = room.game;
  if (!g || g.status !== 'playing' || g.paused) return;
  const deadlines: { at: number; type: 'auctionTimeout' | 'timeUp' }[] = [];
  if (g.auction?.endsAt != null) deadlines.push({ at: g.auction.endsAt, type: 'auctionTimeout' });
  if (g.config.mode === 'timed' && g.endsAt != null) deadlines.push({ at: g.endsAt, type: 'timeUp' });
  if (!deadlines.length) return;
  deadlines.sort((a, b) => a.at - b.at);
  const next = deadlines[0];
  const delay = Math.max(0, Math.min(next.at - Date.now() + 50, 2 ** 31 - 1));
  timers.set(
    room.code,
    setTimeout(() => {
      const r = rooms.get(room.code);
      if (!r?.game) return;
      try {
        r.game = applyAction(r.game, { type: next.type, actor: 'system' } as ActorAction, { now: Date.now() });
      } catch (e) {
        if (!(e instanceof GameError)) console.error(e);
      }
      updated(r);
    }, delay),
  );
}

function ok<T extends object>(cb: ((r: Ack<T>) => void) | undefined, extra?: T) {
  cb?.({ ok: true, ...(extra ?? ({} as T)) });
}
function err(cb: ((r: Ack<any>) => void) | undefined, error: string) {
  cb?.({ ok: false, error });
}

function sanitizeName(n: unknown): string {
  return String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function sanitizeConfig(c: Partial<GameConfig>, base: GameConfig): GameConfig {
  const num = (v: unknown, min: number, max: number, d: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const names: Record<number, string> = {};
  for (const [k, v] of Object.entries(c.spaceNames ?? base.spaceNames ?? {})) {
    const i = Number(k);
    const t = String(v ?? '').trim().slice(0, 28);
    if (i >= 0 && i < 40 && t) names[i] = t;
  }
  return {
    ...base,
    startingCash: num(c.startingCash ?? base.startingCash, 100, 100000, 1500),
    goSalary: num(c.goSalary ?? base.goSalary, 0, 10000, 200),
    mode: c.mode === 'timed' || c.mode === 'classic' ? c.mode : base.mode,
    durationMinutes: num(c.durationMinutes ?? base.durationMinutes, 5, 600, 60),
    auctionSeconds: num(c.auctionSeconds ?? base.auctionSeconds, 0, 120, 15),
    currency: String(c.currency ?? base.currency).trim().slice(0, 4) || '$',
    spaceNames: names,
  };
}

// ───────────────────────────── sockets ─────────────────────────────

io.on('connection', (socket: Socket<ClientToServer, ServerToClient>) => {
  const joined = new Map<string, string>(); // code -> clientId

  function attach(room: Room, clientId: string) {
    if (joined.has(room.code)) return;
    joined.set(room.code, clientId);
    socket.join(room.code);
    const m = presence.get(room.code) ?? new Map();
    m.set(clientId, (m.get(clientId) ?? 0) + 1);
    presence.set(room.code, m);
  }

  function detach(code: string) {
    const clientId = joined.get(code);
    if (!clientId) return;
    joined.delete(code);
    socket.leave(code);
    const m = presence.get(code);
    if (m) {
      const n = (m.get(clientId) ?? 1) - 1;
      if (n <= 0) m.delete(clientId);
      else m.set(clientId, n);
    }
    const room = rooms.get(code);
    if (room) broadcast(room);
  }

  /** Resolve the room + caller identity for an event. */
  function ctx(code: string) {
    const room = getRoom(code);
    if (!room) return { error: 'Room not found.' as const };
    const clientId = joined.get(room.code);
    if (!clientId) return { error: 'Join the room first.' as const };
    return { room, clientId, isHost: room.hostId === clientId };
  }

  socket.on('room:create', ({ clientId, mode }, cb) => {
    if (!clientId) return err(cb, 'Missing client id.');
    const code = newCode();
    const now = Date.now();
    const room: Room = {
      code,
      mode: mode === 'online' ? 'online' : 'local',
      hostId: clientId,
      status: 'lobby',
      seats: [],
      config: { ...DEFAULT_CONFIG },
      game: null,
      createdAt: now,
      updatedAt: now,
    };
    rooms.set(code, room);
    attach(room, clientId);
    updated(room, true);
    ok(cb, { code });
  });

  socket.on('room:join', ({ clientId, code }, cb) => {
    if (!clientId) return err(cb, 'Missing client id.');
    const room = getRoom(code);
    if (!room) return err(cb, `No room with code ${String(code).toUpperCase()}.`);
    attach(room, clientId);
    broadcast(room);
    ok(cb, { code: room.code });
  });

  socket.on('room:leave', ({ code }) => detach(String(code).toUpperCase()));

  socket.on('seat:add', ({ code, name, token, color }, cb) => {
    const c = ctx(code);
    if ('error' in c) return err(cb, c.error!);
    const { room, clientId, isHost } = c;
    if (room.status !== 'lobby') return err(cb, 'The game has already started.');
    if (room.mode === 'local' && !isHost) return err(cb, 'In a local game only the host device adds players.');
    if (room.seats.length >= MAX_SEATS) return err(cb, `The table is full (${MAX_SEATS} players).`);
    const n = sanitizeName(name);
    if (!n) return err(cb, 'Enter a name.');
    if (room.seats.some((s) => s.name.toLowerCase() === n.toLowerCase())) return err(cb, 'That name is taken.');
    if (!token || room.seats.some((s) => s.token === token)) return err(cb, 'That token is taken — pick another.');
    room.seats.push({ id: crypto.randomUUID().slice(0, 8), name: n, token: String(token), color: String(color || '#888'), controllerId: clientId });
    updated(room);
    ok(cb);
  });

  socket.on('seat:update', ({ code, seatId, name, token, color }, cb) => {
    const c = ctx(code);
    if ('error' in c) return err(cb, c.error!);
    const { room, clientId, isHost } = c;
    if (room.status !== 'lobby') return err(cb, 'The game has already started.');
    const seat = room.seats.find((s) => s.id === seatId);
    if (!seat) return err(cb, 'Seat not found.');
    if (seat.controllerId !== clientId && !isHost) return err(cb, 'That is not your seat.');
    const n = sanitizeName(name);
    if (!n) return err(cb, 'Enter a name.');
    if (room.seats.some((s) => s.id !== seatId && s.name.toLowerCase() === n.toLowerCase())) return err(cb, 'That name is taken.');
    if (room.seats.some((s) => s.id !== seatId && s.token === token)) return err(cb, 'That token is taken.');
    Object.assign(seat, { name: n, token, color });
    updated(room);
    ok(cb);
  });

  socket.on('seat:remove', ({ code, seatId }, cb) => {
    const c = ctx(code);
    if ('error' in c) return err(cb, c.error!);
    const { room, clientId, isHost } = c;
    if (room.status !== 'lobby') return err(cb, 'Players cannot leave a game in progress (they can go bankrupt instead).');
    const seat = room.seats.find((s) => s.id === seatId);
    if (!seat) return err(cb, 'Seat not found.');
    if (seat.controllerId !== clientId && !isHost) return err(cb, 'Only the host can remove other players.');
    room.seats = room.seats.filter((s) => s.id !== seatId);
    updated(room);
    ok(cb);
  });

  socket.on('seat:claim', ({ code, seatId }, cb) => {
    const c = ctx(code);
    if ('error' in c) return err(cb, c.error!);
    const { room, clientId } = c;
    const seat = room.seats.find((s) => s.id === seatId);
    if (!seat) return err(cb, 'Seat not found.');
    if (seat.controllerId === clientId) return ok(cb);
    if (isConnected(room.code, seat.controllerId)) return err(cb, 'That player is still connected on another device.');
    const old = seat.controllerId;
    seat.controllerId = clientId;
    if (room.hostId === old && !isConnected(room.code, old)) room.hostId = clientId;
    updated(room);
    ok(cb);
  });

  socket.on('room:takeover', ({ code }, cb) => {
    const c = ctx(code);
    if ('error' in c) return err(cb, c.error!);
    const { room, clientId } = c;
    if (room.hostId === clientId) return ok(cb);
    if (isConnected(room.code, room.hostId)) return err(cb, 'The host is still connected.');
    const old = room.hostId;
    room.hostId = clientId;
    for (const s of room.seats) if (s.controllerId === old || !isConnected(room.code, s.controllerId)) {
      if (room.mode === 'local' || s.controllerId === old) s.controllerId = clientId;
    }
    updated(room, true);
    ok(cb);
  });

  socket.on('room:config', ({ code, config }, cb) => {
    const c = ctx(code);
    if ('error' in c) return err(cb, c.error!);
    if (!c.isHost) return err(cb, 'Only the host can change settings.');
    if (c.room.status !== 'lobby') return err(cb, 'Settings are locked once the game starts.');
    c.room.config = sanitizeConfig(config ?? {}, c.room.config);
    updated(c.room);
    ok(cb);
  });

  function startGame(room: Room) {
    room.game = createGame({
      id: room.code,
      players: room.seats.map((s) => ({ id: s.id, name: s.name, token: s.token, color: s.color })),
      config: room.config,
      now: Date.now(),
    });
    room.status = 'playing';
  }

  socket.on('room:start', ({ code }, cb) => {
    const c = ctx(code);
    if ('error' in c) return err(cb, c.error!);
    if (!c.isHost) return err(cb, 'Only the host can start the game.');
    if (c.room.status !== 'lobby') return err(cb, 'The game already started.');
    if (c.room.seats.length < MIN_SEATS || c.room.seats.length > MAX_SEATS) return err(cb, `You need ${MIN_SEATS}–${MAX_SEATS} players to start.`);
    try {
      startGame(c.room);
    } catch (e) {
      return err(cb, (e as Error).message);
    }
    updated(c.room, true);
    ok(cb);
  });

  socket.on('room:restart', ({ code }, cb) => {
    const c = ctx(code);
    if ('error' in c) return err(cb, c.error!);
    if (!c.isHost) return err(cb, 'Only the host can restart.');
    if (!c.room.game) return err(cb, 'No game to restart.');
    startGame(c.room);
    updated(c.room, true);
    ok(cb);
  });

  const systemAction = (type: 'pause' | 'resume' | 'endGame') => (p: { code: string }, cb: (r: Ack) => void) => {
    const c = ctx(p.code);
    if ('error' in c) return err(cb, c.error!);
    if (!c.isHost) return err(cb, 'Only the host can do that.');
    if (!c.room.game) return err(cb, 'No game in progress.');
    try {
      c.room.game = applyAction(c.room.game, { type, actor: 'system' } as ActorAction, { now: Date.now() });
    } catch (e) {
      return err(cb, (e as Error).message);
    }
    updated(c.room, true);
    ok(cb);
  };
  socket.on('room:pause', systemAction('pause'));
  socket.on('room:resume', systemAction('resume'));
  socket.on('room:endGame', systemAction('endGame'));

  socket.on('game:action', ({ code, action }, cb) => {
    const c = ctx(code);
    if ('error' in c) return err(cb, c.error!);
    const { room, clientId } = c;
    if (!room.game) return err(cb, 'The game has not started.');
    if (!action || typeof action.type !== 'string') return err(cb, 'Invalid action.');
    if (['pause', 'resume', 'timeUp', 'auctionTimeout', 'endGame'].includes(action.type)) return err(cb, 'Not allowed.');
    const seat = room.seats.find((s) => s.id === action.actor);
    if (!seat) return err(cb, 'Unknown player.');
    if (seat.controllerId !== clientId) return err(cb, `You are not controlling ${seat.name}.`);
    try {
      room.game = applyAction(room.game, action as ActorAction, { now: Date.now() });
    } catch (e) {
      if (e instanceof GameError) return err(cb, e.message);
      console.error('Engine crash', e);
      return err(cb, 'Internal error — the action was not applied.');
    }
    updated(room);
    ok(cb);
  });

  socket.on('disconnect', () => {
    for (const code of [...joined.keys()]) detach(code);
  });
});

// ───────────────────────────── REST + static ─────────────────────────────

app.get('/api/games', (_req, res) => res.json(store.list()));
app.delete('/api/games/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const m = presence.get(code);
  if (m && m.size > 0) return res.status(409).json({ error: 'Players are still connected to this room.' });
  rooms.delete(code);
  clearTimeout(timers.get(code));
  store.remove(code);
  res.json({ ok: true });
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const dist = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

function flushAll() {
  for (const room of rooms.values()) if (saveTimers.has(room.code)) persist(room, true);
}
process.on('SIGINT', () => {
  flushAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  flushAll();
  process.exit(0);
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i!.address}:${PORT}`);
  console.log(`\n  Estate Empire server running on http://localhost:${PORT}`);
  if (fs.existsSync(dist)) {
    console.log('  Serving the built game. Other laptops on your network can join at:');
    for (const u of lan) console.log(`    ${u}`);
  } else console.log('  (No dist/ build found — use `npm run dev` and open http://localhost:5173)');
  console.log('');
});
