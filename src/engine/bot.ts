/**
 * Computer players. `nextBotAction` is a pure function: given the game and the set of bot player ids it
 * returns the single next action a bot should take (or null when no bot has anything to do). The host's
 * browser calls it repeatedly, with a short delay between moves so humans can follow along.
 */
import { BOARD, membersOf, ownershipGroupOf } from './board';
import {
  activePlayers,
  checkBuild,
  checkMortgage,
  checkSellBuilding,
  checkTrade,
  checkUnmortgage,
  getPlayer,
  liquidationValue,
  ownedBy,
  unmortgageCost,
} from './engine';
import type { ColorGroup, GameAction, GameState, Trade } from './types';

export interface BotMove {
  actor: string;
  action: GameAction;
}

/** Cash a bot tries to keep in hand after voluntary spending. */
const RESERVE = 150;

/** Small stable per-bot "personality" so computers do not all bid identically. */
function temperament(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return 0.8 + (Math.abs(h) % 5) * 0.1; // 0.8 … 1.2
}

function ownsAllBut(s: GameState, playerId: string, index: number): boolean {
  const g = ownershipGroupOf(index);
  if (!g) return false;
  const others = membersOf(g).filter((i) => i !== index);
  return others.length > 0 && others.every((i) => s.props[i].owner === playerId);
}

/** Does acquiring `index` complete a set for `playerId`? */
function completesSet(s: GameState, playerId: string, index: number): boolean {
  return ownsAllBut(s, playerId, index);
}

/** Does any rival hold the rest of this set (so winning it blocks them)? */
function blocksRival(s: GameState, playerId: string, index: number): boolean {
  const g = ownershipGroupOf(index);
  if (!g) return false;
  const others = membersOf(g).filter((i) => i !== index);
  const owner = s.props[others[0]]?.owner;
  return !!owner && owner !== playerId && others.every((i) => s.props[i].owner === owner);
}

/** What a bot thinks a property is worth to it. */
function valueOf(s: GameState, playerId: string, index: number): number {
  const def = BOARD[index];
  const price = def.price ?? 0;
  let v = price;
  const g = ownershipGroupOf(index);
  if (g) {
    const mine = membersOf(g).filter((i) => s.props[i].owner === playerId).length;
    v += mine * price * 0.15;
  }
  if (completesSet(s, playerId, index)) v += price * 0.6;
  if (blocksRival(s, playerId, index)) v += price * 0.3;
  if (def.kind === 'utility') v *= 0.8;
  return v;
}

// ───────────────────────────── Debt ─────────────────────────────

function raiseCash(s: GameState, id: string): GameAction {
  const debt = s.debts.find((d) => d.debtor === id)!;
  const p = getPlayer(s, id);
  if (p.cash + liquidationValue(s, id) < debt.amount) return { type: 'declareBankruptcy' };
  const owned = ownedBy(s, id);

  // Sell buildings first (most developed first — evenness rules force that order anyway).
  const sellable = owned
    .filter((i) => s.props[i].houses > 0 && !checkSellBuilding(s, id, i))
    .sort((a, b) => s.props[b].houses - s.props[a].houses);
  if (sellable.length) return { type: 'sellBuilding', space: sellable[0] };
  // A hotel that cannot be broken down (housing shortage) is sold off wholesale.
  const stuck = owned.find((i) => s.props[i].houses > 0 && BOARD[i].group);
  if (stuck !== undefined) return { type: 'sellAllBuildings', group: BOARD[stuck].group as ColorGroup };

  // Then mortgage, cheapest properties first so the best sets are kept.
  const mortgageable = owned.filter((i) => !checkMortgage(s, id, i)).sort((a, b) => (BOARD[a].price ?? 0) - (BOARD[b].price ?? 0));
  if (mortgageable.length) return { type: 'mortgage', space: mortgageable[0] };
  return { type: 'declareBankruptcy' };
}

// ───────────────────────────── Auction ─────────────────────────────

function auctionMove(s: GameState, bots: ReadonlySet<string>): BotMove | null {
  const a = s.auction!;
  for (const id of a.active) {
    if (!bots.has(id) || a.highBidder === id) continue;
    const p = getPlayer(s, id);
    const price = BOARD[a.space].price ?? 0;
    const want = valueOf(s, id, a.space) * temperament(id);
    const ceiling = Math.min(Math.floor(want), p.cash - (completesSet(s, id, a.space) ? 20 : RESERVE / 2));
    const step = Math.max(10, Math.round((price * 0.1) / 10) * 10);
    const next = a.highBid === 0 ? Math.max(10, Math.round((price * 0.4) / 10) * 10) : a.highBid + step;
    if (next <= ceiling) return { actor: id, action: { type: 'bid', amount: next } };
    if (a.highBid < ceiling) return { actor: id, action: { type: 'bid', amount: a.highBid + 1 } };
    return { actor: id, action: { type: 'passAuction' } };
  }
  return null;
}

// ───────────────────────────── Trades ─────────────────────────────

function tradeWorth(s: GameState, id: string, t: Trade): number {
  const side = (props: number[], cash: number, cards: number, who: string) =>
    cash + cards * 50 + props.reduce((sum, i) => sum + (s.props[i].mortgaged ? (BOARD[i].mortgage ?? 0) : valueOf(s, who, i)), 0);
  const receives = t.to === id ? t.offer : t.request;
  const gives = t.to === id ? t.request : t.offer;
  let gain = side(receives.properties, receives.cash, receives.jailCards, id);
  let loss = side(gives.properties, gives.cash, gives.jailCards, id);
  // Giving a rival the last piece of a set is costly.
  const rival = t.to === id ? t.from : t.to;
  for (const i of gives.properties) if (completesSet(s, rival, i)) loss += (BOARD[i].price ?? 0) * 0.6;
  return gain - loss;
}

function tradeMove(s: GameState, bots: ReadonlySet<string>): BotMove | null {
  for (const t of s.trades) {
    if (t.status !== 'pending' || !bots.has(t.to)) continue;
    const bad = checkTrade(s, t.from, t.to, t.offer, t.request);
    const ok = !bad && tradeWorth(s, t.to, t) > 0 && getPlayer(s, t.to).cash - t.request.cash + t.offer.cash >= 50;
    return { actor: t.to, action: ok ? { type: 'acceptTrade', tradeId: t.id } : { type: 'rejectTrade', tradeId: t.id } };
  }
  return null;
}

// ───────────────────────────── Own turn ─────────────────────────────

function manage(s: GameState, id: string): GameAction | null {
  const p = getPlayer(s, id);
  const owned = ownedBy(s, id);

  // Lift mortgages when comfortably rich.
  const lift = owned
    .filter((i) => s.props[i].mortgaged && !checkUnmortgage(s, id, i) && p.cash - unmortgageCost(i) >= RESERVE + 150)
    .sort((a, b) => (BOARD[b].price ?? 0) - (BOARD[a].price ?? 0));
  if (lift.length) return { type: 'unmortgage', space: lift[0] };

  // Build on complete sets, favouring the highest-rent streets, while keeping a cash buffer.
  const buildable = owned
    .filter((i) => BOARD[i].kind === 'property' && !checkBuild(s, id, i) && p.cash - (BOARD[i].houseCost ?? 0) >= RESERVE)
    .sort((a, b) => (BOARD[b].rent?.[1] ?? 0) - (BOARD[a].rent?.[1] ?? 0));
  if (buildable.length) return { type: 'build', space: buildable[0] };
  return null;
}

function turnMove(s: GameState, id: string): GameAction | null {
  const p = getPlayer(s, id);
  switch (s.phase) {
    case 'preRoll': {
      if (!s.turn.hasRolled && p.inJail) {
        if (p.jailCards.length) return { type: 'useJailCard' };
        // Early on, leaving jail is worth the fine; late in the game jail is a safe place to sit.
        const unownedLeft = Object.values(s.props).filter((x) => !x.owner).length;
        if (p.cash >= s.config.jailFine + RESERVE && unownedLeft > 6) return { type: 'payJailFine' };
      }
      return { type: 'roll' };
    }
    case 'buyDecision': {
      const idx = s.pendingPurchase!;
      const price = BOARD[idx].price ?? 0;
      const goodDeal = completesSet(s, id, idx) || blocksRival(s, id, idx);
      if (p.cash >= price && (goodDeal ? p.cash - price >= 0 : p.cash - price >= RESERVE)) return { type: 'buy' };
      return { type: 'decline' };
    }
    case 'postRoll':
      return manage(s, id) ?? { type: 'endTurn' };
    default:
      return null;
  }
}

/** The single next thing any computer player wants to do, or null. */
export function nextBotAction(s: GameState, botIds: ReadonlySet<string>): BotMove | null {
  if (s.status !== 'playing' || s.paused || botIds.size === 0) return null;
  const bots = new Set([...botIds].filter((id) => s.players.some((p) => p.id === id && !p.bankrupt)));
  if (!bots.size) return null;

  if (s.debts.length) {
    const d = s.debts[0];
    return bots.has(d.debtor) ? { actor: d.debtor, action: raiseCash(s, d.debtor) } : null;
  }
  if (s.auction) return auctionMove(s, bots);

  const t = tradeMove(s, bots);
  if (t) return t;

  if (bots.has(s.currentPlayer) && activePlayers(s).some((p) => p.id === s.currentPlayer)) {
    const action = turnMove(s, s.currentPlayer);
    return action ? { actor: s.currentPlayer, action } : null;
  }
  return null;
}

/** Delay (ms) before a bot makes this move, so people can watch what is happening. */
export function botDelay(move: BotMove): number {
  const jitter = Math.random() * 400;
  switch (move.action.type) {
    case 'roll':
      return 1100 + jitter;
    case 'bid':
    case 'passAuction':
      return 900 + jitter;
    case 'endTurn':
      return 700 + jitter;
    default:
      return 800 + jitter;
  }
}
