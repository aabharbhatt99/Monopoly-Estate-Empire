export type SpaceKind =
  | 'go'
  | 'property'
  | 'railroad'
  | 'utility'
  | 'chance'
  | 'chest'
  | 'tax'
  | 'jail'
  | 'auctionHouse'
  | 'random';

export type ColorGroup =
  | 'brown'
  | 'lightblue'
  | 'purple'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'teal'
  | 'green'
  | 'darkblue';

/** A purchasable "group" also includes the airport & utility sets. */
export type OwnershipGroup = ColorGroup | 'railroad' | 'utility';

export interface SpaceDef {
  index: number;
  kind: SpaceKind;
  name: string;
  price?: number;
  group?: ColorGroup;
  /** [base, 1 house, 2 houses, 3 houses, 4 houses, hotel] */
  rent?: number[];
  houseCost?: number;
  mortgage?: number;
  tax?: number;
}

export type DeckId = 'chance' | 'chest';

export interface PlayerSetup {
  id: string;
  name: string;
  token: string;
  color: string;
}

export interface PlayerState extends PlayerSetup {
  cash: number;
  position: number;
  inJail: boolean;
  /** Number of failed doubles attempts during the current jail stay. */
  jailTurns: number;
  /** Get Out of Jail Free cards held (by originating deck). */
  jailCards: DeckId[];
  bankrupt: boolean;
  /** Order of elimination (1 = first out). */
  eliminatedOrder?: number;
}

export interface PropertyState {
  owner: string | null;
  /** 0-4 houses, 5 = hotel. */
  houses: number;
  mortgaged: boolean;
}

export type Party = string | 'bank';

export interface Debt {
  id: number;
  debtor: string;
  creditor: Party;
  amount: number;
  reason: string;
}

export interface Auction {
  space: number;
  highBid: number;
  highBidder: string | null;
  /** Players who are still in the auction (have not passed). */
  active: string[];
  /** Epoch ms when the auction closes, or null when there is no timer. */
  endsAt: number | null;
  reason: 'declined' | 'bankruptcy';
}

export interface TradeSide {
  cash: number;
  properties: number[];
  jailCards: number;
}

export type TradeStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'countered' | 'invalid';

export interface Trade {
  id: number;
  from: string;
  to: string;
  /** What `from` gives. */
  offer: TradeSide;
  /** What `from` wants from `to`. */
  request: TradeSide;
  status: TradeStatus;
  createdAt: number;
  counterOf?: number;
  message?: string;
}

export interface Transaction {
  id: number;
  ts: number;
  from: Party;
  to: Party;
  amount: number;
  reason: string;
}

export type LogKind =
  | 'info'
  | 'turn'
  | 'dice'
  | 'move'
  | 'go'
  | 'buy'
  | 'rent'
  | 'tax'
  | 'card'
  | 'jail'
  | 'auction'
  | 'build'
  | 'mortgage'
  | 'trade'
  | 'debt'
  | 'bankrupt'
  | 'win'
  | 'system';

export interface LogEntry {
  id: number;
  ts: number;
  kind: LogKind;
  text: string;
  player?: string;
}

export type GameMode = 'classic' | 'timed';

export interface GameConfig {
  startingCash: number;
  goSalary: number;
  mode: GameMode;
  /** Duration for timed mode. */
  durationMinutes: number;
  /** Seconds an auction stays open after the last bid (0 = no timer, close when everyone passes). */
  auctionSeconds: number;
  currency: string;
  /** Optional per-space name overrides, keyed by board index. */
  spaceNames: Record<number, string>;
  jailFine: number;
  maxJailTurns: number;
}

export type Phase = 'preRoll' | 'buyDecision' | 'auction' | 'debt' | 'postRoll' | 'gameOver';

export interface TurnState {
  number: number;
  hasRolled: boolean;
  canRollAgain: boolean;
  doublesCount: number;
  dice: [number, number] | null;
  rollSeq: number;
  /** True while the current player stands on the Auction House after landing there this turn: trading is open. */
  tradeOpen?: boolean;
}

export interface CardDraw {
  seq: number;
  deck: DeckId;
  cardId: number;
  text: string;
  player: string;
}

export interface MoveRecord {
  seq: number;
  player: string;
  path: number[];
  /** teleport = moved directly (e.g. sent to jail) rather than walking. */
  teleport: boolean;
}

export interface Score {
  player: string;
  cash: number;
  propertyValue: number;
  buildingValue: number;
  debts: number;
  netWorth: number;
}

export interface GameState {
  id: string;
  version: number;
  createdAt: number;
  config: GameConfig;
  players: PlayerState[];
  /** Keyed by board index; only purchasable spaces are present. */
  props: Record<number, PropertyState>;
  bankHouses: number;
  bankHotels: number;
  currentPlayer: string;
  turn: TurnState;
  phase: Phase;
  pendingPurchase: number | null;
  auction: Auction | null;
  auctionQueue: number[];
  debts: Debt[];
  trades: Trade[];
  decks: Record<DeckId, number[]>;
  lastCard: CardDraw | null;
  /** Token moves produced by the most recent action, in order (for animation). */
  moves: MoveRecord[];
  log: LogEntry[];
  transactions: Transaction[];
  rng: number;
  seq: number;
  paused: { at: number } | null;
  /** Timed mode deadline (epoch ms). */
  endsAt: number | null;
  status: 'playing' | 'finished';
  winner: string | null;
  endReason: string | null;
  finalScores: Score[] | null;
  eliminatedCount: number;
}

export type GameAction =
  | { type: 'roll' }
  | { type: 'buy' }
  | { type: 'decline' }
  | { type: 'skipPurchase' }
  | { type: 'bid'; amount: number }
  | { type: 'passAuction' }
  | { type: 'auctionTimeout' }
  | { type: 'payJailFine' }
  | { type: 'useJailCard' }
  | { type: 'endTurn' }
  | { type: 'build'; space: number }
  | { type: 'sellBuilding'; space: number }
  | { type: 'sellAllBuildings'; group: ColorGroup }
  | { type: 'mortgage'; space: number }
  | { type: 'unmortgage'; space: number }
  | { type: 'proposeTrade'; to: string; offer: TradeSide; request: TradeSide; counterOf?: number; message?: string }
  | { type: 'acceptTrade'; tradeId: number }
  | { type: 'rejectTrade'; tradeId: number }
  | { type: 'cancelTrade'; tradeId: number }
  | { type: 'declareBankruptcy' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'timeUp' }
  | { type: 'endGame' };

/** `actor` is the player id performing the action, or 'system' for host/timer actions. */
export type ActorAction = GameAction & { actor: string };

export interface ActionContext {
  now: number;
  /** Test hook: force the dice result for a roll. Never used by the server. */
  dice?: [number, number];
}
