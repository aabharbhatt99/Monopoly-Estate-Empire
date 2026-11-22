import { applyAction, createGame, type ActorAction, type GameState, type GameAction, GameError } from '../src/engine';

export const NOW = 1_700_000_000_000;

export function newGame(n = 6, config: Parameters<typeof createGame>[0]['config'] = {}): GameState {
  const tokens = ['🚀', '🦊', '🐙', '🎸', '⚓', '👑', '🦄', '🐢', '🌵', '🍀'];
  const s = createGame({
    id: 'test',
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, token: tokens[i], color: '#000' })),
    config,
    seed: 42,
    now: NOW,
  });
  // Normalize seating order so tests are predictable: p0, p1, ...
  s.players.sort((a, b) => a.id.localeCompare(b.id));
  s.currentPlayer = 'p0';
  return s;
}

export function act(s: GameState, actor: string, action: GameAction, opts: { dice?: [number, number]; now?: number } = {}): GameState {
  return applyAction(s, { ...action, actor } as ActorAction, { now: opts.now ?? NOW, dice: opts.dice });
}

export function roll(s: GameState, d1: number, d2: number): GameState {
  return act(s, s.currentPlayer, { type: 'roll' }, { dice: [d1, d2] });
}

export function expectError(fn: () => unknown, match?: RegExp) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof GameError)) throw e;
    if (match && !match.test(e.message)) throw new Error(`Expected error ${match} but got: ${e.message}`);
    return;
  }
  throw new Error('Expected a GameError but none was thrown');
}

export const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;

/** Give a player a set of properties directly (test setup). */
export function give(s: GameState, id: string, ...spaces: number[]) {
  for (const i of spaces) s.props[i].owner = id;
}
