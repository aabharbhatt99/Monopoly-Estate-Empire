/**
 * Room rules that used to live in the Node server. They are pure functions over a StoredRoom, run by
 * whichever browser is the room's host. Every function returns an error message or null; on error the
 * room is left unchanged.
 */
import { DEFAULT_CONFIG, GameError, applyAction, createGame, type ActorAction, type GameConfig, type GameState } from '../engine';
import { BOT_NAMES, COLORS, MAX_SEATS, MIN_SEATS, TOKENS, type RoomMode, type RoomView, type Seat } from '../engine/room';

export interface Ack {
  n: number;
  ok: boolean;
  error?: string;
}

export interface StoredRoom {
  code: string;
  mode: RoomMode;
  hostId: string;
  status: 'lobby' | 'playing' | 'finished';
  seats: Seat[];
  config: GameConfig;
  game: GameState | null;
  createdAt: number;
  updatedAt: number;
  /** Bumped on every change; a newer host or a takeover always wins by rev. */
  rev: number;
  /** Highest intent number already applied, per client (makes replays after a host reload harmless). */
  processed: Record<string, number>;
  /** Result of each client's latest request. */
  acks: Record<string, Ack>;
}

export interface Env {
  now(): number;
  uid(): string;
  /** Is this client currently present in the room? Unknown presence counts as connected. */
  isConnected(clientId: string): boolean;
}

export function newRoom(code: string, mode: RoomMode, hostId: string, now: number): StoredRoom {
  return {
    code,
    mode,
    hostId,
    status: 'lobby',
    seats: [],
    config: { ...DEFAULT_CONFIG },
    game: null,
    createdAt: now,
    updatedAt: now,
    rev: 1,
    processed: {},
    acks: {},
  };
}

export function sanitizeName(n: unknown): string {
  return String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

export function sanitizeConfig(c: Partial<GameConfig>, base: GameConfig): GameConfig {
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

function startGame(room: StoredRoom, now: number) {
  room.game = createGame({
    id: room.code,
    players: room.seats.map((s) => ({ id: s.id, name: s.name, token: s.token, color: s.color })),
    config: room.config,
    now,
  });
  room.status = 'playing';
}

const SYSTEM = new Set(['pause', 'resume', 'timeUp', 'auctionTimeout', 'endGame']);

/** Applies one client request to the room. */
export function handleEvent(room: StoredRoom, clientId: string, event: string, p: any, env: Env): string | null {
  const isHost = room.hostId === clientId;
  p = p ?? {};
  switch (event) {
    case 'seat:add': {
      if (room.status !== 'lobby') return 'The game has already started.';
      if (room.mode === 'local' && !isHost) return 'In a local game only the host device adds players.';
      if (room.seats.length >= MAX_SEATS) return `The table is full (${MAX_SEATS} players).`;
      const n = sanitizeName(p.name);
      if (!n) return 'Enter a name.';
      if (room.seats.some((s) => s.name.toLowerCase() === n.toLowerCase())) return 'That name is taken.';
      if (!p.token || room.seats.some((s) => s.token === p.token)) return 'That token is taken — pick another.';
      room.seats.push({ id: env.uid(), name: n, token: String(p.token), color: String(p.color || '#888'), controllerId: clientId });
      return null;
    }
    case 'seat:addBot': {
      if (room.status !== 'lobby') return 'The game has already started.';
      if (!isHost) return 'Only the host can add computer players.';
      if (room.seats.length >= MAX_SEATS) return `The table is full (${MAX_SEATS} players).`;
      const names = new Set(room.seats.map((s) => s.name.toLowerCase()));
      const name = BOT_NAMES.find((n) => !names.has(n.toLowerCase())) ?? `Bot ${room.seats.length + 1}`;
      const token = TOKENS.find((t) => !room.seats.some((s) => s.token === t));
      if (!token) return 'No tokens left.';
      const color = COLORS.find((c) => !room.seats.some((s) => s.color === c)) ?? COLORS[room.seats.length % COLORS.length];
      room.seats.push({ id: env.uid(), name, token, color, controllerId: clientId, bot: true });
      return null;
    }
    case 'seat:update': {
      if (room.status !== 'lobby') return 'The game has already started.';
      const seat = room.seats.find((s) => s.id === p.seatId);
      if (!seat) return 'Seat not found.';
      if (seat.controllerId !== clientId && !isHost) return 'That is not your seat.';
      const n = sanitizeName(p.name);
      if (!n) return 'Enter a name.';
      if (room.seats.some((s) => s.id !== p.seatId && s.name.toLowerCase() === n.toLowerCase())) return 'That name is taken.';
      if (room.seats.some((s) => s.id !== p.seatId && s.token === p.token)) return 'That token is taken.';
      Object.assign(seat, { name: n, token: p.token, color: p.color });
      return null;
    }
    case 'seat:remove': {
      if (room.status !== 'lobby') return 'Players cannot leave a game in progress (they can go bankrupt instead).';
      const seat = room.seats.find((s) => s.id === p.seatId);
      if (!seat) return 'Seat not found.';
      if (seat.controllerId !== clientId && !isHost) return 'Only the host can remove other players.';
      room.seats = room.seats.filter((s) => s.id !== p.seatId);
      return null;
    }
    case 'seat:claim': {
      const seat = room.seats.find((s) => s.id === p.seatId);
      if (!seat) return 'Seat not found.';
      if (seat.bot) return 'That seat is played by the computer.';
      if (seat.controllerId === clientId) return null;
      if (env.isConnected(seat.controllerId)) return 'That player is still connected on another device.';
      seat.controllerId = clientId;
      return null;
    }
    case 'room:config': {
      if (!isHost) return 'Only the host can change settings.';
      if (room.status !== 'lobby') return 'Settings are locked once the game starts.';
      room.config = sanitizeConfig(p.config ?? {}, room.config);
      return null;
    }
    case 'room:start': {
      if (!isHost) return 'Only the host can start the game.';
      if (room.status !== 'lobby') return 'The game already started.';
      if (room.seats.length < MIN_SEATS || room.seats.length > MAX_SEATS) return `You need ${MIN_SEATS}–${MAX_SEATS} players to start.`;
      try {
        startGame(room, env.now());
      } catch (e) {
        return (e as Error).message;
      }
      return null;
    }
    case 'room:restart': {
      if (!isHost) return 'Only the host can restart.';
      if (!room.game) return 'No game to restart.';
      startGame(room, env.now());
      return null;
    }
    case 'room:pause':
    case 'room:resume':
    case 'room:endGame': {
      if (!isHost) return 'Only the host can do that.';
      if (!room.game) return 'No game in progress.';
      const type = event.slice(5) as 'pause' | 'resume' | 'endGame';
      try {
        room.game = applyAction(room.game, { type, actor: 'system' } as ActorAction, { now: env.now() });
      } catch (e) {
        return (e as Error).message;
      }
      return null;
    }
    case 'game:action': {
      const action = p.action;
      if (!room.game) return 'The game has not started.';
      if (!action || typeof action.type !== 'string') return 'Invalid action.';
      if (SYSTEM.has(action.type)) return 'Not allowed.';
      const seat = room.seats.find((s) => s.id === action.actor);
      if (!seat) return 'Unknown player.';
      if (seat.bot) return `${seat.name} is a computer player.`;
      if (seat.controllerId !== clientId) return `You are not controlling ${seat.name}.`;
      try {
        room.game = applyAction(room.game, action as ActorAction, { now: env.now() });
      } catch (e) {
        if (e instanceof GameError) return e.message;
        console.error('Engine crash', e);
        return 'Internal error — the action was not applied.';
      }
      return null;
    }
    default:
      return 'Unknown request.';
  }
}

/** A guest takes over hosting when the current host has left. Runs in the guest's browser. */
export function takeover(room: StoredRoom, clientId: string, env: Env): string | null {
  if (room.hostId === clientId) return null;
  if (env.isConnected(room.hostId)) return 'The host is still connected.';
  const old = room.hostId;
  room.hostId = clientId;
  for (const s of room.seats) {
    if (s.controllerId === old || (room.mode === 'local' && !env.isConnected(s.controllerId))) s.controllerId = clientId;
  }
  return null;
}

/** Next time-based system action the host must fire, if any. */
export function nextDeadline(room: StoredRoom): { at: number; type: 'auctionTimeout' | 'timeUp' } | null {
  const g = room.game;
  if (!g || g.status !== 'playing' || g.paused) return null;
  const list: { at: number; type: 'auctionTimeout' | 'timeUp' }[] = [];
  if (g.auction?.endsAt != null) list.push({ at: g.auction.endsAt, type: 'auctionTimeout' });
  if (g.config.mode === 'timed' && g.endsAt != null) list.push({ at: g.endsAt, type: 'timeUp' });
  list.sort((a, b) => a.at - b.at);
  return list[0] ?? null;
}

export function runSystem(room: StoredRoom, type: 'auctionTimeout' | 'timeUp', now: number) {
  if (!room.game) return;
  try {
    room.game = applyAction(room.game, { type, actor: 'system' } as ActorAction, { now });
  } catch (e) {
    if (!(e instanceof GameError)) console.error(e);
  }
}

export function summary(room: StoredRoom) {
  const g = room.game;
  return {
    players: room.seats.map((s) => ({ name: s.name, token: s.token, color: s.color })),
    winner: g?.winner ? g.players.find((p) => p.id === g.winner)?.name ?? null : null,
    turn: g?.turn.number ?? 0,
    gameMode: room.config.mode,
    paused: !!g?.paused,
  };
}

/**
 * The shared database holds documents of at most 256 KiB, so the long histories are trimmed in the
 * stored copy. The host keeps the full state in memory.
 */
export function toStored(room: StoredRoom): StoredRoom {
  const copy: StoredRoom = JSON.parse(JSON.stringify(room));
  const g = copy.game;
  if (g) {
    g.transactions = g.transactions.slice(-400);
    g.log = g.log.slice(-150);
    g.trades = g.trades.slice(-30);
    if (JSON.stringify(copy).length > 200_000) {
      g.transactions = g.transactions.slice(-80);
      g.log = g.log.slice(-40);
    }
  }
  return copy;
}

export function toView(room: StoredRoom, connected: ReadonlySet<string> | null, me: string): RoomView {
  const on = (id: string) => id === me || !connected || connected.has(id);
  return {
    code: room.code,
    mode: room.mode,
    hostId: room.hostId,
    hostConnected: on(room.hostId),
    status: room.status,
    seats: room.seats.map((s) => ({ ...s, connected: s.bot ? true : on(s.controllerId) })),
    config: room.config,
    game: room.game,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}
