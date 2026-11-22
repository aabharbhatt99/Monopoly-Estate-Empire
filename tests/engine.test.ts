import { describe, expect, it } from 'vitest';
import { BOARD, GROUP_LABELS, COLOR_GROUPS, calculateRent, createGame, scorePlayer, tradeWindowOpen, unmortgageCost, type GameState } from '../src/engine';
import { NOW, P, act, expectError, give, newGame, roll } from './helpers';

/** Walk p0 onto the Auction House (17 + 3 = 20) so trading opens for this turn. */
function atAuctionHouse(s: GameState): GameState {
  P(s, 'p0').position = 17;
  return roll(s, 1, 2);
}

describe('board', () => {
  it('has one Fortune, one Community Fund, the Auction House and Random', () => {
    expect(BOARD.filter((b) => b.kind === 'chance').map((b) => b.index)).toEqual([22]);
    expect(BOARD.filter((b) => b.kind === 'chest').map((b) => b.index)).toEqual([2]);
    expect(BOARD[20]).toMatchObject({ kind: 'auctionHouse', name: 'Auction House' });
    expect(BOARD[30]).toMatchObject({ kind: 'random', name: 'Random' });
    expect(BOARD.some((b) => (b.kind as string) === 'gotojail')).toBe(false);
  });

  it('every colour group is a country of cities', () => {
    expect(COLOR_GROUPS).toHaveLength(10);
    for (const g of COLOR_GROUPS) expect(GROUP_LABELS[g]).toMatch(/^[A-Z]/);
    expect(BOARD.filter((b) => b.kind === 'property')).toHaveLength(26);
  });
});

describe('setup', () => {
  it('creates a game with starting cash, shuffled decks and a random first player', () => {
    const s = createGame({
      id: 'x',
      players: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, token: `t${i}`, color: '#000' })),
      seed: 7,
      now: NOW,
    });
    expect(s.players).toHaveLength(8);
    expect(s.players.every((p) => p.cash === 1500 && p.position === 0)).toBe(true);
    expect(s.currentPlayer).toBe(s.players[0].id);
    expect(s.decks.chance.slice().sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    expect(s.decks.chest).toHaveLength(16);
    expect(s.phase).toBe('preRoll');
  });

  it('rejects duplicate tokens and too many players', () => {
    expectError(() => createGame({ id: 'x', players: [{ id: 'a', name: 'A', token: 't', color: '' }, { id: 'b', name: 'B', token: 't', color: '' }] }), /token/);
    expectError(() => createGame({ id: 'x', players: Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, name: `${i}`, token: `${i}`, color: '' })) }));
  });

  it('uses configurable starting cash', () => {
    const s = newGame(6, { startingCash: 2000 });
    expect(P(s, 'p3').cash).toBe(2000);
  });
});

describe('dice and movement', () => {
  it('moves the token by the dice total and ends the roll phase', () => {
    let s = newGame();
    s = roll(s, 2, 3);
    expect(P(s, 'p0').position).toBe(5);
    expect(s.turn.dice).toEqual([2, 3]);
    expect(s.moves[0].path).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not allow rolling twice without doubles and rejects rolling out of turn', () => {
    let s = newGame();
    expectError(() => act(s, 'p1', { type: 'roll' }, { dice: [1, 2] }), /not your turn/);
    s = roll(s, 1, 2); // lands on 3 (for sale)
    s = act(s, 'p0', { type: 'buy' });
    expect(s.phase).toBe('postRoll');
    expectError(() => roll(s, 1, 2));
  });

  it('passes the turn in order and skips nobody', () => {
    let s = newGame(6);
    const order: string[] = [];
    for (let k = 0; k < 7; k++) {
      order.push(s.currentPlayer);
      s = roll(s, 6, 4); // lands on 10/20/30.. avoid doubles
      if (s.phase === 'buyDecision') s = act(s, s.currentPlayer, { type: 'buy' });
      if (s.phase === 'auction') break;
      s = act(s, s.currentPlayer, { type: 'endTurn' });
    }
    expect(order).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p0']);
  });
});

describe('passing GO', () => {
  it('pays the salary when passing START', () => {
    let s = newGame();
    P(s, 'p0').position = 38;
    s = roll(s, 1, 3); // 38 -> 2 (Community Fund)
    expect(P(s, 'p0').position).toBe(2);
    // salary (+200) plus whatever the card did; check the transaction instead of the balance
    expect(s.transactions.some((t) => t.to === 'p0' && t.amount === 200 && /Passed/.test(t.reason))).toBe(true);
  });

  it('pays the salary when landing exactly on START', () => {
    let s = newGame();
    P(s, 'p0').position = 35;
    s = roll(s, 2, 3);
    expect(P(s, 'p0').position).toBe(0);
    expect(P(s, 'p0').cash).toBe(1700);
  });

  it('uses the configurable salary', () => {
    let s = newGame(6, { goSalary: 300 });
    P(s, 'p0').position = 35;
    s = roll(s, 2, 3);
    expect(P(s, 'p0').cash).toBe(1800);
  });
});

describe('property purchase', () => {
  it('buys an unowned property and deducts the price', () => {
    let s = newGame();
    s = roll(s, 1, 2); // Brick Row (3), $60
    expect(s.phase).toBe('buyDecision');
    s = act(s, 'p0', { type: 'buy' });
    expect(s.props[3].owner).toBe('p0');
    expect(P(s, 'p0').cash).toBe(1440);
  });

  it('cannot buy without enough cash and cannot buy an owned property twice', () => {
    let s = newGame();
    P(s, 'p0').cash = 50;
    s = roll(s, 1, 2);
    expectError(() => act(s, 'p0', { type: 'buy' }), /need/);
    s = act(s, 'p0', { type: 'decline' });
    expect(s.phase).toBe('auction');
  });
});

describe('rent', () => {
  let s: GameState;
  it('charges base, double for full set, and house/hotel rents', () => {
    s = newGame();
    give(s, 'p1', 1);
    expect(calculateRent(s, 1, 7)).toBe(2);
    give(s, 'p1', 3);
    expect(calculateRent(s, 1, 7)).toBe(4); // double for colour set
    s.props[1].houses = 1;
    expect(calculateRent(s, 1, 7)).toBe(10);
    s.props[1].houses = 4;
    expect(calculateRent(s, 1, 7)).toBe(160);
    s.props[1].houses = 5;
    expect(calculateRent(s, 1, 7)).toBe(250);
  });

  it('charges no rent on mortgaged property', () => {
    s = newGame();
    give(s, 'p1', 1);
    s.props[1].mortgaged = true;
    expect(calculateRent(s, 1, 7)).toBe(0);
  });

  it('station rent scales with stations owned', () => {
    s = newGame();
    give(s, 'p1', 5);
    expect(calculateRent(s, 5, 7)).toBe(25);
    give(s, 'p1', 15, 25);
    expect(calculateRent(s, 5, 7)).toBe(100);
    give(s, 'p1', 35);
    expect(calculateRent(s, 5, 7)).toBe(200);
  });

  it('utility rent is 4× or 10× the dice', () => {
    s = newGame();
    give(s, 'p1', 12);
    expect(calculateRent(s, 12, 8)).toBe(32);
    give(s, 'p1', 28);
    expect(calculateRent(s, 12, 8)).toBe(80);
  });

  it('automatically transfers rent between players on landing', () => {
    s = newGame();
    give(s, 'p1', 6, 7); // Brazil set
    s = roll(s, 2, 4); // 6, São Paulo, rent 6 doubled = 12
    expect(P(s, 'p0').cash).toBe(1488);
    expect(P(s, 'p1').cash).toBe(1512);
    expect(s.phase).toBe('postRoll');
  });

  it('owner in jail still collects rent', () => {
    s = newGame();
    give(s, 'p1', 6);
    P(s, 'p1').inJail = true;
    P(s, 'p1').position = 10;
    s = roll(s, 2, 4);
    expect(P(s, 'p1').cash).toBe(1506);
  });
});

describe('taxes', () => {
  it('charges income and luxury tax to the bank', () => {
    let s = newGame();
    s = roll(s, 1, 3);
    expect(P(s, 'p0').cash).toBe(1300);
    s = newGame();
    P(s, 'p0').position = 34;
    s = roll(s, 1, 3);
    expect(P(s, 'p0').cash).toBe(1400);
  });
});

describe('doubles and jail', () => {
  it('grants another roll on doubles', () => {
    let s = newGame();
    s = roll(s, 3, 3); // 6 São Paulo
    s = act(s, 'p0', { type: 'buy' });
    expect(s.phase).toBe('preRoll');
    expect(s.currentPlayer).toBe('p0');
    s = roll(s, 1, 2); // 9
    s = act(s, 'p0', { type: 'buy' });
    expect(s.phase).toBe('postRoll');
  });


  it('three doubles → jail (deterministic path)', () => {
    let s = newGame();
    give(s, 'p5', 6, 11); // make landings rent-only
    s = roll(s, 3, 3); // 6
    s = roll(s, 1, 1); // 8
    s.props[8].owner = 'p5';
    s.pendingPurchase = null;
    s.phase = 'preRoll';
    s = roll(s, 2, 2);
    expect(P(s, 'p0').inJail).toBe(true);
    expect(P(s, 'p0').position).toBe(10);
    expect(s.turn.canRollAgain).toBe(false);
  });

  it('the Random corner draws a card from one of the two decks', () => {
    let s = newGame();
    s.decks.chance = [6, ...s.decks.chance.filter((c) => c !== 6)]; // collect 50
    s.decks.chest = [3, ...s.decks.chest.filter((c) => c !== 3)]; // collect 50
    P(s, 'p0').position = 26;
    s = roll(s, 1, 3);
    expect(P(s, 'p0').position).toBe(30);
    expect(P(s, 'p0').inJail).toBe(false);
    expect(['chance', 'chest']).toContain(s.lastCard?.deck);
    expect(P(s, 'p0').cash).toBe(1550);
    expect(s.log.some((e) => /Random/.test(e.text))).toBe(true);
  });

  it('the Random corner can draw from either deck', () => {
    const decks = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      let s = createGame({ id: 'r', players: [{ id: 'a', name: 'A', token: 'x', color: '' }, { id: 'b', name: 'B', token: 'y', color: '' }], seed, now: NOW });
      s.players.find((p) => p.id === s.currentPlayer)!.position = 26;
      s = act(s, s.currentPlayer, { type: 'roll' }, { dice: [1, 3] });
      decks.add(s.lastCard!.deck);
    }
    expect([...decks].sort()).toEqual(['chance', 'chest']);
  });

  it('pay the fine to leave jail, then roll normally', () => {
    let s = newGame();
    Object.assign(P(s, 'p0'), { inJail: true, position: 10 });
    s = act(s, 'p0', { type: 'payJailFine' });
    expect(P(s, 'p0').cash).toBe(1450);
    expect(P(s, 'p0').inJail).toBe(false);
    s = roll(s, 1, 2);
    expect(P(s, 'p0').position).toBe(13);
  });

  it('use a Get Out of Jail Free card and return it to the deck', () => {
    let s = newGame();
    s.decks.chance = s.decks.chance.filter((c) => c !== 7);
    Object.assign(P(s, 'p0'), { inJail: true, position: 10, jailCards: ['chance'] });
    s = act(s, 'p0', { type: 'useJailCard' });
    expect(P(s, 'p0').inJail).toBe(false);
    expect(P(s, 'p0').jailCards).toEqual([]);
    expect(s.decks.chance).toContain(7);
  });

  it('rolling doubles in jail frees and moves, without an extra roll', () => {
    let s = newGame();
    Object.assign(P(s, 'p0'), { inJail: true, position: 10 });
    s = roll(s, 2, 2);
    expect(P(s, 'p0').inJail).toBe(false);
    expect(P(s, 'p0').position).toBe(14);
    s = act(s, 'p0', { type: 'buy' });
    expect(s.phase).toBe('postRoll');
  });

  it('failing doubles keeps the player in jail; third failure forces the fine and moves', () => {
    let s = newGame(2);
    Object.assign(P(s, 'p0'), { inJail: true, position: 10 });
    s = roll(s, 1, 2);
    expect(P(s, 'p0').position).toBe(10);
    expect(P(s, 'p0').jailTurns).toBe(1);
    expect(s.phase).toBe('postRoll');
    s = act(s, 'p0', { type: 'endTurn' });
    s = roll(s, 6, 4); // p1 -> 10, just visiting
    s = act(s, 'p1', { type: 'endTurn' });
    s = roll(s, 1, 2);
    expect(P(s, 'p0').jailTurns).toBe(2);
    s = act(s, 'p0', { type: 'endTurn' });
    s = roll(s, 1, 2); // p1 -> 13
    if (s.phase === 'buyDecision') s = act(s, 'p1', { type: 'buy' });
    s = act(s, 'p1', { type: 'endTurn' });
    s = roll(s, 1, 2); // third failure
    expect(P(s, 'p0').inJail).toBe(false);
    expect(P(s, 'p0').cash).toBe(1440) // $50 fine + $10 rent to p1, who bought Orchard Place;
    expect(P(s, 'p0').position).toBe(13);
  });

  it('a jailed player can still mortgage and answer trade offers', () => {
    let s = newGame();
    give(s, 'p1', 1);
    Object.assign(P(s, 'p1'), { inJail: true, position: 10 });
    s = act(s, 'p1', { type: 'mortgage', space: 1 });
    expect(P(s, 'p1').cash).toBe(1530);
    s = atAuctionHouse(s);
    s = act(s, 'p0', { type: 'proposeTrade', to: 'p1', offer: { cash: 100, properties: [], jailCards: 0 }, request: { cash: 0, properties: [1], jailCards: 0 } });
    s = act(s, 'p1', { type: 'acceptTrade', tradeId: s.trades[0].id });
    expect(s.props[1].owner).toBe('p0');
  });
});

describe('cards', () => {
  it('advance to nearest station charges double rent', () => {
    let s = newGame();
    give(s, 'p1', 25);
    s.decks.chance = [4, ...s.decks.chance.filter((c) => c !== 4)];
    P(s, 'p0').position = 17;
    s = roll(s, 2, 3); // 22 Fortune -> nearest airport 25
    expect(P(s, 'p0').position).toBe(25);
    expect(P(s, 'p1').cash).toBe(1550);
    expect(s.decks.chance[s.decks.chance.length - 1]).toBe(4);
  });

  it('go back three spaces moves backwards without salary', () => {
    let s = newGame();
    s.decks.chance = [8, ...s.decks.chance.filter((c) => c !== 8)];
    P(s, 'p0').position = 17;
    s = roll(s, 2, 3); // 22 -> back to 19 New Delhi
    expect(P(s, 'p0').position).toBe(19);
    expect(P(s, 'p0').cash).toBe(1500);
    expect(s.phase).toBe('buyDecision');
  });

  it('advance card collects salary when passing START', () => {
    let s = newGame();
    s.decks.chance = [2, ...s.decks.chance.filter((c) => c !== 2)];
    P(s, 'p0').position = 19;
    s = roll(s, 1, 2); // 22 Fortune -> Seville (11), passes START
    expect(P(s, 'p0').position).toBe(11);
    expect(P(s, 'p0').cash).toBe(1700);
    expect(s.phase).toBe('buyDecision');
  });

  it('collect from each player / pay each player', () => {
    let s = newGame(4);
    s.decks.chest = [8, ...s.decks.chest.filter((c) => c !== 8)];
    s = roll(s, 1, 1); // 2 Community Fund birthday
    expect(P(s, 'p0').cash).toBe(1530);
    expect(P(s, 'p1').cash).toBe(1490);
    s = newGame(4);
    s.decks.chance = [14, ...s.decks.chance.filter((c) => c !== 14)];
    P(s, 'p0').position = 17;
    s = roll(s, 2, 3);
    expect(P(s, 'p0').cash).toBe(1350);
    expect(P(s, 'p3').cash).toBe(1550);
  });

  it('repairs charge per house and hotel', () => {
    let s = newGame();
    give(s, 'p0', 1, 3);
    s.props[1].houses = 2;
    s.props[3].houses = 5;
    s.decks.chance = [10, ...s.decks.chance.filter((c) => c !== 10)];
    P(s, 'p0').position = 17;
    s = roll(s, 2, 3);
    expect(P(s, 'p0').cash).toBe(1500 - 50 - 100);
  });

  it('jail-free card is held and removed from the deck', () => {
    let s = newGame();
    s.decks.chest = [4, ...s.decks.chest.filter((c) => c !== 4)];
    s = roll(s, 1, 1);
    expect(P(s, 'p0').jailCards).toEqual(['chest']);
    expect(s.decks.chest).not.toContain(4);
    expect(s.decks.chest).toHaveLength(15);
  });

  it('go-to-jail card', () => {
    let s = newGame();
    s.decks.chest = [5, ...s.decks.chest.filter((c) => c !== 5)];
    s = roll(s, 1, 1);
    expect(P(s, 'p0').inJail).toBe(true);
    expect(s.phase).toBe('postRoll');
  });
});

describe('auctions', () => {
  function auctionGame() {
    let s = newGame(4);
    s = roll(s, 1, 2); // Brick Row
    return act(s, 'p0', { type: 'decline' });
  }

  it('awards the property to the highest bidder and deducts the bid', () => {
    let s = auctionGame();
    s = act(s, 'p1', { type: 'bid', amount: 10 });
    s = act(s, 'p2', { type: 'bid', amount: 25 });
    expectError(() => act(s, 'p3', { type: 'bid', amount: 20 }), /more than/);
    s = act(s, 'p0', { type: 'passAuction' });
    s = act(s, 'p1', { type: 'passAuction' });
    s = act(s, 'p3', { type: 'passAuction' });
    expect(s.auction).toBeNull();
    expect(s.props[3].owner).toBe('p2');
    expect(P(s, 'p2').cash).toBe(1475);
    expect(s.phase).toBe('postRoll');
  });

  it('cannot bid more than your cash and the high bidder cannot pass', () => {
    let s = auctionGame();
    expectError(() => act(s, 'p1', { type: 'bid', amount: 5000 }), /only have/);
    s = act(s, 'p1', { type: 'bid', amount: 5 });
    expectError(() => act(s, 'p1', { type: 'passAuction' }), /highest bidder/);
  });

  it('no bids leaves the property with the bank', () => {
    let s = auctionGame();
    for (const p of ['p0', 'p1', 'p2', 'p3']) s = act(s, p, { type: 'passAuction' });
    expect(s.props[3].owner).toBeNull();
    expect(s.phase).toBe('postRoll');
  });

  it('timer expiry awards to the high bidder', () => {
    let s = auctionGame();
    s = act(s, 'p1', { type: 'bid', amount: 40 }, { now: NOW + 1000 });
    expectError(() => act(s, 'system', { type: 'auctionTimeout' }, { now: NOW + 2000 }), /not expired/);
    s = act(s, 'system', { type: 'auctionTimeout' }, { now: NOW + 1000 + 15_000 });
    expect(s.props[3].owner).toBe('p1');
    expect(P(s, 'p1').cash).toBe(1460);
  });
});

describe('houses and hotels', () => {
  function setGame() {
    const s = newGame();
    give(s, 'p0', 1, 3);
    return s;
  }

  it('requires the full colour group', () => {
    let s = newGame();
    give(s, 'p0', 1);
    expectError(() => act(s, 'p0', { type: 'build', space: 1 }), /complete colour group/);
  });

  it('enforces even building and charges the house cost', () => {
    let s = setGame();
    s = act(s, 'p0', { type: 'build', space: 1 });
    expect(P(s, 'p0').cash).toBe(1450);
    expect(s.bankHouses).toBe(31);
    expectError(() => act(s, 'p0', { type: 'build', space: 1 }), /evenly/);
    s = act(s, 'p0', { type: 'build', space: 3 });
    s = act(s, 'p0', { type: 'build', space: 1 });
    expect(s.props[1].houses).toBe(2);
  });

  it('builds a hotel after four houses and returns houses to the bank', () => {
    let s = setGame();
    for (let k = 0; k < 4; k++) {
      s = act(s, 'p0', { type: 'build', space: 1 });
      s = act(s, 'p0', { type: 'build', space: 3 });
    }
    expect(s.bankHouses).toBe(24);
    s = act(s, 'p0', { type: 'build', space: 1 });
    expect(s.props[1].houses).toBe(5);
    expect(s.bankHotels).toBe(11);
    expect(s.bankHouses).toBe(28);
    expectError(() => act(s, 'p0', { type: 'build', space: 1 }), /already has a hotel/);
  });

  it('cannot build when a group property is mortgaged', () => {
    let s = setGame();
    s.props[3].mortgaged = true;
    expectError(() => act(s, 'p0', { type: 'build', space: 1 }), /Unmortgage/);
  });

  it('respects the bank housing shortage', () => {
    let s = setGame();
    s.bankHouses = 0;
    expectError(() => act(s, 'p0', { type: 'build', space: 1 }), /no houses/);
  });

  it('sells evenly at half price, and sell-all clears a group', () => {
    let s = setGame();
    s = act(s, 'p0', { type: 'build', space: 1 });
    s = act(s, 'p0', { type: 'build', space: 3 });
    s = act(s, 'p0', { type: 'build', space: 1 });
    expectError(() => act(s, 'p0', { type: 'sellBuilding', space: 3 }), /evenly/);
    s = act(s, 'p0', { type: 'sellBuilding', space: 1 });
    expect(P(s, 'p0').cash).toBe(1500 - 150 + 25);
    s = act(s, 'p0', { type: 'sellAllBuildings', group: 'brown' });
    expect(s.props[1].houses + s.props[3].houses).toBe(0);
    expect(s.bankHouses).toBe(32);
    expect(P(s, 'p0').cash).toBe(1500 - 150 + 75);
  });
});

describe('mortgages', () => {
  it('mortgages for half price and unmortgages for +10%', () => {
    let s = newGame();
    give(s, 'p0', 39);
    s = act(s, 'p0', { type: 'mortgage', space: 39 });
    expect(P(s, 'p0').cash).toBe(1700);
    expect(unmortgageCost(39)).toBe(220);
    s = act(s, 'p0', { type: 'unmortgage', space: 39 });
    expect(P(s, 'p0').cash).toBe(1480);
    expect(s.props[39].mortgaged).toBe(false);
  });

  it('cannot mortgage while the group has buildings or mortgage someone else\'s property', () => {
    let s = newGame();
    give(s, 'p0', 1, 3);
    s.props[3].houses = 1;
    expectError(() => act(s, 'p0', { type: 'mortgage', space: 1 }), /buildings/);
    expectError(() => act(s, 'p1', { type: 'mortgage', space: 1 }), /do not own/);
  });
});

describe('trading', () => {
  it('exchanges properties, cash and jail cards', () => {
    let s = newGame();
    give(s, 'p0', 1);
    give(s, 'p1', 3);
    P(s, 'p1').jailCards = ['chest'];
    s = atAuctionHouse(s);
    s = act(s, 'p0', { type: 'proposeTrade', to: 'p1', offer: { cash: 100, properties: [1], jailCards: 0 }, request: { cash: 0, properties: [3], jailCards: 1 } });
    const id = s.trades[0].id;
    expectError(() => act(s, 'p0', { type: 'acceptTrade', tradeId: id }), /recipient/);
    s = act(s, 'p1', { type: 'acceptTrade', tradeId: id });
    expect(s.props[1].owner).toBe('p1');
    expect(s.props[3].owner).toBe('p0');
    expect(P(s, 'p0').cash).toBe(1400);
    expect(P(s, 'p1').cash).toBe(1600);
    expect(P(s, 'p0').jailCards).toEqual(['chest']);
  });

  it('validates ownership, cash and buildings', () => {
    let s = newGame();
    give(s, 'p0', 1, 3);
    s = atAuctionHouse(s);
    expectError(() => act(s, 'p0', { type: 'proposeTrade', to: 'p1', offer: { cash: 0, properties: [6], jailCards: 0 }, request: { cash: 0, properties: [], jailCards: 0 } }), /does not own/);
    expectError(() => act(s, 'p0', { type: 'proposeTrade', to: 'p1', offer: { cash: 9999, properties: [], jailCards: 0 }, request: { cash: 0, properties: [], jailCards: 0 } }), /does not have/);
    s.props[3].houses = 1;
    expectError(() => act(s, 'p0', { type: 'proposeTrade', to: 'p1', offer: { cash: 0, properties: [1], jailCards: 0 }, request: { cash: 10, properties: [], jailCards: 0 } }), /buildings/);
  });

  it('counteroffers replace the original, rejections close it', () => {
    let s = newGame();
    give(s, 'p0', 1);
    s = atAuctionHouse(s);
    s = act(s, 'p0', { type: 'proposeTrade', to: 'p1', offer: { cash: 0, properties: [1], jailCards: 0 }, request: { cash: 200, properties: [], jailCards: 0 } });
    const id = s.trades[0].id;
    s = act(s, 'p1', { type: 'proposeTrade', to: 'p0', offer: { cash: 100, properties: [], jailCards: 0 }, request: { cash: 0, properties: [1], jailCards: 0 }, counterOf: id });
    expect(s.trades[0].status).toBe('countered');
    const counter = s.trades[1];
    s = act(s, 'p0', { type: 'rejectTrade', tradeId: counter.id });
    expect(s.trades[1].status).toBe('rejected');
    expect(s.props[1].owner).toBe('p0');
  });

  it('charges 10% interest when receiving a mortgaged property', () => {
    let s = newGame();
    give(s, 'p0', 39);
    s.props[39].mortgaged = true;
    s = atAuctionHouse(s);
    s = act(s, 'p0', { type: 'proposeTrade', to: 'p1', offer: { cash: 0, properties: [39], jailCards: 0 }, request: { cash: 100, properties: [], jailCards: 0 } });
    s = act(s, 'p1', { type: 'acceptTrade', tradeId: s.trades[0].id });
    expect(P(s, 'p1').cash).toBe(1500 - 100 - 20);
    expect(s.props[39].mortgaged).toBe(true);
  });

  it('rechecks validity when accepting', () => {
    let s = newGame();
    s = atAuctionHouse(s);
    s = act(s, 'p0', { type: 'proposeTrade', to: 'p1', offer: { cash: 1500, properties: [], jailCards: 0 }, request: { cash: 0, properties: [], jailCards: 0 } });
    P(s, 'p0').cash = 100;
    expectError(() => act(s, 'p1', { type: 'acceptTrade', tradeId: s.trades[0].id }), /no longer valid/);
  });

  const deal = { offer: { cash: 10, properties: [], jailCards: 0 }, request: { cash: 0, properties: [], jailCards: 0 } };

  it('is closed unless the current player has landed on the Auction House', () => {
    let s = newGame();
    expect(tradeWindowOpen(s)).toBe(false);
    expectError(() => act(s, 'p0', { type: 'proposeTrade', to: 'p1', ...deal }), /Auction House/);
    // Standing on the Auction House without having landed there this turn does not count.
    P(s, 'p0').position = 20;
    expectError(() => act(s, 'p0', { type: 'proposeTrade', to: 'p1', ...deal }), /Auction House/);
    s = newGame();
    s = atAuctionHouse(s);
    expect(tradeWindowOpen(s)).toBe(true);
    expect(s.phase).toBe('postRoll');
    s = act(s, 'p0', { type: 'proposeTrade', to: 'p1', ...deal });
    expect(s.trades[0].status).toBe('pending');
  });

  it('only the player at the Auction House can start a trade; others may counter', () => {
    let s = newGame();
    s = atAuctionHouse(s);
    expectError(() => act(s, 'p1', { type: 'proposeTrade', to: 'p0', ...deal }), /Only the player at the Auction House/);
    expectError(() => act(s, 'p1', { type: 'proposeTrade', to: 'p2', ...deal, counterOf: 999 }));
    s = act(s, 'p0', { type: 'proposeTrade', to: 'p1', ...deal });
    s = act(s, 'p1', { type: 'proposeTrade', to: 'p0', offer: { cash: 5, properties: [], jailCards: 0 }, request: deal.request, counterOf: s.trades[0].id });
    expect(s.trades.map((t) => t.status)).toEqual(['countered', 'pending']);
  });

  it('closes when the turn ends and withdraws open offers', () => {
    let s = newGame();
    s = atAuctionHouse(s);
    s = act(s, 'p0', { type: 'proposeTrade', to: 'p1', ...deal });
    s = act(s, 'p0', { type: 'endTurn' });
    expect(tradeWindowOpen(s)).toBe(false);
    expect(s.trades[0].status).toBe('cancelled');
    expectError(() => act(s, 'p1', { type: 'acceptTrade', tradeId: s.trades[0].id }), /no longer open/);
  });

  it('closes when the player moves off the Auction House after doubles', () => {
    let s = newGame();
    P(s, 'p0').position = 18;
    s = roll(s, 1, 1); // 20, doubles
    expect(tradeWindowOpen(s)).toBe(true);
    s = act(s, 'p0', { type: 'proposeTrade', to: 'p1', ...deal });
    s = roll(s, 1, 2); // 23 Milan
    expect(tradeWindowOpen(s)).toBe(false);
    expect(s.trades[0].status).toBe('cancelled');
  });
});

describe('debt and bankruptcy', () => {
  it('creates a pending debt instead of a negative balance, auto-settles after raising funds', () => {
    let s = newGame();
    give(s, 'p1', 6, 7);
    s.props[6].houses = 5;
    give(s, 'p0', 39, 1);
    P(s, 'p0').cash = 100;
    s = roll(s, 2, 4); // rent 550
    expect(P(s, 'p0').cash).toBe(100);
    expect(s.phase).toBe('debt');
    expect(s.debts[0]).toMatchObject({ debtor: 'p0', creditor: 'p1', amount: 550 });
    expectError(() => act(s, 'p0', { type: 'endTurn' }));
    s = act(s, 'p0', { type: 'mortgage', space: 39 }); // +200 = 300, not enough
    expect(s.phase).toBe('debt');
    P(s, 'p0').cash = 600; // e.g. after selling buildings elsewhere
    s = act(s, 'p0', { type: 'mortgage', space: 1 }); // +30 = 630, enough to settle
    expect(s.debts).toHaveLength(0);
    expect(P(s, 'p0').cash).toBe(80);
    expect(P(s, 'p1').cash).toBe(2050);
    expect(s.phase).toBe('postRoll');
  });

  it('bankruptcy to a player transfers cash, properties and jail cards', () => {
    let s = newGame(3);
    give(s, 'p1', 6, 7);
    s.props[6].houses = 5;
    give(s, 'p0', 1, 3, 39);
    s.props[1].houses = 1;
    s.props[3].houses = 1;
    s.props[39].mortgaged = true;
    s.bankHouses = 30;
    P(s, 'p0').cash = 10;
    P(s, 'p0').jailCards = ['chance'];
    s = roll(s, 2, 4);
    expect(s.phase).toBe('debt');
    expectError(() => act(s, 'p1', { type: 'declareBankruptcy' }), /only declare/);
    s = act(s, 'p0', { type: 'declareBankruptcy' });
    expect(P(s, 'p0').bankrupt).toBe(true);
    expect(P(s, 'p0').cash).toBe(0);
    expect(s.props[1].owner).toBe('p1');
    expect(s.props[1].houses).toBe(0);
    expect(s.props[39]).toMatchObject({ owner: 'p1', mortgaged: true });
    expect(s.bankHouses).toBe(32);
    // p1 receives 10 cash + 50 building liquidation, and pays 20 interest on the mortgaged property
    expect(P(s, 'p1').cash).toBe(1500 + 10 + 50 - 20);
    expect(P(s, 'p1').jailCards).toEqual(['chance']);
    expect(s.currentPlayer).toBe('p1');
    expect(s.transactions.some((t) => t.from === 'p0')).toBe(true); // history preserved
  });

  it('bankruptcy to the bank returns properties and auctions them', () => {
    let s = newGame(3);
    give(s, 'p0', 1, 3);
    s.props[3].mortgaged = true;
    P(s, 'p0').cash = 50;
    s = roll(s, 1, 3); // income tax 200
    expect(s.phase).toBe('debt');
    s = act(s, 'p0', { type: 'declareBankruptcy' });
    expect(P(s, 'p0').bankrupt).toBe(true);
    expect(s.props[3]).toMatchObject({ owner: null, mortgaged: false });
    expect(s.phase).toBe('auction');
    expect(s.auction?.space).toBe(1);
    expect(s.auctionQueue).toEqual([3]);
    expect(s.auction?.active).toEqual(['p1', 'p2']);
    s = act(s, 'p1', { type: 'bid', amount: 30 });
    s = act(s, 'p2', { type: 'passAuction' });
    expect(s.props[1].owner).toBe('p1');
    expect(s.auction?.space).toBe(3);
    s = act(s, 'p1', { type: 'passAuction' });
    s = act(s, 'p2', { type: 'passAuction' });
    expect(s.phase).toBe('preRoll');
    expect(s.currentPlayer).toBe('p1');
  });

  it('bankrupt players are skipped in turn order', () => {
    let s = newGame(3);
    P(s, 'p1').bankrupt = true;
    s = roll(s, 6, 4);
    s = act(s, 'p0', { type: 'endTurn' });
    expect(s.currentPlayer).toBe('p2');
  });
});

describe('winning conditions', () => {
  it('classic: the last solvent player wins', () => {
    let s = newGame(2);
    give(s, 'p1', 6, 7);
    s.props[6].houses = 5;
    P(s, 'p0').cash = 10;
    s = roll(s, 2, 4);
    s = act(s, 'p0', { type: 'declareBankruptcy' });
    expect(s.status).toBe('finished');
    expect(s.winner).toBe('p1');
    expect(s.phase).toBe('gameOver');
    expectError(() => roll(s, 1, 2), /over/);
  });

  it('timed: highest net worth wins when time runs out', () => {
    let s = newGame(3, { mode: 'timed', durationMinutes: 30 });
    expect(s.endsAt).toBe(NOW + 30 * 60_000);
    give(s, 'p2', 39);
    s.props[39].houses = 0;
    expectError(() => act(s, 'system', { type: 'timeUp' }, { now: NOW + 1000 }), /not up/);
    s = act(s, 'system', { type: 'timeUp' }, { now: NOW + 30 * 60_000 });
    expect(s.status).toBe('finished');
    expect(s.winner).toBe('p2');
    expect(s.finalScores?.[0]).toMatchObject({ player: 'p2', netWorth: 1900 });
  });

  it('net worth: cash + price (or mortgage value) + building cost', () => {
    const s = newGame();
    give(s, 'p0', 1, 3, 39);
    s.props[1].houses = 2;
    s.props[39].mortgaged = true;
    expect(scorePlayer(s, 'p0').netWorth).toBe(1500 + 60 + 60 + 200 + 100);
  });

  it('pausing freezes the timed clock', () => {
    let s = newGame(3, { mode: 'timed', durationMinutes: 10 });
    s = act(s, 'system', { type: 'pause' }, { now: NOW + 60_000 });
    expectError(() => roll(s, 1, 2), /paused/);
    s = act(s, 'system', { type: 'resume' }, { now: NOW + 5 * 60_000 });
    expect(s.endsAt).toBe(NOW + 14 * 60_000);
  });
});

describe('immutability', () => {
  it('never mutates the previous state', () => {
    const s = newGame();
    const snapshot = JSON.stringify(s);
    roll(s, 3, 4);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
