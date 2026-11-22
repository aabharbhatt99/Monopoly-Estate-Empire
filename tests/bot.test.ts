import { describe, expect, it } from 'vitest';
import { applyAction, nextBotAction, type ActorAction } from '../src/engine';
import { newGame, NOW } from './helpers';
import { RoomClient, createRoom } from '../src/client/roomClient';
import { MemStore } from '../src/client/store';

describe('computer players', () => {
  it('play complete games on their own without ever making an illegal move', () => {
    for (let seed = 0; seed < 6; seed++) {
      let s = newGame(4, { mode: 'timed', durationMinutes: 5, auctionSeconds: 0, startingCash: 800 });
      s.rng = seed * 7919 + 1;
      const bots = new Set(s.players.map((p) => p.id));
      let now = NOW;
      for (let i = 0; i < 20000 && s.status === 'playing'; i++) {
        const m = nextBotAction(s, bots);
        if (!m) throw new Error(`bots stalled in phase ${s.phase}`);
        s = applyAction(s, { ...m.action, actor: m.actor } as ActorAction, { now });
        now += 1000; // timed game ends eventually
      }
      expect(s.status).toBe('finished');
    }
  });

  it('does nothing for human players', () => {
    const s = newGame(4);
    expect(nextBotAction(s, new Set())).toBeNull();
    expect(nextBotAction(s, new Set(['p1']))).toBeNull(); // p0 is current
    expect(nextBotAction(s, new Set(['p0']))?.action.type).toBe('roll');
  });

  it('the host can add computer seats, humans cannot control them', async () => {
    const store = new MemStore(true);
    const code = await createRoom(store, 'H', 'local');
    const host = new RoomClient(store, code, 'H').start();
    await new Promise((r) => setTimeout(r, 20));
    for (let i = 0; i < 4; i++) await host.call('seat:addBot', {});
    expect(host.room!.seats.every((s) => s.bot)).toBe(true);
    expect(new Set(host.room!.seats.map((s) => s.name)).size).toBe(4);
    await host.call('room:start', {});
    const g = host.room!.game!;
    await expect(host.call('game:action', { action: { type: 'roll', actor: g.currentPlayer } })).rejects.toThrow(/computer/);
    host.stop();
  });
});
