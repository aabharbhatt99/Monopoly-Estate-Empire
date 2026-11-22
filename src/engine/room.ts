import type { GameConfig, GameState } from './types';

/** Shared room/lobby model used by server and client. */
export type RoomMode = 'local' | 'online';

export interface Seat {
  id: string;
  name: string;
  token: string;
  color: string;
  /** clientId of the device controlling this seat. */
  controllerId: string;
  /** Computer player: the host's browser plays its moves. */
  bot?: boolean;
}

export interface RoomView {
  code: string;
  mode: RoomMode;
  hostId: string;
  hostConnected: boolean;
  status: 'lobby' | 'playing' | 'finished';
  seats: (Seat & { connected: boolean })[];
  config: GameConfig;
  game: GameState | null;
  createdAt: number;
  updatedAt: number;
}

export const MIN_SEATS = 4;
export const MAX_SEATS = 10;

export const BOT_NAMES = ['Ada', 'Turing', 'Hopper', 'Deep Blue', 'Robo', 'Chip', 'Pixel', 'Bolt', 'Nova', 'Sparky', 'Cog', 'Byte'];

export const TOKENS = ['🚀', '🦊', '🐙', '🎸', '⚓', '👑', '🦄', '🐢', '🌵', '🍀', '🏎️', '🦉', '🎩', '🐉', '🍩', '⭐'];
export const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b', '#84cc16', '#0ea5e9'];

export interface ClientToServer {
  'room:create': (p: { clientId: string; mode: RoomMode }, cb: (r: Ack<{ code: string }>) => void) => void;
  'room:join': (p: { clientId: string; code: string }, cb: (r: Ack<{ code: string }>) => void) => void;
  'room:leave': (p: { code: string }) => void;
  'seat:add': (p: { code: string; name: string; token: string; color: string }, cb: (r: Ack) => void) => void;
  'seat:update': (p: { code: string; seatId: string; name: string; token: string; color: string }, cb: (r: Ack) => void) => void;
  'seat:addBot': (p: { code: string }, cb: (r: Ack) => void) => void;
  'seat:remove': (p: { code: string; seatId: string }, cb: (r: Ack) => void) => void;
  'seat:claim': (p: { code: string; seatId: string }, cb: (r: Ack) => void) => void;
  'room:takeover': (p: { code: string }, cb: (r: Ack) => void) => void;
  'room:config': (p: { code: string; config: Partial<GameConfig> }, cb: (r: Ack) => void) => void;
  'room:start': (p: { code: string }, cb: (r: Ack) => void) => void;
  'room:pause': (p: { code: string }, cb: (r: Ack) => void) => void;
  'room:resume': (p: { code: string }, cb: (r: Ack) => void) => void;
  'room:restart': (p: { code: string }, cb: (r: Ack) => void) => void;
  'room:endGame': (p: { code: string }, cb: (r: Ack) => void) => void;
  'game:action': (p: { code: string; action: any }, cb: (r: Ack) => void) => void;
}

export interface ServerToClient {
  'room:state': (room: RoomView) => void;
  'room:kicked': (p: { code: string; reason: string }) => void;
}

export type Ack<T = {}> = ({ ok: true } & T) | { ok: false; error: string };
