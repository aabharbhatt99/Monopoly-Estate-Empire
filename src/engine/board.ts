import type { ColorGroup, OwnershipGroup, SpaceDef } from './types';

const P = (
  index: number,
  name: string,
  group: ColorGroup,
  price: number,
  rent: number[],
  houseCost: number,
): SpaceDef => ({ index, kind: 'property', name, group, price, rent, houseCost, mortgage: price / 2 });

const RR = (index: number, name: string): SpaceDef => ({ index, kind: 'railroad', name, price: 200, mortgage: 100 });
const UT = (index: number, name: string): SpaceDef => ({ index, kind: 'utility', name, price: 150, mortgage: 75 });

/**
 * The 40-space international board. Every colour group is a country and every property is one of
 * its famous cities. Prices rise along the direction of travel. Names can be overridden per game
 * via config.spaceNames.
 *
 * Special spaces: one Fortune (22), one Community Fund (2), the Auction House (20, the only place
 * trading is allowed) and Random (30, draws a Fortune or Community Fund card at random).
 */
export const BOARD: SpaceDef[] = [
  { index: 0, kind: 'go', name: 'START' },
  P(1, 'Alexandria', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  { index: 2, kind: 'chest', name: 'Community Fund' },
  P(3, 'Cairo', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { index: 4, kind: 'tax', name: 'Income Tax', tax: 200 },
  RR(5, 'Dubai Airport'),
  P(6, 'São Paulo', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  P(7, 'Rio de Janeiro', 'lightblue', 120, [8, 40, 100, 300, 450, 600], 50),
  P(8, 'Melbourne', 'purple', 120, [8, 40, 100, 300, 450, 600], 50),
  P(9, 'Sydney', 'purple', 140, [10, 50, 150, 450, 625, 750], 50),
  { index: 10, kind: 'jail', name: 'Jail' },
  P(11, 'Seville', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  UT(12, 'Power Plant'),
  P(13, 'Madrid', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  P(14, 'Barcelona', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  RR(15, 'Singapore Airport'),
  P(16, 'Jaipur', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  P(17, 'Bengaluru', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  P(18, 'Mumbai', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  P(19, 'New Delhi', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { index: 20, kind: 'auctionHouse', name: 'Auction House' },
  P(21, 'Venice', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  { index: 22, kind: 'chance', name: 'Fortune' },
  P(23, 'Milan', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  P(24, 'Rome', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  RR(25, 'Frankfurt Airport'),
  P(26, 'Lyon', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  P(27, 'Nice', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  UT(28, 'Water Works'),
  P(29, 'Paris', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { index: 30, kind: 'random', name: 'Random' },
  P(31, 'Edinburgh', 'teal', 300, [26, 130, 390, 900, 1100, 1275], 200),
  P(32, 'London', 'teal', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  P(33, 'Kyoto', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  P(34, 'Tokyo', 'green', 340, [30, 160, 470, 1050, 1250, 1450], 200),
  RR(35, 'Toronto Airport'),
  P(36, 'San Francisco', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  P(37, 'Los Angeles', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { index: 38, kind: 'tax', name: 'Luxury Tax', tax: 100 },
  P(39, 'New York', 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

export const JAIL_INDEX = 10;
export const AUCTION_HOUSE_INDEX = 20;
export const RANDOM_INDEX = 30;
export const RAILROADS = [5, 15, 25, 35];
export const UTILITIES = [12, 28];
export const TOTAL_HOUSES = 32;
export const TOTAL_HOTELS = 12;

export const COLOR_GROUPS: ColorGroup[] = ['brown', 'lightblue', 'purple', 'pink', 'orange', 'red', 'yellow', 'teal', 'green', 'darkblue'];

export const GROUP_MEMBERS: Record<ColorGroup, number[]> = COLOR_GROUPS.reduce(
  (acc, g) => {
    acc[g] = BOARD.filter((s) => s.group === g).map((s) => s.index);
    return acc;
  },
  {} as Record<ColorGroup, number[]>,
);

export const GROUP_COLORS: Record<ColorGroup, string> = {
  brown: '#8B4A2B',
  lightblue: '#8FD3F4',
  purple: '#7B3FBF',
  pink: '#D63C8F',
  orange: '#F28C28',
  red: '#E02B2B',
  yellow: '#F5D90A',
  teal: '#0F8C8C',
  green: '#1F9D55',
  darkblue: '#2346A8',
};

export const GROUP_LABELS: Record<OwnershipGroup, string> = {
  brown: 'Egypt',
  lightblue: 'Brazil',
  purple: 'Australia',
  pink: 'Spain',
  orange: 'India',
  red: 'Italy',
  yellow: 'France',
  teal: 'United Kingdom',
  green: 'Japan',
  darkblue: 'United States',
  railroad: 'Airports',
  utility: 'Utilities',
};

export const PURCHASABLE = BOARD.filter((s) => s.kind === 'property' || s.kind === 'railroad' || s.kind === 'utility').map(
  (s) => s.index,
);

export function isPurchasable(index: number): boolean {
  const k = BOARD[index]?.kind;
  return k === 'property' || k === 'railroad' || k === 'utility';
}

export function ownershipGroupOf(index: number): OwnershipGroup | null {
  const s = BOARD[index];
  if (s.kind === 'property') return s.group!;
  if (s.kind === 'railroad') return 'railroad';
  if (s.kind === 'utility') return 'utility';
  return null;
}

export function membersOf(group: OwnershipGroup): number[] {
  if (group === 'railroad') return RAILROADS;
  if (group === 'utility') return UTILITIES;
  return GROUP_MEMBERS[group];
}
