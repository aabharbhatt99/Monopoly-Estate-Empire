/**
 * End-to-end smoke test against a running server (default http://localhost:3001).
 * Usage: npm run smoke   (with the server running, e.g. `npm run serve`)
 */
import { io, type Socket } from 'socket.io-client';
import { COLOR_GROUPS, GROUP_MEMBERS, checkBuild, checkMortgage, checkSellBuilding, ownedBy, type GameState } from '../src/engine/index';
import type { RoomView } from '../src/engine/room';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3001';

function client(id: string) {
  const s: Socket = io(URL, { transports: ['websocket'], forceNew: true });
  let last: RoomView | null = null;
  s.on('room:state', (r: RoomView) => (last = r));
  const call = (ev: string, payload: any): Promise<any> =>
    new Promise((res) => s.emit(ev, payload, (r: any) => res(r)));
  return { s, id, call, room: () => last, wait: () => new Promise((r) => setTimeout(r, 60)) };
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('✗ FAIL:', msg);
    process.exit(1);
  }
  console.log('✓', msg);
}

function pickAction(g: GameState): any {
  const cur = g.currentPlayer;
  switch (g.phase) {
    case 'debt': {
      const d = g.debts[0];
      for (const i of ownedBy(g, d.debtor)) if (!checkSellBuilding(g, d.debtor, i)) return { actor: d.debtor, type: 'sellBuilding', space: i };
      for (const gr of COLOR_GROUPS)
        if (GROUP_MEMBERS[gr].every((i) => g.props[i].owner === d.debtor) && GROUP_MEMBERS[gr].some((i) => g.props[i].houses > 0)) return { actor: d.debtor, type: 'sellAllBuildings', group: gr };
      for (const i of ownedBy(g, d.debtor)) if (!checkMortgage(g, d.debtor, i)) return { actor: d.debtor, type: 'mortgage', space: i };
      return { actor: d.debtor, type: 'declareBankruptcy' };
    }
    case 'auction': {
      const a = g.auction!;
      const bidder = a.active.find((x) => x !== a.highBidder)!;
      const p = g.players.find((x) => x.id === bidder)!;
      if (!a.highBidder && p.cash > 10) return { actor: bidder, type: 'bid', amount: 10 };
      return { actor: bidder, type: 'passAuction' };
    }
    case 'buyDecision':
      return { actor: cur, type: Math.random() < 0.8 ? 'buy' : 'decline' };
    case 'preRoll':
    case 'postRoll': {
      for (const i of ownedBy(g, cur)) if (!checkBuild(g, cur, i) && Math.random() < 0.5) return { actor: cur, type: 'build', space: i };
      return { actor: cur, type: g.phase === 'preRoll' ? 'roll' : 'endTurn' };
    }
  }
  return null;
}

async function main() {
  const host = client('host-' + Date.now());
  const guest = client('guest-' + Date.now());
  await new Promise<void>((r) => host.s.on('connect', () => r()));
  await new Promise<void>((r) => guest.s.on('connect', () => r()));

  // ── Online room with two devices ──
  const created = await host.call('room:create', { clientId: host.id, mode: 'online' });
  assert(created.ok && /^[A-Z0-9]{5}$/.test(created.code), `online room created (${created.code})`);
  const code = created.code;
  assert((await guest.call('room:join', { clientId: guest.id, code })).ok, 'guest joined by code');
  const tokens = ['🚀', '🦊', '🐙', '🎸', '⚓', '👑'];
  for (let i = 0; i < 1; i++) assert((await host.call('seat:add', { code, name: `Host${i}`, token: tokens[i], color: '#f00' })).ok, `host seat ${i} added`);
  const dup = await guest.call('seat:add', { code, name: 'G', token: tokens[0], color: '#0f0' });
  assert(!dup.ok, `duplicate token rejected (${dup.error})`);
  for (let i = 1; i < 3; i++) assert((await guest.call('seat:add', { code, name: `Guest${i}`, token: tokens[i], color: '#0f0' })).ok, `guest seat ${i} added`);
  const early = await host.call('room:start', { code });
  assert(!early.ok, `cannot start with 3 players (${early.error})`);
  const notHost = await guest.call('room:config', { code, config: { startingCash: 5000 } });
  assert(!notHost.ok, 'guest cannot change settings');
  assert((await host.call('room:config', { code, config: { startingCash: 2000, auctionSeconds: 2 } })).ok, 'host configured starting cash');
  for (let i = 3; i < 6; i++) assert((await host.call('seat:add', { code, name: `Host${i}`, token: tokens[i], color: '#00f' })).ok, `host seat ${i} added`);
  assert((await guest.call('room:start', { code })).ok === false, 'guest cannot start the game');
  assert((await host.call('room:start', { code })).ok, 'host started the game');
  await host.wait();
  let room = host.room()!;
  assert(room.status === 'playing' && room.game!.players.every((p) => p.cash === 2000), 'all 6 players start with $2000');

  // Permission: guest cannot act for a host seat
  const g0 = room.game!;
  const hostSeat = room.seats.find((s) => s.controllerId === host.id)!;
  const guestSeat = room.seats.find((s) => s.controllerId === guest.id)!;
  const impostor = await guest.call('game:action', { code, action: { actor: hostSeat.id, type: 'roll' } });
  assert(!impostor.ok, `guest cannot act as a host seat (${impostor.error})`);
  const outOfTurn = g0.currentPlayer === guestSeat.id ? null : await guest.call('game:action', { code, action: { actor: guestSeat.id, type: 'roll' } });
  if (outOfTurn) assert(!outOfTurn.ok, `out-of-turn roll rejected (${outOfTurn.error})`);

  // Pause blocks actions
  assert((await host.call('room:pause', { code })).ok, 'host paused');
  await host.wait();
  const curSeat = room.seats.find((s) => s.id === g0.currentPlayer)!;
  const actor = curSeat.controllerId === host.id ? host : guest;
  const blocked = await actor.call('game:action', { code, action: { actor: curSeat.id, type: 'roll' } });
  assert(!blocked.ok && /paused/.test(blocked.error), 'actions blocked while paused');
  assert((await host.call('room:resume', { code })).ok, 'host resumed');

  // Reconnection: guest drops and reconnects with the same clientId
  guest.s.disconnect();
  await new Promise((r) => setTimeout(r, 150));
  await host.wait();
  assert(host.room()!.seats.filter((s) => s.controllerId === guest.id).every((s) => !s.connected), 'guest seats shown offline after disconnect');
  guest.s.connect();
  await new Promise<void>((r) => guest.s.once('connect', () => r()));
  assert((await guest.call('room:join', { clientId: guest.id, code })).ok, 'guest rejoined');
  await host.wait();
  assert(host.room()!.seats.filter((s) => s.controllerId === guest.id).every((s) => s.connected), 'guest seats online again with progress intact');

  // Play a few hundred actions through the server
  let steps = 0;
  let errors = 0;
  while (steps < 400) {
    room = host.room()!;
    const g = room.game!;
    if (g.status !== 'playing') break;
    const a = pickAction(g);
    if (!a) break;
    const seat = room.seats.find((s) => s.id === a.actor)!;
    const c = seat.controllerId === host.id ? host : guest;
    const r = await c.call('game:action', { code, action: a });
    if (!r.ok) {
      errors++;
      if (errors > 40) assert(false, `too many rejected actions, last: ${r.error}`);
    }
    await c.wait();
    steps++;
    const gg = host.room()!.game!;
    if (gg.players.some((p) => p.cash < 0)) assert(false, 'negative balance detected');
  }
  room = host.room()!;
  assert(steps > 50, `played ${steps} actions through the server (turn ${room.game!.turn.number}, ${errors} rejected)`);

  // Saved game is listed
  await new Promise((r) => setTimeout(r, 400));
  const list = await (await fetch(`${URL}/api/games`)).json();
  const saved = list.find((x: any) => x.code === code);
  assert(saved && saved.status === room.status, 'game autosaved and listed in history');

  // Local room
  const local = await host.call('room:create', { clientId: host.id, mode: 'local' });
  const lc = local.code;
  const guestJoin = await guest.call('room:join', { clientId: guest.id, code: lc });
  const guestAdd = await guest.call('seat:add', { code: lc, name: 'X', token: '🦄', color: '#000' });
  assert(guestJoin.ok && !guestAdd.ok, 'in local mode only the host device adds players');
  for (let i = 0; i < 10; i++) await host.call('seat:add', { code: lc, name: `L${i}`, token: ['🚀', '🦊', '🐙', '🎸', '⚓', '👑', '🦄', '🐢', '🌵', '🍀'][i], color: '#123' });
  const eleventh = await host.call('seat:add', { code: lc, name: 'L10', token: '🦉', color: '#123' });
  assert(!eleventh.ok, `11th player rejected (${eleventh.error})`);
  assert((await host.call('room:start', { code: lc })).ok, 'local 10-player game started');

  host.s.disconnect();
  guest.s.disconnect();
  console.log(`\nAll smoke checks passed. Rooms: ${code} (online), ${lc} (local).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
