import { describe, expect, it } from 'vitest';
import {
  BOARD,
  COLOR_GROUPS,
  GROUP_MEMBERS,
  GameError,
  PURCHASABLE,
  TOTAL_HOTELS,
  TOTAL_HOUSES,
  applyAction,
  checkBuild,
  checkMortgage,
  checkSellBuilding,
  checkUnmortgage,
  createGame,
  ownedBy,
  type ActorAction,
  type GameState,
} from '../src/engine';

/** Simple deterministic PRNG for the bot's choices (separate from the game's RNG). */
function botRng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

function checkInvariants(s: GameState, full: boolean) {
  for (const p of s.players) {
    expect(p.cash, `${p.name} cash`).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(p.cash)).toBe(true);
    expect(p.position).toBeGreaterThanOrEqual(0);
    expect(p.position).toBeLessThan(40);
    if (p.bankrupt) expect(ownedBy(s, p.id)).toHaveLength(0);
  }
  let houses = 0;
  let hotels = 0;
  for (const i of PURCHASABLE) {
    const ps = s.props[i];
    if (ps.owner) expect(s.players.find((p) => p.id === ps.owner)?.bankrupt).toBe(false);
    if (BOARD[i].kind !== 'property') expect(ps.houses).toBe(0);
    if (ps.houses > 0) expect(ps.mortgaged).toBe(false);
    if (ps.houses === 5) hotels++;
    else houses += ps.houses;
  }
  expect(houses + s.bankHouses).toBe(TOTAL_HOUSES);
  expect(hotels + s.bankHotels).toBe(TOTAL_HOTELS);
  for (const g of COLOR_GROUPS) {
    const m = GROUP_MEMBERS[g];
    const hs = m.map((i) => s.props[i].houses);
    if (hs.some((h) => h > 0)) {
      const owner = s.props[m[0]].owner;
      expect(m.every((i) => s.props[i].owner === owner)).toBe(true);
      expect(m.every((i) => !s.props[i].mortgaged)).toBe(true);
      expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(1);
    }
  }
  // Card decks: 16 cards per deck minus those held.
  for (const d of ['chance', 'chest'] as const) {
    const held = s.players.reduce((a, p) => a + p.jailCards.filter((x) => x === d).length, 0);
    expect(s.decks[d].length + held).toBe(16);
  }
  // Money conservation: the bank is the only source/sink, so totals must match the ledger.
  if (!full) return;
  const start = s.players.length * s.config.startingCash;
  let net = 0;
  for (const t of s.transactions) {
    if (t.from === 'bank' && t.to !== 'bank') net += t.amount;
    if (t.to === 'bank' && t.from !== 'bank') net -= t.amount;
  }
  const cash = s.players.reduce((a, p) => a + p.cash, 0);
  expect(cash).toBe(start + net);
  if (s.currentPlayer && s.status === 'playing') expect(s.players.find((p) => p.id === s.currentPlayer)!.bankrupt).toBe(false);
}

function chooseAction(s: GameState, r: () => number): ActorAction {
  const cur = s.currentPlayer;
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  switch (s.phase) {
    case 'debt': {
      const d = s.debts[0];
      // try raising funds; otherwise go bankrupt
      for (const i of ownedBy(s, d.debtor)) {
        if (!checkSellBuilding(s, d.debtor, i)) return { actor: d.debtor, type: 'sellBuilding', space: i };
      }
      for (const g of COLOR_GROUPS) {
        if (GROUP_MEMBERS[g].every((i) => s.props[i].owner === d.debtor) && GROUP_MEMBERS[g].some((i) => s.props[i].houses > 0))
          return { actor: d.debtor, type: 'sellAllBuildings', group: g };
      }
      for (const i of ownedBy(s, d.debtor)) if (!checkMortgage(s, d.debtor, i)) return { actor: d.debtor, type: 'mortgage', space: i };
      return { actor: d.debtor, type: 'declareBankruptcy' };
    }
    case 'auction': {
      const a = s.auction!;
      const bidder = pick(a.active);
      const p = s.players.find((x) => x.id === bidder)!;
      if (r() < 0.45 && p.cash > a.highBid + 1) return { actor: bidder, type: 'bid', amount: a.highBid + 1 + Math.floor(r() * 40) };
      if (a.highBidder === bidder) return { actor: 'system', type: 'auctionTimeout' };
      return { actor: bidder, type: 'passAuction' };
    }
    case 'buyDecision':
      return { actor: cur, type: r() < 0.7 ? 'buy' : 'decline' };
    case 'preRoll': {
      const p = s.players.find((x) => x.id === cur)!;
      if (p.inJail && r() < 0.3) return { actor: cur, type: p.jailCards.length ? 'useJailCard' : 'payJailFine' };
      return maybeManage(s, r) ?? { actor: cur, type: 'roll' };
    }
    case 'postRoll':
      return maybeManage(s, r) ?? { actor: cur, type: 'endTurn' };
    default:
      throw new Error('no action');
  }
}

function maybeManage(s: GameState, r: () => number): ActorAction | null {
  const x = r();
  const cur = s.currentPlayer;
  if (x < 0.25) {
    for (const i of ownedBy(s, cur)) if (!checkBuild(s, cur, i)) return { actor: cur, type: 'build', space: i };
  } else if (x < 0.3) {
    for (const i of ownedBy(s, cur)) if (!checkUnmortgage(s, cur, i)) return { actor: cur, type: 'unmortgage', space: i };
  } else if (x < 0.33) {
    for (const i of ownedBy(s, cur)) if (!checkMortgage(s, cur, i)) return { actor: cur, type: 'mortgage', space: i };
  } else if (x < 0.4) {
    const others = s.players.filter((p) => !p.bankrupt && p.id !== cur);
    const o = others[Math.floor(r() * others.length)];
    const mine = ownedBy(s, cur).filter((i) => BOARD[i].kind !== 'property' || !GROUP_MEMBERS[BOARD[i].group!].some((j) => s.props[j].houses > 0));
    const theirs = ownedBy(s, o.id).filter((i) => BOARD[i].kind !== 'property' || !GROUP_MEMBERS[BOARD[i].group!].some((j) => s.props[j].houses > 0));
    return {
      actor: cur,
      type: 'proposeTrade',
      to: o.id,
      offer: { cash: Math.floor(r() * 100), properties: mine.slice(0, 1), jailCards: 0 },
      request: { cash: 0, properties: theirs.slice(0, 1), jailCards: 0 },
    };
  } else if (x < 0.45) {
    const t = s.trades.find((t) => t.status === 'pending');
    if (t) return { actor: t.to, type: r() < 0.6 ? 'acceptTrade' : 'rejectTrade', tradeId: t.id };
  }
  return null;
}

describe('fuzz: random full games keep every invariant', () => {
  const FUZZ_GAMES = Number(process.env.FUZZ_GAMES ?? 10);
  for (let g = 0; g < FUZZ_GAMES; g++) {
    it(`game #${g}`, { timeout: 120_000 }, () => {
      const players = 4 + (g % 7);
      const r = botRng(1000 + g);
      let s = createGame({
        id: `fuzz${g}`,
        players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, token: `t${i}`, color: '#000' })),
        seed: 9000 + g,
        now: 0,
        config: { startingCash: g % 3 === 0 ? 600 : 1500, auctionSeconds: 15 },
      });
      let now = 0;
      let steps = 0;
      let rejected = 0;
      while (s.status === 'playing' && steps < 3000) {
        const action = chooseAction(s, r);
        now += 20_000;
        try {
          s = applyAction(s, action, { now });
        } catch (e) {
          if (!(e instanceof GameError)) throw e;
          rejected++;
          // A rejected action must never be a core turn action the bot believed legal.
          if (['roll', 'endTurn', 'buy', 'declareBankruptcy', 'auctionTimeout'].includes(action.type) && !/afford|need/.test(e.message))
            throw new Error(`Core action rejected: ${action.type}: ${e.message}`);
        }
        steps++;
        checkInvariants(s, steps % 100 === 0 || s.status !== 'playing');
      }
      expect(steps).toBeGreaterThan(10);
      expect(rejected).toBeLessThan(steps);
    });
  }
});
