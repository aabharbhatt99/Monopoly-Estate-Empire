import {
  AUCTION_HOUSE_INDEX,
  BOARD,
  GROUP_MEMBERS,
  JAIL_INDEX,
  PURCHASABLE,
  RANDOM_INDEX,
  RAILROADS,
  TOTAL_HOTELS,
  TOTAL_HOUSES,
  UTILITIES,
  isPurchasable,
  membersOf,
  ownershipGroupOf,
} from './board';
import { DECKS, DECK_NAMES, jailFreeCardId } from './cards';
import type {
  ActionContext,
  ActorAction,
  ColorGroup,
  DeckId,
  GameConfig,
  GameState,
  LogKind,
  Party,
  Phase,
  PlayerSetup,
  PlayerState,
  Score,
  Trade,
  TradeSide,
} from './types';

export class GameError extends Error {}

function fail(message: string): never {
  throw new GameError(message);
}

export const DEFAULT_CONFIG: GameConfig = {
  startingCash: 1500,
  goSalary: 200,
  mode: 'classic',
  durationMinutes: 60,
  auctionSeconds: 15,
  currency: '$',
  spaceNames: {},
  jailFine: 50,
  maxJailTurns: 3,
};

export const MIN_PLAYERS = 2; // engine minimum; the lobby enforces 4–10 for real games
export const MAX_PLAYERS = 10;
const MAX_LOG = 400;

// ───────────────────────────── RNG ─────────────────────────────

/** mulberry32 – deterministic, state lives inside the game state. */
export function random(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function rollDie(s: GameState): number {
  return 1 + Math.floor(random(s) * 6);
}

function shuffle<T>(s: GameState, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ───────────────────────────── Helpers ─────────────────────────────

export function spaceName(s: GameState, index: number): string {
  return s.config.spaceNames?.[index]?.trim() || BOARD[index].name;
}

export function money(s: GameState, amount: number): string {
  return `${s.config.currency}${amount.toLocaleString('en-US')}`;
}

export function getPlayer(s: GameState, id: string): PlayerState {
  const p = s.players.find((x) => x.id === id);
  if (!p) fail('Unknown player.');
  return p;
}

export function activePlayers(s: GameState): PlayerState[] {
  return s.players.filter((p) => !p.bankrupt);
}

function nextId(s: GameState): number {
  return ++s.seq;
}

function log(s: GameState, kind: LogKind, text: string, player?: string, ts = Date.now()) {
  s.log.push({ id: nextId(s), ts, kind, text, player });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

function partyName(s: GameState, p: Party): string {
  return p === 'bank' ? 'the Bank' : getPlayer(s, p).name;
}

/** Moves cash and records a transaction. Callers must have verified funds. */
function transfer(s: GameState, from: Party, to: Party, amount: number, reason: string, ts = Date.now()) {
  if (amount <= 0) return;
  if (from !== 'bank') {
    const p = getPlayer(s, from);
    if (p.cash < amount) fail(`${p.name} cannot afford ${money(s, amount)}.`);
    p.cash -= amount;
  }
  if (to !== 'bank') getPlayer(s, to).cash += amount;
  s.transactions.push({ id: nextId(s), ts, from, to, amount, reason });
}

/**
 * Charge a player. Pays immediately when the player has the cash (and no earlier debts),
 * otherwise records a pending debt the player must settle by raising funds or declaring bankruptcy.
 */
function charge(s: GameState, debtor: string, creditor: Party, amount: number, reason: string) {
  if (amount <= 0) return;
  const p = getPlayer(s, debtor);
  if (p.bankrupt) return;
  const hasEarlier = s.debts.some((d) => d.debtor === debtor);
  if (!hasEarlier && p.cash >= amount) {
    transfer(s, debtor, creditor, amount, reason);
    return;
  }
  s.debts.push({ id: nextId(s), debtor, creditor, amount, reason });
  log(s, 'debt', `${p.name} owes ${money(s, amount)} to ${partyName(s, creditor)} (${reason}) but only has ${money(s, p.cash)}. Raise funds or declare bankruptcy.`, debtor);
}

export function ownsWholeGroup(s: GameState, playerId: string, group: ColorGroup): boolean {
  return GROUP_MEMBERS[group].every((i) => s.props[i].owner === playerId);
}

export function groupHasBuildings(s: GameState, group: ColorGroup): boolean {
  return GROUP_MEMBERS[group].some((i) => s.props[i].houses > 0);
}

export function unmortgageCost(index: number): number {
  const m = BOARD[index].mortgage!;
  return m + Math.ceil(m / 10);
}

export function mortgageInterest(index: number): number {
  return Math.ceil(BOARD[index].mortgage! / 10);
}

/** Rent owed when landing on `index`. `diceTotal` is used for utilities. */
export function calculateRent(s: GameState, index: number, diceTotal: number): number {
  const def = BOARD[index];
  const ps = s.props[index];
  if (!ps || !ps.owner || ps.mortgaged) return 0;
  if (def.kind === 'property') {
    if (ps.houses > 0) return def.rent![ps.houses];
    const base = def.rent![0];
    return ownsWholeGroup(s, ps.owner, def.group!) ? base * 2 : base;
  }
  if (def.kind === 'railroad') {
    const n = RAILROADS.filter((i) => s.props[i].owner === ps.owner).length;
    return 25 * 2 ** (n - 1);
  }
  if (def.kind === 'utility') {
    const n = UTILITIES.filter((i) => s.props[i].owner === ps.owner).length;
    return (n === 2 ? 10 : 4) * diceTotal;
  }
  return 0;
}

export function ownedBy(s: GameState, playerId: string): number[] {
  return PURCHASABLE.filter((i) => s.props[i].owner === playerId);
}

export function completedGroups(s: GameState, playerId: string): ColorGroup[] {
  return (Object.keys(GROUP_MEMBERS) as ColorGroup[]).filter((g) => ownsWholeGroup(s, playerId, g));
}

export function buildingCounts(s: GameState, playerId: string): { houses: number; hotels: number } {
  let houses = 0;
  let hotels = 0;
  for (const i of ownedBy(s, playerId)) {
    const h = s.props[i].houses;
    if (h === 5) hotels++;
    else houses += h;
  }
  return { houses, hotels };
}

/**
 * Net worth scoring rule (used for timed mode and dashboards):
 *   cash
 * + printed price of each unmortgaged property (mortgage value if mortgaged)
 * + purchase cost of every building (a hotel counts as 5 × house cost)
 * − any outstanding debts.
 */
export function scorePlayer(s: GameState, playerId: string): Score {
  const p = getPlayer(s, playerId);
  let propertyValue = 0;
  let buildingValue = 0;
  for (const i of ownedBy(s, playerId)) {
    const ps = s.props[i];
    const def = BOARD[i];
    propertyValue += ps.mortgaged ? def.mortgage! : def.price!;
    if (def.houseCost) buildingValue += ps.houses * def.houseCost;
  }
  const debts = s.debts.filter((d) => d.debtor === playerId).reduce((a, d) => a + d.amount, 0);
  const cash = p.bankrupt ? 0 : p.cash;
  return { player: playerId, cash, propertyValue, buildingValue, debts, netWorth: cash + propertyValue + buildingValue - debts };
}

/** Maximum cash a player could raise by selling every building and mortgaging everything. */
export function liquidationValue(s: GameState, playerId: string): number {
  let total = 0;
  for (const i of ownedBy(s, playerId)) {
    const ps = s.props[i];
    const def = BOARD[i];
    if (def.houseCost) total += (ps.houses * def.houseCost) / 2;
    if (!ps.mortgaged) total += def.mortgage!;
  }
  return total;
}

export function computePhase(s: GameState): Phase {
  if (s.status === 'finished') return 'gameOver';
  if (s.debts.length) return 'debt';
  if (s.auction) return 'auction';
  if (s.pendingPurchase !== null) return 'buyDecision';
  if (s.turn.hasRolled && !s.turn.canRollAgain) return 'postRoll';
  return 'preRoll';
}

// ───────────────────────────── Setup ─────────────────────────────

export interface CreateGameOptions {
  id: string;
  players: PlayerSetup[];
  config?: Partial<GameConfig>;
  seed?: number;
  now?: number;
}

export function createGame(opts: CreateGameOptions): GameState {
  const now = opts.now ?? Date.now();
  const config: GameConfig = { ...DEFAULT_CONFIG, ...(opts.config ?? {}), spaceNames: { ...(opts.config?.spaceNames ?? {}) } };
  if (opts.players.length < MIN_PLAYERS || opts.players.length > MAX_PLAYERS) fail(`A game needs ${MIN_PLAYERS}–${MAX_PLAYERS} players.`);
  const ids = new Set(opts.players.map((p) => p.id));
  const tokens = new Set(opts.players.map((p) => p.token));
  if (ids.size !== opts.players.length) fail('Player ids must be unique.');
  if (tokens.size !== opts.players.length) fail('Every player needs a unique token.');
  if (!(config.startingCash > 0)) fail('Starting cash must be positive.');

  const props: GameState['props'] = {};
  for (const i of PURCHASABLE) props[i] = { owner: null, houses: 0, mortgaged: false };

  const s: GameState = {
    id: opts.id,
    version: 0,
    createdAt: now,
    config,
    players: opts.players.map((p) => ({
      ...p,
      cash: config.startingCash,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      bankrupt: false,
    })),
    props,
    bankHouses: TOTAL_HOUSES,
    bankHotels: TOTAL_HOTELS,
    currentPlayer: '',
    turn: { number: 1, hasRolled: false, canRollAgain: false, doublesCount: 0, dice: null, rollSeq: 0 },
    phase: 'preRoll',
    pendingPurchase: null,
    auction: null,
    auctionQueue: [],
    debts: [],
    trades: [],
    decks: { chance: [], chest: [] },
    lastCard: null,
    moves: [],
    log: [],
    transactions: [],
    rng: (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    seq: 0,
    paused: null,
    endsAt: config.mode === 'timed' ? now + config.durationMinutes * 60_000 : null,
    status: 'playing',
    winner: null,
    endReason: null,
    finalScores: null,
    eliminatedCount: 0,
  };
  s.decks.chance = shuffle(s, DECKS.chance.map((c) => c.id));
  s.decks.chest = shuffle(s, DECKS.chest.map((c) => c.id));
  // Randomly choose the first player, then keep seating order from there.
  const first = Math.floor(random(s) * s.players.length);
  s.players = [...s.players.slice(first), ...s.players.slice(0, first)];
  s.currentPlayer = s.players[0].id;
  log(s, 'system', `Game started with ${s.players.length} players. Each player receives ${money(s, config.startingCash)}.`, undefined, now);
  if (config.mode === 'timed') log(s, 'system', `Timed game: ${config.durationMinutes} minutes. Highest net worth wins.`, undefined, now);
  log(s, 'turn', `${s.players[0].name} was drawn to go first.`, s.players[0].id, now);
  s.phase = computePhase(s);
  return s;
}

// ───────────────────────────── Movement ─────────────────────────────

function collectSalary(s: GameState, p: PlayerState) {
  transfer(s, 'bank', p.id, s.config.goSalary, `Passed ${spaceName(s, 0)}`);
  log(s, 'go', `${p.name} collects ${money(s, s.config.goSalary)} salary at ${spaceName(s, 0)}.`, p.id);
}

/** Trading is open only while the current player stands on the Auction House after landing there. */
export function tradeWindowOpen(s: GameState): boolean {
  if (s.status !== 'playing' || !s.turn.tradeOpen) return false;
  const p = s.players.find((x) => x.id === s.currentPlayer);
  return !!p && !p.bankrupt && p.position === AUCTION_HOUSE_INDEX;
}

/** Closes the trading window and withdraws any offers still open. */
function closeTradeWindow(s: GameState, now = Date.now()) {
  if (!s.turn.tradeOpen) return;
  s.turn.tradeOpen = false;
  const open = s.trades.filter((t) => t.status === 'pending');
  for (const t of open) t.status = 'cancelled';
  if (open.length) log(s, 'trade', `Trading at the ${spaceName(s, AUCTION_HOUSE_INDEX)} has closed. ${open.length} open offer${open.length > 1 ? 's were' : ' was'} withdrawn.`, undefined, now);
}

function leaveSpace(s: GameState, p: PlayerState) {
  if (p.id === s.currentPlayer) closeTradeWindow(s);
}

function moveForward(s: GameState, p: PlayerState, steps: number) {
  leaveSpace(s, p);
  const path: number[] = [];
  for (let k = 0; k < steps; k++) {
    p.position = (p.position + 1) % 40;
    path.push(p.position);
    if (p.position === 0) collectSalary(s, p);
  }
  s.moves.push({ seq: nextId(s), player: p.id, path, teleport: false });
}

function moveForwardTo(s: GameState, p: PlayerState, target: number) {
  const steps = (target - p.position + 40) % 40;
  moveForward(s, p, steps === 0 ? 40 : steps);
}

function moveBackward(s: GameState, p: PlayerState, steps: number) {
  leaveSpace(s, p);
  const path: number[] = [];
  for (let k = 0; k < steps; k++) {
    p.position = (p.position + 39) % 40;
    path.push(p.position);
  }
  s.moves.push({ seq: nextId(s), player: p.id, path, teleport: false });
}

function sendToJail(s: GameState, p: PlayerState, why: string) {
  leaveSpace(s, p);
  p.position = JAIL_INDEX;
  p.inJail = true;
  p.jailTurns = 0;
  s.moves.push({ seq: nextId(s), player: p.id, path: [JAIL_INDEX], teleport: true });
  if (p.id === s.currentPlayer) {
    s.turn.canRollAgain = false;
    s.turn.hasRolled = true;
  }
  log(s, 'jail', `${p.name} goes to jail (${why}).`, p.id);
}

interface LandingContext {
  diceTotal: number;
  cardRule?: 'railroad2x' | 'utility10x';
}

function resolveLanding(s: GameState, p: PlayerState, ctx: LandingContext, depth = 0) {
  if (depth > 5) return;
  const idx = p.position;
  const def = BOARD[idx];
  const name = spaceName(s, idx);
  switch (def.kind) {
    case 'property':
    case 'railroad':
    case 'utility': {
      const ps = s.props[idx];
      if (!ps.owner) {
        s.pendingPurchase = idx;
        log(s, 'info', `${p.name} landed on ${name} — it's for sale at ${money(s, def.price!)}.`, p.id);
        return;
      }
      if (ps.owner === p.id) {
        log(s, 'info', `${p.name} landed on their own property, ${name}.`, p.id);
        return;
      }
      const owner = getPlayer(s, ps.owner);
      if (ps.mortgaged) {
        log(s, 'rent', `${name} is mortgaged — no rent due to ${owner.name}.`, p.id);
        return;
      }
      let rent: number;
      if (def.kind === 'utility' && ctx.cardRule === 'utility10x') {
        const d1 = rollDie(s);
        const d2 = rollDie(s);
        rent = (d1 + d2) * 10;
        log(s, 'dice', `${p.name} rolls ${d1} + ${d2} for the utility card: 10 × ${d1 + d2}.`, p.id);
      } else {
        rent = calculateRent(s, idx, ctx.diceTotal);
        if (def.kind === 'railroad' && ctx.cardRule === 'railroad2x') rent *= 2;
      }
      log(s, 'rent', `${p.name} pays ${money(s, rent)} rent to ${owner.name} for ${name}.`, p.id);
      charge(s, p.id, owner.id, rent, `Rent: ${name}`);
      return;
    }
    case 'tax':
      log(s, 'tax', `${p.name} pays ${money(s, def.tax!)} ${name}.`, p.id);
      charge(s, p.id, 'bank', def.tax!, name);
      return;
    case 'random': {
      const deck: DeckId = random(s) < 0.5 ? 'chance' : 'chest';
      log(s, 'card', `${p.name} lands on ${name}. The draw picks the ${DECK_NAMES[deck]} deck.`, p.id);
      drawCard(s, p, deck, ctx, depth);
      return;
    }
    case 'chance':
    case 'chest':
      drawCard(s, p, def.kind, ctx, depth);
      return;
    case 'jail':
      log(s, 'info', `${p.name} is just visiting the jail.`, p.id);
      return;
    case 'auctionHouse':
      if (p.id === s.currentPlayer && idx === AUCTION_HOUSE_INDEX) {
        s.turn.tradeOpen = true;
        log(s, 'trade', `${p.name} arrives at the ${name}. Trading is open until they leave or end their turn.`, p.id);
      }
      return;
    case 'go':
      return;
  }
}

function drawCard(s: GameState, p: PlayerState, deck: DeckId, ctx: LandingContext, depth: number) {
  const cardId = s.decks[deck].shift()!;
  const card = DECKS[deck][cardId];
  if (card.effect.type !== 'jailFree') s.decks[deck].push(cardId);
  const text = card.text.replace(/\$/g, s.config.currency);
  s.lastCard = { seq: nextId(s), deck, cardId, text, player: p.id };
  log(s, 'card', `${p.name} draws ${DECK_NAMES[deck]}: “${text}”`, p.id);
  const e = card.effect;
  switch (e.type) {
    case 'advance':
      moveForwardTo(s, p, e.to);
      resolveLanding(s, p, { diceTotal: ctx.diceTotal }, depth + 1);
      return;
    case 'advanceNearest': {
      const list = e.kind === 'railroad' ? RAILROADS : UTILITIES;
      const target = list.find((i) => i > p.position) ?? list[0];
      moveForwardTo(s, p, target);
      resolveLanding(s, p, { diceTotal: ctx.diceTotal, cardRule: e.kind === 'railroad' ? 'railroad2x' : 'utility10x' }, depth + 1);
      return;
    }
    case 'back':
      moveBackward(s, p, e.spaces);
      resolveLanding(s, p, { diceTotal: ctx.diceTotal }, depth + 1);
      return;
    case 'collect':
      transfer(s, 'bank', p.id, e.amount, `${DECK_NAMES[deck]} card`);
      return;
    case 'pay':
      charge(s, p.id, 'bank', e.amount, `${DECK_NAMES[deck]} card`);
      return;
    case 'jail':
      sendToJail(s, p, `${DECK_NAMES[deck]} card`);
      return;
    case 'jailFree':
      p.jailCards.push(deck);
      return;
    case 'repairs': {
      const { houses, hotels } = buildingCounts(s, p.id);
      const total = houses * e.perHouse + hotels * e.perHotel;
      log(s, 'tax', `${p.name} has ${houses} house(s) and ${hotels} hotel(s): repairs cost ${money(s, total)}.`, p.id);
      charge(s, p.id, 'bank', total, 'Building repairs');
      return;
    }
    case 'payEach':
      for (const o of activePlayers(s)) if (o.id !== p.id) charge(s, p.id, o.id, e.amount, `${DECK_NAMES[deck]} card`);
      return;
    case 'collectEach':
      for (const o of activePlayers(s)) if (o.id !== p.id) charge(s, o.id, p.id, e.amount, `${DECK_NAMES[deck]} card`);
      return;
  }
}

// ───────────────────────────── Validators (shared with UI) ─────────────────────────────
// Each returns null when the action is allowed, or a human-readable reason when it is not.

function ownerCheck(s: GameState, playerId: string, index: number): string | null {
  if (!isPurchasable(index)) return 'That space cannot be owned.';
  if (s.props[index].owner !== playerId) return 'You do not own that property.';
  return null;
}

export function checkBuild(s: GameState, playerId: string, index: number): string | null {
  const o = ownerCheck(s, playerId, index);
  if (o) return o;
  const def = BOARD[index];
  if (def.kind !== 'property') return 'Only colour-group properties can be built on.';
  if (s.auction) return 'Wait until the auction finishes.';
  if (s.debts.some((d) => d.debtor === playerId)) return 'Settle your debts before building.';
  const group = def.group!;
  if (!ownsWholeGroup(s, playerId, group)) return 'You must own the complete colour group first.';
  const members = GROUP_MEMBERS[group];
  if (members.some((i) => s.props[i].mortgaged)) return 'Unmortgage every property in this group first.';
  const ps = s.props[index];
  if (ps.houses >= 5) return 'This property already has a hotel.';
  const min = Math.min(...members.map((i) => s.props[i].houses));
  if (ps.houses > min) return 'Build evenly: add houses to the other properties in this group first.';
  if (ps.houses === 4) {
    if (s.bankHotels <= 0) return 'The bank has no hotels left.';
  } else if (s.bankHouses <= 0) return 'The bank has no houses left (housing shortage).';
  if (getPlayer(s, playerId).cash < def.houseCost!) return `You need ${money(s, def.houseCost!)} to build here.`;
  return null;
}

export function checkSellBuilding(s: GameState, playerId: string, index: number): string | null {
  const o = ownerCheck(s, playerId, index);
  if (o) return o;
  const def = BOARD[index];
  if (def.kind !== 'property') return 'There are no buildings here.';
  const ps = s.props[index];
  if (ps.houses === 0) return 'There are no buildings to sell here.';
  const max = Math.max(...GROUP_MEMBERS[def.group!].map((i) => s.props[i].houses));
  if (ps.houses < max) return 'Sell evenly: sell from the more developed properties in this group first.';
  if (ps.houses === 5 && s.bankHouses < 4) return 'The bank lacks 4 houses to break this hotel down. Use "Sell all buildings in group" instead.';
  return null;
}

export function checkMortgage(s: GameState, playerId: string, index: number): string | null {
  const o = ownerCheck(s, playerId, index);
  if (o) return o;
  if (s.props[index].mortgaged) return 'Already mortgaged.';
  const def = BOARD[index];
  if (def.kind === 'property' && groupHasBuildings(s, def.group!)) return 'Sell all buildings in this colour group first.';
  return null;
}

export function checkUnmortgage(s: GameState, playerId: string, index: number): string | null {
  const o = ownerCheck(s, playerId, index);
  if (o) return o;
  if (!s.props[index].mortgaged) return 'This property is not mortgaged.';
  if (s.auction) return 'Wait until the auction finishes.';
  if (s.debts.some((d) => d.debtor === playerId)) return 'Settle your debts first.';
  const cost = unmortgageCost(index);
  if (getPlayer(s, playerId).cash < cost) return `You need ${money(s, cost)} to lift this mortgage.`;
  return null;
}

function validateSide(s: GameState, playerId: string, side: TradeSide, label: string): string | null {
  const p = getPlayer(s, playerId);
  if (!Number.isInteger(side.cash) || side.cash < 0) return 'Cash amounts must be whole, non-negative numbers.';
  if (!Number.isInteger(side.jailCards) || side.jailCards < 0) return 'Invalid number of jail cards.';
  if (side.cash > p.cash) return `${label} does not have ${money(s, side.cash)}.`;
  if (side.jailCards > p.jailCards.length) return `${label} does not have that many Get Out of Jail Free cards.`;
  if (new Set(side.properties).size !== side.properties.length) return 'A property is listed twice.';
  for (const i of side.properties) {
    if (!isPurchasable(i)) return 'Invalid property in trade.';
    if (s.props[i].owner !== playerId) return `${label} does not own ${spaceName(s, i)}.`;
    const def = BOARD[i];
    if (def.kind === 'property' && groupHasBuildings(s, def.group!))
      return `${spaceName(s, i)}'s colour group has buildings — they must be sold before trading.`;
  }
  return null;
}

function interestFor(props: number[], s: GameState): number {
  return props.filter((i) => s.props[i].mortgaged).reduce((a, i) => a + mortgageInterest(i), 0);
}

export function checkTrade(s: GameState, from: string, to: string, offer: TradeSide, request: TradeSide): string | null {
  if (from === to) return 'You cannot trade with yourself.';
  const a = s.players.find((p) => p.id === from);
  const b = s.players.find((p) => p.id === to);
  if (!a || !b) return 'Unknown player.';
  if (a.bankrupt || b.bankrupt) return 'Bankrupt players cannot trade.';
  if (s.auction) return 'Trades are paused during an auction.';
  if (!tradeWindowOpen(s)) return `Trading is only open when the current player lands on the ${spaceName(s, AUCTION_HOUSE_INDEX)}.`;
  if (from !== s.currentPlayer && to !== s.currentPlayer) return `Only ${getPlayer(s, s.currentPlayer).name}, who is at the ${spaceName(s, AUCTION_HOUSE_INDEX)}, can trade right now.`;
  const empty = (x: TradeSide) => x.cash === 0 && x.properties.length === 0 && x.jailCards === 0;
  if (empty(offer) && empty(request)) return 'The trade is empty.';
  const e1 = validateSide(s, from, offer, a.name);
  if (e1) return e1;
  const e2 = validateSide(s, to, request, b.name);
  if (e2) return e2;
  // Receiving a mortgaged property costs 10% interest immediately.
  const aCashAfter = a.cash - offer.cash + request.cash;
  const bCashAfter = b.cash - request.cash + offer.cash;
  if (aCashAfter < interestFor(request.properties, s)) return `${a.name} could not afford the 10% interest on mortgaged properties received.`;
  if (bCashAfter < interestFor(offer.properties, s)) return `${b.name} could not afford the 10% interest on mortgaged properties received.`;
  return null;
}

// ───────────────────────────── Turn flow ─────────────────────────────

function advanceTurn(s: GameState, now: number) {
  const alive = activePlayers(s);
  if (alive.length <= 1) return;
  closeTradeWindow(s, now);
  const idx = s.players.findIndex((p) => p.id === s.currentPlayer);
  let n = idx;
  for (let k = 0; k < s.players.length; k++) {
    n = (n + 1) % s.players.length;
    if (!s.players[n].bankrupt) break;
  }
  s.currentPlayer = s.players[n].id;
  s.pendingPurchase = null;
  s.turn = { number: s.turn.number + 1, hasRolled: false, canRollAgain: false, doublesCount: 0, dice: s.turn.dice, rollSeq: s.turn.rollSeq };
  const p = s.players[n];
  log(s, 'turn', `It's ${p.name}'s turn${p.inJail ? ' (in jail)' : ''}.`, p.id, now);
}

function startAuction(s: GameState, space: number, now: number, reason: 'declined' | 'bankruptcy') {
  const active = activePlayers(s).map((p) => p.id);
  s.auction = {
    space,
    highBid: 0,
    highBidder: null,
    active,
    endsAt: s.config.auctionSeconds > 0 ? now + s.config.auctionSeconds * 1000 : null,
    reason,
  };
  log(s, 'auction', `Auction opened for ${spaceName(s, space)} (listed at ${money(s, BOARD[space].price!)}).`, undefined, now);
}

function finishAuction(s: GameState) {
  const a = s.auction!;
  s.auction = null;
  if (a.highBidder) {
    const w = getPlayer(s, a.highBidder);
    transfer(s, w.id, 'bank', a.highBid, `Auction: ${spaceName(s, a.space)}`);
    s.props[a.space].owner = w.id;
    log(s, 'auction', `${w.name} wins the auction for ${spaceName(s, a.space)} with ${money(s, a.highBid)}.`, w.id);
  } else {
    log(s, 'auction', `No bids — ${spaceName(s, a.space)} stays with the bank.`);
  }
}

function declareBankruptcy(s: GameState, playerId: string, now: number) {
  const p = getPlayer(s, playerId);
  const debt = s.debts.find((d) => d.debtor === playerId);
  const creditor: Party = debt?.creditor ?? 'bank';
  const creditorAlive = creditor === 'bank' || !getPlayer(s, creditor).bankrupt;
  const target: Party = creditorAlive ? creditor : 'bank';
  s.debts = s.debts.filter((d) => d.debtor !== playerId);

  // 1. Buildings are sold back to the bank at half price.
  for (const i of ownedBy(s, playerId)) {
    const ps = s.props[i];
    if (ps.houses > 0) {
      const refund = (ps.houses * BOARD[i].houseCost!) / 2;
      if (ps.houses === 5) s.bankHotels++;
      else s.bankHouses += ps.houses;
      ps.houses = 0;
      transfer(s, 'bank', playerId, refund, `Liquidated buildings on ${spaceName(s, i)}`, now);
    }
  }
  const props = ownedBy(s, playerId);
  if (target === 'bank') {
    if (p.cash > 0) transfer(s, playerId, 'bank', p.cash, 'Bankruptcy', now);
    for (const i of props) {
      s.props[i] = { owner: null, houses: 0, mortgaged: false };
      s.auctionQueue.push(i);
    }
    for (const d of p.jailCards) s.decks[d].push(jailFreeCardId(d));
    p.jailCards = [];
    log(s, 'bankrupt', `${p.name} is bankrupt to the Bank. Their ${props.length} propert${props.length === 1 ? 'y' : 'ies'} will be auctioned.`, p.id, now);
  } else {
    const c = getPlayer(s, target);
    if (p.cash > 0) transfer(s, playerId, c.id, p.cash, `Bankruptcy of ${p.name}`, now);
    for (const i of props) s.props[i].owner = c.id;
    c.jailCards.push(...p.jailCards);
    p.jailCards = [];
    log(s, 'bankrupt', `${p.name} is bankrupt to ${c.name}, who takes all their assets.`, p.id, now);
    const interest = interestFor(props, s);
    if (interest > 0) {
      log(s, 'mortgage', `${c.name} pays ${money(s, interest)} interest on inherited mortgaged properties.`, c.id, now);
      charge(s, c.id, 'bank', interest, 'Interest on inherited mortgages');
    }
  }
  p.bankrupt = true;
  p.cash = 0;
  p.inJail = false;
  p.eliminatedOrder = ++s.eliminatedCount;
  for (const t of s.trades) if (t.status === 'pending' && (t.from === playerId || t.to === playerId)) t.status = 'cancelled';
  if (s.auction) {
    s.auction.active = s.auction.active.filter((x) => x !== playerId);
    if (s.auction.highBidder === playerId) {
      s.auction.highBidder = null;
      s.auction.highBid = 0;
    }
  }
  if (s.currentPlayer === playerId) {
    s.pendingPurchase = null;
    advanceTurn(s, now);
  }
}

function finishGame(s: GameState, reason: string, now: number) {
  const scores = s.players.map((p) => scorePlayer(s, p.id));
  const alive = activePlayers(s);
  let winner: string;
  if (alive.length === 1) winner = alive[0].id;
  else {
    const ranked = scores
      .filter((x) => !getPlayer(s, x.player).bankrupt)
      .sort((a, b) => b.netWorth - a.netWorth || b.cash - a.cash);
    winner = ranked[0].player;
  }
  s.status = 'finished';
  s.winner = winner;
  s.endReason = reason;
  s.finalScores = scores.sort((a, b) => {
    const pa = getPlayer(s, a.player);
    const pb = getPlayer(s, b.player);
    if (pa.bankrupt !== pb.bankrupt) return pa.bankrupt ? 1 : -1;
    if (pa.bankrupt && pb.bankrupt) return (pb.eliminatedOrder ?? 0) - (pa.eliminatedOrder ?? 0);
    return b.netWorth - a.netWorth || b.cash - a.cash;
  });
  s.auction = null;
  s.pendingPurchase = null;
  log(s, 'win', `🏆 ${getPlayer(s, winner).name} wins! (${reason})`, winner, now);
}

/** Housekeeping after every action: auto-pay debts that can now be paid, start queued auctions, check end conditions. */
function settle(s: GameState, now: number) {
  let guard = 0;
  while (s.debts.length && guard++ < 200) {
    const d = s.debts[0];
    const p = getPlayer(s, d.debtor);
    if (p.bankrupt || (d.creditor !== 'bank' && getPlayer(s, d.creditor).bankrupt)) {
      s.debts.shift();
      continue;
    }
    if (p.cash >= d.amount) {
      transfer(s, d.debtor, d.creditor, d.amount, d.reason, now);
      s.debts.shift();
      log(s, 'debt', `${p.name} settles the ${money(s, d.amount)} owed to ${partyName(s, d.creditor)}.`, p.id, now);
      continue;
    }
    break;
  }
  if (s.status === 'playing' && activePlayers(s).length <= 1) finishGame(s, 'last solvent player standing', now);
  if (s.status === 'playing' && s.config.mode === 'timed' && s.endsAt !== null && !s.paused && now >= s.endsAt)
    finishGame(s, 'time is up — highest net worth', now);
  if (s.status === 'playing' && !s.debts.length && !s.auction && s.auctionQueue.length) {
    const next = s.auctionQueue.shift()!;
    if (!s.props[next].owner) startAuction(s, next, now, 'bankruptcy');
  }
  s.phase = computePhase(s);
}

// ───────────────────────────── Reducer ─────────────────────────────

function requireCurrent(s: GameState, actor: string) {
  if (actor !== s.currentPlayer) fail("It is not your turn.");
}

function requirePhase(s: GameState, ...phases: Phase[]) {
  if (!phases.includes(s.phase)) fail(`That action is not available right now (${s.phase}).`);
}

function requirePlayer(s: GameState, actor: string): PlayerState {
  const p = s.players.find((x) => x.id === actor);
  if (!p) fail('Only players can do that.');
  if (p.bankrupt) fail('Bankrupt players can no longer act.');
  return p;
}

function assertOk(reason: string | null) {
  if (reason) fail(reason);
}

const SYSTEM_ACTIONS = new Set(['pause', 'resume', 'timeUp', 'auctionTimeout', 'endGame']);

/**
 * Pure reducer: returns a new state with the action applied, or throws GameError.
 * The input state is never mutated.
 */
export function applyAction(prev: GameState, action: ActorAction, ctx: ActionContext): GameState {
  if (prev.status === 'finished') fail('The game is over.');
  if (prev.paused && action.type !== 'resume') fail('The game is paused.');
  const s: GameState = structuredClone(prev);
  s.moves = [];
  const now = ctx.now;
  s.phase = computePhase(s);
  if (!SYSTEM_ACTIONS.has(action.type)) requirePlayer(s, action.actor);
  const actor = action.actor;

  switch (action.type) {
    case 'roll': {
      requireCurrent(s, actor);
      requirePhase(s, 'preRoll');
      const p = getPlayer(s, actor);
      const dice: [number, number] = ctx.dice ?? [rollDie(s), rollDie(s)];
      if (!dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) fail('Invalid dice.');
      const total = dice[0] + dice[1];
      const doubles = dice[0] === dice[1];
      s.turn.dice = dice;
      s.turn.rollSeq++;
      s.turn.hasRolled = true;
      log(s, 'dice', `${p.name} rolls ${dice[0]} + ${dice[1]} = ${total}${doubles ? ' (doubles!)' : ''}.`, p.id, now);

      if (p.inJail) {
        s.turn.canRollAgain = false;
        if (doubles) {
          p.inJail = false;
          p.jailTurns = 0;
          log(s, 'jail', `${p.name} rolled doubles and walks out of jail.`, p.id, now);
        } else {
          p.jailTurns++;
          if (p.jailTurns >= s.config.maxJailTurns) {
            p.inJail = false;
            p.jailTurns = 0;
            log(s, 'jail', `${p.name} failed a third time and must pay the ${money(s, s.config.jailFine)} fine.`, p.id, now);
            charge(s, p.id, 'bank', s.config.jailFine, 'Jail fine');
          } else {
            log(s, 'jail', `${p.name} stays in jail (attempt ${p.jailTurns} of ${s.config.maxJailTurns}).`, p.id, now);
            break;
          }
        }
        moveForward(s, p, total);
        resolveLanding(s, p, { diceTotal: total });
        break;
      }

      if (doubles) {
        s.turn.doublesCount++;
        if (s.turn.doublesCount >= 3) {
          sendToJail(s, p, 'three doubles in a row');
          break;
        }
        s.turn.canRollAgain = true;
      } else {
        s.turn.canRollAgain = false;
      }
      moveForward(s, p, total);
      resolveLanding(s, p, { diceTotal: total });
      if (p.inJail) s.turn.canRollAgain = false;
      break;
    }

    case 'buy': {
      requireCurrent(s, actor);
      requirePhase(s, 'buyDecision');
      const idx = s.pendingPurchase!;
      const price = BOARD[idx].price!;
      const p = getPlayer(s, actor);
      if (s.props[idx].owner) fail('That property is already owned.');
      if (p.cash < price) fail(`You need ${money(s, price)} — mortgage or sell to raise funds, or send it to auction.`);
      transfer(s, p.id, 'bank', price, `Bought ${spaceName(s, idx)}`, now);
      s.props[idx].owner = p.id;
      s.pendingPurchase = null;
      log(s, 'buy', `${p.name} buys ${spaceName(s, idx)} for ${money(s, price)}.`, p.id, now);
      break;
    }

    case 'decline': {
      requireCurrent(s, actor);
      requirePhase(s, 'buyDecision');
      const idx = s.pendingPurchase!;
      s.pendingPurchase = null;
      log(s, 'auction', `${getPlayer(s, actor).name} declines to buy ${spaceName(s, idx)}.`, actor, now);
      startAuction(s, idx, now, 'declined');
      break;
    }

    case 'skipPurchase': {
      // Pass without an auction: the property stays with the bank. Only allowed when the player can't afford it.
      requireCurrent(s, actor);
      requirePhase(s, 'buyDecision');
      const idx = s.pendingPurchase!;
      if (getPlayer(s, actor).cash >= BOARD[idx].price!) fail('You can afford this property — buy it or send it to auction.');
      s.pendingPurchase = null;
      log(s, 'system', `${getPlayer(s, actor).name} passes on ${spaceName(s, idx)}. It stays with the bank.`, actor, now);
      break;
    }

    case 'bid': {
      requirePhase(s, 'auction');
      const a = s.auction!;
      const p = getPlayer(s, actor);
      if (!a.active.includes(actor)) fail('You have already left this auction.');
      if (!Number.isInteger(action.amount) || action.amount <= a.highBid) fail(`Bid more than ${money(s, a.highBid)}.`);
      if (action.amount > p.cash) fail(`You only have ${money(s, p.cash)}.`);
      a.highBid = action.amount;
      a.highBidder = actor;
      if (s.config.auctionSeconds > 0) a.endsAt = now + s.config.auctionSeconds * 1000;
      log(s, 'auction', `${p.name} bids ${money(s, action.amount)}.`, actor, now);
      if (a.active.length === 1) finishAuction(s);
      break;
    }

    case 'passAuction': {
      requirePhase(s, 'auction');
      const a = s.auction!;
      if (!a.active.includes(actor)) fail('You have already left this auction.');
      if (a.highBidder === actor) fail('You are the highest bidder — you cannot withdraw.');
      a.active = a.active.filter((x) => x !== actor);
      log(s, 'auction', `${getPlayer(s, actor).name} passes.`, actor, now);
      if (a.active.length === 0 || (a.active.length === 1 && a.active[0] === a.highBidder)) finishAuction(s);
      break;
    }

    case 'auctionTimeout': {
      requirePhase(s, 'auction');
      const a = s.auction!;
      if (a.endsAt === null || now < a.endsAt) fail('The auction timer has not expired.');
      log(s, 'auction', 'Going once, going twice… the auction timer has run out.', undefined, now);
      finishAuction(s);
      break;
    }

    case 'payJailFine': {
      requireCurrent(s, actor);
      requirePhase(s, 'preRoll');
      const p = getPlayer(s, actor);
      if (!p.inJail) fail('You are not in jail.');
      if (p.cash < s.config.jailFine) fail(`You need ${money(s, s.config.jailFine)} to pay the fine.`);
      transfer(s, p.id, 'bank', s.config.jailFine, 'Jail fine', now);
      p.inJail = false;
      p.jailTurns = 0;
      log(s, 'jail', `${p.name} pays ${money(s, s.config.jailFine)} and leaves jail.`, p.id, now);
      break;
    }

    case 'useJailCard': {
      requireCurrent(s, actor);
      requirePhase(s, 'preRoll');
      const p = getPlayer(s, actor);
      if (!p.inJail) fail('You are not in jail.');
      const deck = p.jailCards.shift();
      if (!deck) fail('You have no Get Out of Jail Free card.');
      s.decks[deck].push(jailFreeCardId(deck));
      p.inJail = false;
      p.jailTurns = 0;
      log(s, 'jail', `${p.name} uses a Get Out of Jail Free card.`, p.id, now);
      break;
    }

    case 'endTurn': {
      requireCurrent(s, actor);
      requirePhase(s, 'postRoll');
      advanceTurn(s, now);
      break;
    }

    case 'build': {
      assertOk(checkBuild(s, actor, action.space));
      const def = BOARD[action.space];
      const ps = s.props[action.space];
      transfer(s, actor, 'bank', def.houseCost!, `${ps.houses === 4 ? 'Hotel' : 'House'} on ${spaceName(s, action.space)}`, now);
      if (ps.houses === 4) {
        s.bankHotels--;
        s.bankHouses += 4;
      } else s.bankHouses--;
      ps.houses++;
      log(s, 'build', `${getPlayer(s, actor).name} builds a ${ps.houses === 5 ? 'hotel' : 'house'} on ${spaceName(s, action.space)}.`, actor, now);
      break;
    }

    case 'sellBuilding': {
      assertOk(checkSellBuilding(s, actor, action.space));
      const def = BOARD[action.space];
      const ps = s.props[action.space];
      const wasHotel = ps.houses === 5;
      if (wasHotel) {
        s.bankHotels++;
        s.bankHouses -= 4;
      } else s.bankHouses++;
      ps.houses--;
      transfer(s, 'bank', actor, def.houseCost! / 2, `Sold ${wasHotel ? 'hotel' : 'house'} on ${spaceName(s, action.space)}`, now);
      log(s, 'build', `${getPlayer(s, actor).name} sells a ${wasHotel ? 'hotel' : 'house'} on ${spaceName(s, action.space)} for ${money(s, def.houseCost! / 2)}.`, actor, now);
      break;
    }

    case 'sellAllBuildings': {
      const members = GROUP_MEMBERS[action.group];
      if (!members) fail('Unknown colour group.');
      if (!members.every((i) => s.props[i].owner === actor)) fail('You do not own this colour group.');
      let refund = 0;
      for (const i of members) {
        const ps = s.props[i];
        if (ps.houses === 5) s.bankHotels++;
        else s.bankHouses += ps.houses;
        refund += (ps.houses * BOARD[i].houseCost!) / 2;
        ps.houses = 0;
      }
      if (refund === 0) fail('There are no buildings in this group.');
      transfer(s, 'bank', actor, refund, `Sold all buildings (${action.group})`, now);
      log(s, 'build', `${getPlayer(s, actor).name} sells every building in the group for ${money(s, refund)}.`, actor, now);
      break;
    }

    case 'mortgage': {
      assertOk(checkMortgage(s, actor, action.space));
      s.props[action.space].mortgaged = true;
      const m = BOARD[action.space].mortgage!;
      transfer(s, 'bank', actor, m, `Mortgaged ${spaceName(s, action.space)}`, now);
      log(s, 'mortgage', `${getPlayer(s, actor).name} mortgages ${spaceName(s, action.space)} for ${money(s, m)}.`, actor, now);
      break;
    }

    case 'unmortgage': {
      assertOk(checkUnmortgage(s, actor, action.space));
      const cost = unmortgageCost(action.space);
      transfer(s, actor, 'bank', cost, `Unmortgaged ${spaceName(s, action.space)}`, now);
      s.props[action.space].mortgaged = false;
      log(s, 'mortgage', `${getPlayer(s, actor).name} lifts the mortgage on ${spaceName(s, action.space)} for ${money(s, cost)}.`, actor, now);
      break;
    }

    case 'proposeTrade': {
      const offer = normalizeSide(action.offer);
      const request = normalizeSide(action.request);
      if (action.counterOf === undefined && actor !== s.currentPlayer)
        fail(`Only the player at the ${spaceName(s, AUCTION_HOUSE_INDEX)} can start a trade. You can answer their offer with a counteroffer.`);
      assertOk(checkTrade(s, actor, action.to, offer, request));
      if (action.counterOf !== undefined) {
        const orig = s.trades.find((t) => t.id === action.counterOf);
        if (!orig || orig.status !== 'pending') fail('The original offer is no longer open.');
        if (orig.to !== actor || orig.from !== action.to) fail('You can only counter offers made to you.');
        orig.status = 'countered';
      }
      const t: Trade = {
        id: nextId(s),
        from: actor,
        to: action.to,
        offer,
        request,
        status: 'pending',
        createdAt: now,
        counterOf: action.counterOf,
        message: action.message?.slice(0, 200),
      };
      s.trades.push(t);
      if (s.trades.length > 60) s.trades.splice(0, s.trades.length - 60);
      log(s, 'trade', `${getPlayer(s, actor).name} ${action.counterOf !== undefined ? 'counters with' : 'proposes'} a trade to ${getPlayer(s, action.to).name}.`, actor, now);
      break;
    }

    case 'acceptTrade': {
      const t = s.trades.find((x) => x.id === action.tradeId);
      if (!t || t.status !== 'pending') fail('That offer is no longer open.');
      if (t.to !== actor) fail('Only the recipient can accept this offer.');
      const reason = checkTrade(s, t.from, t.to, t.offer, t.request);
      if (reason) fail(`This trade is no longer valid: ${reason}`);
      executeTrade(s, t, now);
      break;
    }

    case 'rejectTrade': {
      const t = s.trades.find((x) => x.id === action.tradeId);
      if (!t || t.status !== 'pending') fail('That offer is no longer open.');
      if (t.to !== actor) fail('Only the recipient can reject this offer.');
      t.status = 'rejected';
      log(s, 'trade', `${getPlayer(s, actor).name} rejects ${getPlayer(s, t.from).name}'s trade offer.`, actor, now);
      break;
    }

    case 'cancelTrade': {
      const t = s.trades.find((x) => x.id === action.tradeId);
      if (!t || t.status !== 'pending') fail('That offer is no longer open.');
      if (t.from !== actor) fail('Only the proposer can withdraw this offer.');
      t.status = 'cancelled';
      log(s, 'trade', `${getPlayer(s, actor).name} withdraws a trade offer.`, actor, now);
      break;
    }

    case 'declareBankruptcy': {
      const owes = s.debts.some((d) => d.debtor === actor);
      if (!owes) fail('You can only declare bankruptcy when you owe money you cannot pay.');
      declareBankruptcy(s, actor, now);
      break;
    }

    case 'pause': {
      if (s.paused) fail('Already paused.');
      s.paused = { at: now };
      log(s, 'system', 'The host paused the game.', undefined, now);
      break;
    }

    case 'resume': {
      if (!s.paused) fail('The game is not paused.');
      const delta = now - s.paused.at;
      if (s.endsAt !== null) s.endsAt += delta;
      if (s.auction?.endsAt != null) s.auction.endsAt += delta;
      s.paused = null;
      log(s, 'system', 'The game resumed.', undefined, now);
      break;
    }

    case 'timeUp': {
      if (s.config.mode !== 'timed' || s.endsAt === null || now < s.endsAt) fail('Time is not up yet.');
      break; // settle() finishes the game
    }

    case 'endGame': {
      if (action.actor !== 'system') fail('Only the host can end the game.');
      finishGame(s, 'ended by the host — highest net worth', now);
      break;
    }

    default:
      fail('Unknown action.');
  }

  settle(s, now);
  s.version = prev.version + 1;
  return s;
}

function normalizeSide(x: TradeSide): TradeSide {
  return {
    cash: Math.floor(Number(x?.cash) || 0),
    properties: Array.isArray(x?.properties) ? x.properties.map(Number) : [],
    jailCards: Math.floor(Number(x?.jailCards) || 0),
  };
}

function executeTrade(s: GameState, t: Trade, now: number) {
  const a = getPlayer(s, t.from);
  const b = getPlayer(s, t.to);
  if (t.offer.cash) transfer(s, a.id, b.id, t.offer.cash, 'Trade', now);
  if (t.request.cash) transfer(s, b.id, a.id, t.request.cash, 'Trade', now);
  for (const i of t.offer.properties) s.props[i].owner = b.id;
  for (const i of t.request.properties) s.props[i].owner = a.id;
  for (let k = 0; k < t.offer.jailCards; k++) b.jailCards.push(a.jailCards.shift()!);
  for (let k = 0; k < t.request.jailCards; k++) a.jailCards.push(b.jailCards.shift()!);
  const aInterest = interestFor(t.request.properties, s);
  const bInterest = interestFor(t.offer.properties, s);
  if (aInterest) transfer(s, a.id, 'bank', aInterest, 'Mortgage interest (10%) on traded property', now);
  if (bInterest) transfer(s, b.id, 'bank', bInterest, 'Mortgage interest (10%) on traded property', now);
  t.status = 'accepted';
  log(s, 'trade', `${b.name} accepts ${a.name}'s trade. ${describeTrade(s, t)}`, b.id, now);
  // Any other pending offers that became invalid are flagged.
  for (const o of s.trades) {
    if (o.status === 'pending' && checkTrade(s, o.from, o.to, o.offer, o.request)) o.status = 'invalid';
  }
}

export function describeTrade(s: GameState, t: Trade): string {
  const side = (x: TradeSide) => {
    const parts: string[] = [];
    if (x.cash) parts.push(money(s, x.cash));
    for (const i of x.properties) parts.push(spaceName(s, i));
    if (x.jailCards) parts.push(`${x.jailCards} jail card${x.jailCards > 1 ? 's' : ''}`);
    return parts.length ? parts.join(', ') : 'nothing';
  };
  return `${getPlayer(s, t.from).name} gives ${side(t.offer)}; ${getPlayer(s, t.to).name} gives ${side(t.request)}.`;
}

export function rentTable(index: number): { label: string; amount: number }[] {
  const def = BOARD[index];
  if (def.kind === 'property') {
    const r = def.rent!;
    return [
      { label: 'Rent', amount: r[0] },
      { label: 'With colour set', amount: r[0] * 2 },
      { label: 'With 1 house', amount: r[1] },
      { label: 'With 2 houses', amount: r[2] },
      { label: 'With 3 houses', amount: r[3] },
      { label: 'With 4 houses', amount: r[4] },
      { label: 'With hotel', amount: r[5] },
    ];
  }
  if (def.kind === 'railroad')
    return [1, 2, 3, 4].map((n) => ({ label: `${n} airport${n > 1 ? 's' : ''} owned`, amount: 25 * 2 ** (n - 1) }));
  return [];
}

export { ownershipGroupOf, membersOf, AUCTION_HOUSE_INDEX, RANDOM_INDEX };
