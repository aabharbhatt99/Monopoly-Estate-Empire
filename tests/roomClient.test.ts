import { describe, expect, it } from 'vitest';
import { RoomClient, createRoom, deleteGame, listGames, roomPath } from '../src/client/roomClient';
import { MemStore } from '../src/client/store';
import { toStored } from '../src/client/hostCore';

async function until(cond: () => boolean, label = 'condition', ms = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function setup() {
  const store = new MemStore(true);
  const code = await createRoom(store, 'H', 'online');
  const host = new RoomClient(store, code, 'H', undefined, { ackTimeoutMs: 400 }).start();
  const guest = new RoomClient(store, code, 'G', undefined, { ackTimeoutMs: 400 }).start();
  await until(() => !!host.room && !!guest.room, 'both clients to load');
  return { store, code, host, guest };
}

async function fillAndStart(host: RoomClient, guest: RoomClient) {
  await host.call('seat:add', { name: 'Hana', token: '🚀', color: '#ef4444' });
  await host.call('seat:add', { name: 'Hugo', token: '🦊', color: '#3b82f6' });
  await guest.call('seat:add', { name: 'Gia', token: '🐙', color: '#22c55e' });
  await guest.call('seat:add', { name: 'Gus', token: '🎸', color: '#a855f7' });
  await host.call('room:start', {});
  await until(() => guest.room?.status === 'playing', 'guest to see the game start');
}

describe('room client: host and guest through the shared document', () => {
  it('a guest joins the lobby through the host and sees the seats', async () => {
    const { host, guest } = await setup();
    await guest.call('seat:add', { name: 'Gia', token: '🐙', color: '#22c55e' });
    await until(() => guest.room!.seats.length === 1, 'seat to appear for the guest');
    expect(host.room!.seats[0]).toMatchObject({ name: 'Gia', controllerId: 'G' });
    expect(guest.session).toBeNull();
    expect(host.session).not.toBeNull();
    host.stop();
    guest.stop();
  });

  it('returns the host\'s validation errors to the guest', async () => {
    const { host, guest } = await setup();
    await expect(guest.call('seat:add', { name: '', token: '🐙', color: '#fff' })).rejects.toThrow(/name/i);
    await expect(guest.call('room:start', {})).rejects.toThrow(/Only the host/);
    await guest.call('seat:add', { name: 'Gia', token: '🐙', color: '#22c55e' });
    await expect(host.call('seat:add', { name: 'gia', token: '🦊', color: '#fff' })).rejects.toThrow(/taken/);
    host.stop();
    guest.stop();
  });

  it('plays a full turn: only the controlling device can act for a seat', async () => {
    const { host, guest } = await setup();
    await fillAndStart(host, guest);
    const g = guest.room!.game!;
    const current = g.currentPlayer;
    const seat = guest.room!.seats.find((s) => s.id === current)!;
    const mine = seat.controllerId === 'G' ? guest : host;
    const other = mine === guest ? host : guest;
    await expect(other.call('game:action', { action: { type: 'roll', actor: current } })).rejects.toThrow(/not controlling/);
    await mine.call('game:action', { action: { type: 'roll', actor: current } });
    await until(() => guest.room!.game!.turn.hasRolled && host.room!.game!.turn.hasRolled, 'roll to reach both clients');
    expect(guest.room!.game!.turn.dice).toEqual(host.room!.game!.turn.dice);
    expect(guest.room!.game!.version).toBe(host.room!.game!.version);
    host.stop();
    guest.stop();
  });

  it('the stored document matches the host and survives a host reload', async () => {
    const { store, code, host, guest } = await setup();
    await fillAndStart(host, guest);
    const current = host.room!.game!.currentPlayer;
    const seat = host.room!.seats.find((s) => s.id === current)!;
    const mine = seat.controllerId === 'G' ? guest : host;
    await mine.call('game:action', { action: { type: 'roll', actor: current } });
    await host.session!.flushed();
    const saved = await store.getDoc(roomPath(code));
    expect(saved.game.version).toBe(host.room!.game!.version);

    // The host closes the page and opens it again: the game continues from the stored state.
    const version = host.room!.game!.version;
    host.stop();
    const again = new RoomClient(store, code, 'H', undefined, { ackTimeoutMs: 400 }).start();
    await until(() => !!again.session, 'host session to restart');
    expect(again.room!.game!.version).toBe(version);
    again.stop();
    guest.stop();
  });

  it('does not apply the same guest request twice after the host reloads', async () => {
    const { store, code, host, guest } = await setup();
    await guest.call('seat:add', { name: 'Gia', token: '🐙', color: '#22c55e' });
    await host.session!.flushed();
    host.stop();
    const again = new RoomClient(store, code, 'H', undefined, { ackTimeoutMs: 400 }).start();
    await until(() => !!again.session, 'host session to restart');
    await new Promise((r) => setTimeout(r, 30));
    expect(again.room!.seats).toHaveLength(1);
    again.stop();
    guest.stop();
  });

  it('a guest times out with a clear message when the host is gone, then takes over', async () => {
    const { host, guest, store, code } = await setup();
    await guest.call('seat:add', { name: 'Gia', token: '🐙', color: '#22c55e' });
    await host.session!.flushed();
    host.stop();

    await expect(guest.call('seat:add', { name: 'Gus', token: '🎸', color: '#fff' })).rejects.toThrow(/host did not respond/);

    // Presence says only the guest is left, so it may take over.
    guest.setConnected(new Set(['G']));
    await guest.call('room:takeover', {});
    await until(() => !!guest.session, 'guest to become the host');
    // The recent request that timed out is picked up by the new host rather than lost.
    await until(() => guest.room!.seats.length === 2, 'pending request to be applied by the new host');
    expect(guest.room!.seats.map((s) => s.name)).toEqual(['Gia', 'Gus']);
    await expect(guest.call('seat:add', { name: 'Gwen', token: '🍀', color: '#fff' })).resolves.toBeTruthy();
    await guest.session!.flushed();
    expect((await store.getDoc(roomPath(code))).hostId).toBe('G');
    guest.stop();
  });

  it('refuses a takeover while the host is still present', async () => {
    const { host, guest } = await setup();
    guest.setConnected(new Set(['H', 'G']));
    await expect(guest.call('room:takeover', {})).rejects.toThrow(/still connected/);
    host.stop();
    guest.stop();
  });

  it('a long game keeps the stored document well under the 256 KiB limit', async () => {
    const { host, guest } = await setup();
    await fillAndStart(host, guest);
    const room = host.session!.room;
    const g = room.game!;
    for (let i = 0; i < 5000; i++) g.transactions.push({ id: i, ts: 1, from: 'bank', to: g.players[0].id, amount: 10, reason: 'Test payment that is fairly long' });
    for (let i = 0; i < 400; i++) g.log.push({ id: 9000 + i, ts: 1, kind: 'info', text: 'A moderately long log line for size testing purposes.' });
    const size = JSON.stringify(toStored(room)).length;
    expect(size).toBeLessThan(200_000);
    host.stop();
    guest.stop();
  });

  it('lists and deletes games from the history index', async () => {
    const { store, code, host, guest } = await setup();
    await guest.call('seat:add', { name: 'Gia', token: '🐙', color: '#22c55e' });
    await host.session!.flushed();
    host.stop();
    guest.stop();
    expect((await listGames(store)).map((g) => g.code)).toContain(code);
    await deleteGame(store, code);
    expect(await store.getDoc(roomPath(code))).toBeNull();
    expect(await listGames(store)).toHaveLength(0);
  });

  it('auction timeouts are fired by the host clock', async () => {
    const { host, guest } = await setup();
    await fillAndStart(host, guest);
    const room = host.session!.room;
    expect(room.game!.config.auctionSeconds).toBe(15);
    // Force an auction that is already overdue and let the host's scheduler finish it.
    const g = room.game!;
    g.auction = { space: 1, highBid: 0, highBidder: null, active: g.players.map((p) => p.id), endsAt: Date.now() - 10, reason: 'declined' };
    g.phase = 'auction';
    (host.session as any).commit();
    await until(() => host.room!.game!.auction === null, 'overdue auction to close');
    host.stop();
    guest.stop();
  });
});
