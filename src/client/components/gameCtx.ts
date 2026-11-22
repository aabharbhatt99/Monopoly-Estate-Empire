import { createContext, useContext } from 'react';
import type { RoomView } from '../../engine/room';
import type { GameAction, GameState, Trade } from '../../engine/types';

export interface GameCtxValue {
  room: RoomView;
  game: GameState;
  isHost: boolean;
  /** Does this device control the given player? */
  controls: (playerId: string) => boolean;
  /** The player this device acts as by default (current player if controlled, else first controlled seat). */
  me: string | null;
  act: (actor: string, action: GameAction) => Promise<boolean>;
  money: (n: number) => string;
  openProperty: (index: number) => void;
  openPlayer: (playerId: string) => void;
  openTrade: (opts: { from?: string; to?: string; counter?: Trade }) => void;
  reviewTrade: (t: Trade) => void;
  /** Light up a player's properties on the board (null clears). */
  hoverPlayer: (playerId: string | null) => void;
}

export const GameCtx = createContext<GameCtxValue>(null as any);
export const useGame = () => useContext(GameCtx);
