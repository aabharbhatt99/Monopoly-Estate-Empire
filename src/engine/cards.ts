import type { DeckId } from './types';

export type CardEffect =
  | { type: 'advance'; to: number }
  | { type: 'advanceNearest'; kind: 'railroad' | 'utility' }
  | { type: 'back'; spaces: number }
  | { type: 'collect'; amount: number }
  | { type: 'pay'; amount: number }
  | { type: 'jail' }
  | { type: 'jailFree' }
  | { type: 'repairs'; perHouse: number; perHotel: number }
  | { type: 'payEach'; amount: number }
  | { type: 'collectEach'; amount: number };

export interface Card {
  id: number;
  deck: DeckId;
  text: string;
  effect: CardEffect;
}

/** "Fortune" deck (Chance-style). Original wording. */
export const CHANCE_CARDS: Card[] = [
  { id: 0, deck: 'chance', text: 'Fast-track ticket! Advance straight to START and collect your salary.', effect: { type: 'advance', to: 0 } },
  { id: 1, deck: 'chance', text: 'Dinner reservation in Rome. Advance there — collect your salary if you pass START.', effect: { type: 'advance', to: 24 } },
  { id: 2, deck: 'chance', text: 'Flamenco night in Seville. Advance there — collect your salary if you pass START.', effect: { type: 'advance', to: 11 } },
  { id: 3, deck: 'chance', text: 'Meter reader on the way. Advance to the nearest utility. If owned, roll the dice and pay the owner ten times the roll.', effect: { type: 'advanceNearest', kind: 'utility' } },
  { id: 4, deck: 'chance', text: 'Catch a connecting flight! Advance to the nearest airport. If owned, pay the owner double the usual rent.', effect: { type: 'advanceNearest', kind: 'railroad' } },
  { id: 5, deck: 'chance', text: 'Last call for boarding. Advance to the nearest airport. If owned, pay the owner double the usual rent.', effect: { type: 'advanceNearest', kind: 'railroad' } },
  { id: 6, deck: 'chance', text: 'Your shares paid a dividend. The bank pays you $50.', effect: { type: 'collect', amount: 50 } },
  { id: 7, deck: 'chance', text: 'Friends in high places. Keep this card and use it to walk out of jail for free.', effect: { type: 'jailFree' } },
  { id: 8, deck: 'chance', text: 'Wrong turn! Go back three spaces.', effect: { type: 'back', spaces: 3 } },
  { id: 9, deck: 'chance', text: 'Caught red-handed. Go directly to jail — do not pass START, do not collect a salary.', effect: { type: 'jail' } },
  { id: 10, deck: 'chance', text: 'Time for maintenance on all your buildings: pay $25 per house and $100 per hotel.', effect: { type: 'repairs', perHouse: 25, perHotel: 100 } },
  { id: 11, deck: 'chance', text: 'Excess baggage fee! Pay $15.', effect: { type: 'pay', amount: 15 } },
  { id: 12, deck: 'chance', text: 'Desert stopover! Fly to Dubai Airport — collect your salary if you pass START.', effect: { type: 'advance', to: 5 } },
  { id: 13, deck: 'chance', text: 'Front-row seats on Broadway. Advance to New York.', effect: { type: 'advance', to: 39 } },
  { id: 14, deck: 'chance', text: 'You were voted club treasurer. Pay every other player $50.', effect: { type: 'payEach', amount: 50 } },
  { id: 15, deck: 'chance', text: 'Your construction bond has matured. Collect $150.', effect: { type: 'collect', amount: 150 } },
];

/** "Community Fund" deck (Community Chest-style). Original wording. */
export const CHEST_CARDS: Card[] = [
  { id: 0, deck: 'chest', text: 'Lucky streak! Advance to START and collect your salary.', effect: { type: 'advance', to: 0 } },
  { id: 1, deck: 'chest', text: 'The bank made an accounting mistake in your favour. Collect $200.', effect: { type: 'collect', amount: 200 } },
  { id: 2, deck: 'chest', text: 'Check-up at the clinic. Pay $50.', effect: { type: 'pay', amount: 50 } },
  { id: 3, deck: 'chest', text: 'You sold some old stock. Collect $50.', effect: { type: 'collect', amount: 50 } },
  { id: 4, deck: 'chest', text: 'A good lawyer owes you a favour. Keep this card and use it to get out of jail free.', effect: { type: 'jailFree' } },
  { id: 5, deck: 'chest', text: 'Busted by an audit. Go directly to jail — do not pass START, do not collect a salary.', effect: { type: 'jail' } },
  { id: 6, deck: 'chest', text: 'Your holiday savings plan pays out. Collect $100.', effect: { type: 'collect', amount: 100 } },
  { id: 7, deck: 'chest', text: 'Tax rebate arrives. Collect $20.', effect: { type: 'collect', amount: 20 } },
  { id: 8, deck: 'chest', text: 'It is your birthday! Collect $10 from every other player.', effect: { type: 'collectEach', amount: 10 } },
  { id: 9, deck: 'chest', text: 'Your insurance policy matures. Collect $100.', effect: { type: 'collect', amount: 100 } },
  { id: 10, deck: 'chest', text: 'Emergency room bill. Pay $100.', effect: { type: 'pay', amount: 100 } },
  { id: 11, deck: 'chest', text: 'Tuition is due. Pay $50.', effect: { type: 'pay', amount: 50 } },
  { id: 12, deck: 'chest', text: 'Freelance consulting gig. Collect $25.', effect: { type: 'collect', amount: 25 } },
  { id: 13, deck: 'chest', text: 'The council assesses street works: pay $40 per house and $115 per hotel.', effect: { type: 'repairs', perHouse: 40, perHotel: 115 } },
  { id: 14, deck: 'chest', text: 'Runner-up in an international talent show. Collect $10.', effect: { type: 'collect', amount: 10 } },
  { id: 15, deck: 'chest', text: 'A distant relative leaves you an inheritance. Collect $100.', effect: { type: 'collect', amount: 100 } },
];

export const DECKS: Record<DeckId, Card[]> = { chance: CHANCE_CARDS, chest: CHEST_CARDS };

export const DECK_NAMES: Record<DeckId, string> = { chance: 'Fortune', chest: 'Community Fund' };

export function jailFreeCardId(deck: DeckId): number {
  return DECKS[deck].find((c) => c.effect.type === 'jailFree')!.id;
}
