import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BOARD, GROUP_COLORS, GROUP_LABELS, membersOf, ownershipGroupOf } from '../../engine/board';
import { calculateRent, ownsWholeGroup, rentTable, spaceName } from '../../engine/engine';
import type { GameState, OwnershipGroup, PlayerState } from '../../engine/types';
import { spaceDescription } from './Property';

/**
 * Board layout. START sits in the bottom-left corner and play runs clockwise: up the left side,
 * left → right along the top, down the right side and right → left along the bottom.
 *
 *   10 ─ 11 … 19 ─ 20
 *    9            21
 *    …             …
 *    1            29
 *    0 ─ 39 … 31 ─ 30
 */

type Side = 'bottom' | 'right' | 'top' | 'left' | 'corner';
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  side: Side;
}

/** Corner size as a fraction of the board. */
const CF = 0.14;

export function spaceRect(i: number, S: number): Rect {
  const C = S * CF;
  const E = (S - 2 * C) / 9;
  if (i === 0) return { x: 0, y: S - C, w: C, h: C, side: 'corner' };
  if (i < 10) return { x: 0, y: S - C - i * E, w: C, h: E, side: 'left' };
  if (i === 10) return { x: 0, y: 0, w: C, h: C, side: 'corner' };
  if (i < 20) return { x: C + (i - 11) * E, y: 0, w: E, h: C, side: 'top' };
  if (i === 20) return { x: S - C, y: 0, w: C, h: C, side: 'corner' };
  if (i < 30) return { x: S - C, y: C + (i - 21) * E, w: C, h: E, side: 'right' };
  if (i === 30) return { x: S - C, y: S - C, w: C, h: C, side: 'corner' };
  return { x: S - C - (i - 30) * E, y: S - C, w: E, h: C, side: 'bottom' };
}

/** Direction a tile pops toward (the board centre) when hovered. */
const LIFT: Record<Side, [number, number]> = { bottom: [0, -5], top: [0, 5], left: [5, 0], right: [-5, 0], corner: [0, 0] };

const KIND_STYLE: Record<string, { bg: string; label: string }> = {
  railroad: { bg: '#1c1917', label: 'Airport' },
  utility: { bg: '#334155', label: 'Utility' },
  chance: { bg: '#0c4a6e', label: 'Fortune' },
  chest: { bg: '#78350f', label: 'Community Fund' },
  tax: { bg: '#7f1d1d', label: 'Tax' },
  go: { bg: '#b91c1c', label: 'Corner' },
  jail: { bg: '#c2410c', label: 'Corner' },
  auctionHouse: { bg: '#b45309', label: 'Trading floor' },
  random: { bg: '#6d28d9', label: 'Corner' },
};

const ICONS: Record<string, string> = { railroad: '✈️', chance: '🔮', chest: '💰', auctionHouse: '🏛️', random: '🎰', jail: '🔒', go: '🏁' };

function spaceIcon(i: number): string | null {
  const d = BOARD[i];
  if (d.kind === 'utility') return i === 12 ? '⚡' : '💧';
  if (d.kind === 'tax') return i === 4 ? '💸' : '💎';
  if (d.kind === 'property') return null;
  return ICONS[d.kind] ?? null;
}

const compact = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n));

/** Font size that keeps the longest word of `text` within `width`. */
function fitFont(text: string, width: number, max: number, min = 6.5) {
  const longest = Math.max(1, ...text.split(/\s+/).map((w) => w.length));
  return Math.max(min, Math.min(max, width / (longest * 0.7)));
}

/** Which row of the rent table currently applies (-1 = none). */
function activeRentRow(game: GameState, i: number): number {
  const d = BOARD[i];
  const ps = game.props[i];
  if (!ps?.owner || ps.mortgaged) return -1;
  if (d.kind === 'property') return ps.houses > 0 ? ps.houses + 1 : ownsWholeGroup(game, ps.owner, d.group!) ? 1 : 0;
  if (d.kind === 'railroad') return membersOf('railroad').filter((j) => game.props[j].owner === ps.owner).length - 1;
  return -1;
}

function utilityMultiplier(game: GameState, i: number): number {
  const owner = game.props[i]?.owner;
  return owner && membersOf('utility').every((j) => game.props[j].owner === owner) ? 10 : 4;
}

// ───────────────────────── Tiles ─────────────────────────

function Houses({ n, size, vertical }: { n: number; size: number; vertical: boolean }) {
  if (!n) return null;
  if (n === 5)
    return (
      <div className="building hotel" style={{ width: vertical ? size * 1.9 : size, height: vertical ? size : size * 1.9 }} title="Hotel" />
    );
  return (
    <div className={`flex items-center justify-center gap-[2px] ${vertical ? 'flex-row' : 'flex-col'}`}>
      {Array.from({ length: n }).map((_, k) => (
        <div key={k} className="building house" style={{ width: size, height: size }} title="House" />
      ))}
    </div>
  );
}

function TileFace({ game, i, r }: { game: GameState; i: number; r: Rect }) {
  const d = BOARD[i];
  const ps = game.props[i];
  const owner = ps?.owner ? game.players.find((p) => p.id === ps.owner) ?? null : null;
  const name = spaceName(game, i);
  const cur = game.config.currency;
  const vertical = r.side === 'bottom' || r.side === 'top';
  const along = vertical ? r.w : r.h;
  const depth = vertical ? r.h : r.w;
  const band = d.group ? depth * 0.21 : 0;
  const icon = spaceIcon(i);
  const textW = vertical ? r.w - 5 : r.w - band - (icon ? along * 0.42 : 0) - 8;
  const fs = fitFont(name, textW, along * 0.22);
  const chipFs = Math.max(7, along * 0.2);

  let chip: ReactNode = null;
  if (ps?.mortgaged) {
    chip = (
      <span className="tile-chip bg-rose-700 text-white" style={{ fontSize: Math.min(chipFs * 0.8, (textW - 4) / (9 * 0.72)) }}>
        MORTGAGED
      </span>
    );
  } else if (owner) {
    const rent = d.kind === 'utility' ? `×${utilityMultiplier(game, i)}` : `${cur}${compact(calculateRent(game, i, 7))}`;
    chip = (
      <span className="tile-chip text-white" style={{ fontSize: chipFs, background: owner.color }} title={`Owned by ${owner.name} · rent ${rent}`}>
        <span style={{ fontSize: chipFs * 1.05 }}>{owner.token}</span>
        {rent}
      </span>
    );
  } else if (d.price) {
    chip = (
      <span className="tile-chip bg-stone-900/85 text-amber-100" style={{ fontSize: chipFs }}>
        {cur}
        {d.price}
      </span>
    );
  } else if (d.tax) {
    chip = (
      <span className="tile-chip bg-rose-900/85 text-white" style={{ fontSize: chipFs * 0.92 }}>
        {cur}
        {d.tax}
      </span>
    );
  }

  const bandEl = d.group ? (
    <div
      className="tile-band flex shrink-0 items-center justify-center"
      style={{
        background: `linear-gradient(${vertical ? '180deg' : '90deg'}, ${GROUP_COLORS[d.group]}, ${GROUP_COLORS[d.group]}cc)`,
        [vertical ? 'height' : 'width']: band,
      }}
    >
      <Houses n={ps.houses} size={band * 0.5} vertical={vertical} />
    </div>
  ) : null;

  const nameEl = (
    <div className="tile-name" style={{ fontSize: fs }}>
      {name}
    </div>
  );

  const stripes = ps?.mortgaged ? <div className="tile-mortgaged" /> : null;

  if (vertical) {
    return (
      <div className={`relative flex h-full w-full ${r.side === 'top' ? 'flex-col-reverse' : 'flex-col'}`}>
        {stripes}
        {bandEl}
        <div className={`flex min-h-0 flex-1 items-center justify-between px-[2px] py-[3px] ${r.side === 'top' ? 'flex-col-reverse' : 'flex-col'}`}>
          {nameEl}
          {icon && <div style={{ fontSize: along * 0.44, lineHeight: 1 }}>{icon}</div>}
          {chip ?? <div />}
        </div>
      </div>
    );
  }
  return (
    <div className={`relative flex h-full w-full ${r.side === 'left' ? 'flex-row-reverse' : 'flex-row'}`}>
      {stripes}
      {bandEl}
      <div className={`flex min-w-0 flex-1 items-center gap-[3px] px-[3px] ${r.side === 'left' ? 'flex-row-reverse' : 'flex-row'}`}>
        {icon && <div style={{ fontSize: along * 0.4, lineHeight: 1 }}>{icon}</div>}
        <div className={`flex min-w-0 flex-1 flex-col justify-center gap-[2px] ${r.side === 'left' ? 'items-end text-right' : 'items-start text-left'}`}>
          {nameEl}
          {chip}
        </div>
      </div>
    </div>
  );
}

function Corner({ game, i, size }: { game: GameState; i: number; size: number }) {
  const fs = size * 0.11;
  const name = spaceName(game, i);
  const cur = game.config.currency;
  if (i === 0)
    return (
      <div className="corner-go relative h-full w-full text-white">
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ transform: 'rotate(-45deg)' }}>
          <div className="font-semibold uppercase tracking-wide opacity-90" style={{ fontSize: fs * 0.72 }}>
            Collect {cur}
            {game.config.goSalary}
          </div>
          <div className="font-display font-black leading-none drop-shadow-[0_2px_2px_rgba(0,0,0,.4)]" style={{ fontSize: fs * 1.9 }}>
            {name}
          </div>
        </div>
        <div className="absolute" style={{ left: size * 0.05, top: size * 0.02, transform: 'rotate(-90deg)' }}>
          <div className="go-arrow font-black text-amber-200" style={{ fontSize: fs * 2 }}>
            ➜
          </div>
        </div>
      </div>
    );
  if (i === 10)
    return (
      <div className="relative h-full w-full bg-[#fbf7ea] text-stone-900">
        <div className="corner-jail absolute bottom-0 right-0 flex flex-col items-center justify-center" style={{ width: size * 0.68, height: size * 0.68 }}>
          <div style={{ fontSize: fs * 1.9 }}>🔒</div>
          <div className="font-display font-black uppercase text-white" style={{ fontSize: fs }}>
            {name}
          </div>
          <div className="absolute inset-0" style={{ background: 'repeating-linear-gradient(90deg, transparent 0 17%, rgba(0,0,0,.55) 17% 21%)' }} />
        </div>
        <div className="absolute bottom-0 left-[3px] flex h-[68%] items-center font-bold uppercase text-stone-700" style={{ fontSize: fs * 0.78, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
          Just
        </div>
        <div className="absolute right-0 top-[3px] w-[68%] text-center font-bold uppercase text-stone-700" style={{ fontSize: fs * 0.78 }}>
          visiting
        </div>
      </div>
    );
  if (i === 20)
    return (
      <div className="corner-auction flex h-full w-full flex-col items-center justify-center text-center text-white">
        <div className="flex flex-col items-center" style={{ transform: 'rotate(45deg)' }}>
          <div className="corner-icon" style={{ fontSize: fs * 2.3, lineHeight: 1 }}>
            🏛️
          </div>
          <div className="font-display font-black uppercase leading-tight" style={{ fontSize: fs * 0.9 }}>
            {name}
          </div>
          <div className="font-semibold uppercase tracking-wide opacity-85" style={{ fontSize: fs * 0.6 }}>
            Trade here
          </div>
        </div>
      </div>
    );
  return (
    <div className="corner-random flex h-full w-full flex-col items-center justify-center text-center text-white">
      <div className="flex flex-col items-center" style={{ transform: 'rotate(-45deg)' }}>
        <div className="corner-icon" style={{ fontSize: fs * 2.3, lineHeight: 1 }}>
          🎰
        </div>
        <div className="font-display font-black uppercase leading-tight" style={{ fontSize: fs * 0.95 }}>
          {name}
        </div>
        <div className="font-semibold uppercase tracking-wide opacity-85" style={{ fontSize: fs * 0.55 }}>
          🔮 or 💰
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Hover card ─────────────────────────

function SpaceTip({ game, i, S, display }: { game: GameState; i: number; S: number; display: Record<string, number> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 250, h: 220 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (el.offsetWidth !== size.w || el.offsetHeight !== size.h)) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  });

  const d = BOARD[i];
  const ps = game.props[i];
  const cur = game.config.currency;
  const m = (n: number) => `${cur}${n.toLocaleString('en-US')}`;
  const name = spaceName(game, i);
  const owner = ps?.owner ? game.players.find((p) => p.id === ps.owner) ?? null : null;
  const group = ownershipGroupOf(i);
  const headBg = d.group ? GROUP_COLORS[d.group] : KIND_STYLE[d.kind]?.bg ?? '#334155';
  const darkHead = d.group === 'yellow' || d.group === 'lightblue';
  const kindLabel = d.group ? GROUP_LABELS[d.group] : KIND_STYLE[d.kind]?.label ?? '';
  const here = game.players.filter((p) => !p.bankrupt && (display[p.id] ?? p.position) === i);
  const active = activeRentRow(game, i);
  const SHORT = ['Base rent', 'Full set', '1 house', '2 houses', '3 houses', '4 houses', 'Hotel'];

  // Place the card on the board-centre side of the tile, clamped inside the inner area.
  const r = spaceRect(i, S);
  const C = S * CF;
  const gap = 10;
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? Math.max(4, Math.min(v, S - 4)) : Math.max(lo, Math.min(v, hi)));
  let x: number;
  let y: number;
  if (r.side === 'bottom' || r.side === 'top') {
    x = r.x + r.w / 2 - size.w / 2;
    y = r.side === 'bottom' ? r.y - gap - size.h : r.y + r.h + gap;
  } else if (r.side === 'left' || r.side === 'right') {
    x = r.side === 'left' ? r.x + r.w + gap : r.x - gap - size.w;
    y = r.y + r.h / 2 - size.h / 2;
  } else {
    x = r.x === 0 ? C + gap : S - C - gap - size.w;
    y = r.y === 0 ? C + gap : S - C - gap - size.h;
  }
  x = clamp(x, C + 4, S - C - size.w - 4);
  y = clamp(y, C + 4, S - C - size.h - 4);

  return (
    <div ref={ref} className="space-tip pointer-events-none absolute z-40 w-[250px] overflow-hidden rounded-xl text-stone-900" style={{ left: x, top: y }}>
      <div className="relative px-3 py-2" style={{ background: headBg, color: darkHead ? '#1c1917' : 'white' }}>
        <div className="text-[9px] font-bold uppercase tracking-[0.18em] opacity-80">{kindLabel}</div>
        <div className="font-display text-[17px] font-black leading-tight">{name}</div>
        {spaceIcon(i) && <div className="absolute right-2 top-1.5 text-2xl">{spaceIcon(i)}</div>}
      </div>

      <div className="space-y-2 bg-[#fbf8ef] px-3 py-2 text-[11.5px]">
        {ps ? (
          <>
            <div className="flex items-center justify-between gap-2">
              {owner ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]" style={{ background: owner.color }}>
                    {owner.token}
                  </span>
                  <b className="truncate">{owner.name}</b>
                </span>
              ) : (
                <span className="rounded-full bg-emerald-600 px-2 py-[1px] text-[10px] font-bold uppercase text-white">For sale</span>
              )}
              <span className="shrink-0 text-stone-600">
                Price <b className="text-stone-900">{m(d.price!)}</b>
              </span>
            </div>

            {ps.mortgaged && <div className="rounded-md bg-rose-100 px-2 py-1 font-semibold text-rose-800">🏦 Mortgaged: no rent until it's paid off</div>}

            {d.kind === 'utility' ? (
              <div className="rounded-md bg-stone-200/60 px-2 py-1.5 leading-snug">
                Rent is <b className={owner && utilityMultiplier(game, i) === 4 ? 'text-amber-700' : ''}>4×</b> the dice roll, or{' '}
                <b className={owner && utilityMultiplier(game, i) === 10 ? 'text-amber-700' : ''}>10×</b> if one player owns both utilities.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-2 gap-y-[2px]">
                {rentTable(i).map((row, k) => (
                  <div key={k} className={`flex justify-between gap-1 whitespace-nowrap rounded px-1.5 py-[1px] ${k === active ? 'bg-amber-300 font-bold' : ''}`}>
                    <span className="text-stone-600">{d.kind === 'property' ? SHORT[k] : `${k + 1} owned`}</span>
                    <span className="font-semibold">{m(row.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {d.kind === 'property' && (
              <div className="flex justify-between text-stone-600">
                <span>
                  {ps.houses === 5 ? '🏨 Hotel' : ps.houses ? `${'🏠'.repeat(ps.houses)}` : 'No buildings'}
                </span>
                <span>
                  Build <b className="text-stone-900">{m(d.houseCost!)}</b>
                </span>
              </div>
            )}

            {group && <SetProgress game={game} group={group} current={i} />}
          </>
        ) : (
          <p className="leading-snug text-stone-700">{spaceDescription(game, i)}</p>
        )}

        {here.length > 0 && (
          <div className="flex items-center gap-1 border-t border-stone-300 pt-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Here</span>
            {here.map((p) => (
              <span key={p.id} className="flex h-5 w-5 items-center justify-center rounded-full text-[11px]" style={{ background: p.color }} title={p.name}>
                {p.token}
              </span>
            ))}
          </div>
        )}
        <div className="text-center text-[9.5px] text-stone-400">Click for the full deed &amp; actions</div>
      </div>
    </div>
  );
}

function SetProgress({ game, group, current }: { game: GameState; group: OwnershipGroup; current: number }) {
  const members = membersOf(group);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Set</span>
      <div className="flex flex-1 gap-1">
        {members.map((j) => {
          const o = game.props[j].owner ? game.players.find((p) => p.id === game.props[j].owner) : null;
          return (
            <div
              key={j}
              className={`flex h-5 flex-1 items-center justify-center rounded text-[10px] ${j === current ? 'ring-2 ring-stone-900' : ''}`}
              style={{ background: o ? o.color : 'repeating-linear-gradient(45deg,#e7e5e4 0 3px,#d6d3d1 3px 6px)' }}
              title={`${spaceName(game, j)}: ${o ? o.name : 'unowned'}`}
            >
              {o?.token}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── Tokens ─────────────────────────

function tokenPoint(pos: number, S: number, slot: number, count: number, inJail: boolean, size: number) {
  const r = spaceRect(pos, S);
  const C = S * CF;
  if (pos === 10) {
    if (inJail) {
      const cx = r.x + C * 0.66;
      const cy = r.y + C * 0.64;
      const sp = C * 0.18;
      return { x: cx + ((slot % 3) - 1) * sp, y: cy + (Math.floor(slot / 3) - 0.5) * sp * 0.9 };
    }
    // Just visiting: along the top and left (outer) edges of the corner.
    const t = (Math.floor(slot / 2) + 0.5) / Math.max(1, Math.ceil(count / 2));
    return slot % 2 === 0 ? { x: r.x + C * (0.32 + t * 0.6), y: r.y + C * 0.16 } : { x: r.x + C * 0.14, y: r.y + C * (0.32 + t * 0.6) };
  }
  if (r.side === 'corner') {
    const cols = count <= 2 ? count : count <= 4 ? 2 : 3;
    const rows = Math.ceil(count / cols);
    const sp = C * 0.25;
    return { x: r.x + r.w / 2 + ((slot % cols) - (cols - 1) / 2) * sp, y: r.y + r.h / 2 + (Math.floor(slot / cols) - (rows - 1) / 2) * sp };
  }
  // Tokens straddle the tile's inner edge so the name stays readable; extra rows stack toward the centre.
  const cols = Math.min(count, 3);
  const row = Math.floor(slot / cols);
  const rowCount = Math.min(cols, count - row * cols);
  const col = slot % cols;
  const along = Math.min(r.w, r.h);
  const spA = Math.min(along * 0.42, size * 0.9);
  const offA = (col - (rowCount - 1) / 2) * spA;
  const inset = -size * 0.12 - row * size * 0.72;
  switch (r.side) {
    case 'bottom':
      return { x: r.x + r.w / 2 + offA, y: r.y + inset };
    case 'top':
      return { x: r.x + r.w / 2 + offA, y: r.y + r.h - inset };
    case 'right':
      return { x: r.x + inset, y: r.y + r.h / 2 + offA };
    default:
      return { x: r.x + r.w - inset, y: r.y + r.h / 2 + offA };
  }
}

function Token({ p, current, focused, size }: { p: PlayerState; current: boolean; focused: boolean; size: number }) {
  return (
    <div className={current ? 'token-bob' : undefined} style={{ width: size, height: size }}>
      <div
        className="token flex h-full w-full items-center justify-center rounded-full"
        style={{
          background: `radial-gradient(circle at 30% 28%, #ffffffaa, ${p.color} 38%, ${p.color}cc 70%, #00000055)`,
          border: current ? '2.5px solid #fde68a' : '2px solid white',
          boxShadow: current ? '0 0 0 3px rgba(245,158,11,.65), 0 6px 12px rgba(0,0,0,.5)' : '0 3px 7px rgba(0,0,0,.45)',
          fontSize: size * 0.56,
          transform: focused ? 'scale(1.3)' : undefined,
        }}
      >
        <span style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.45))' }}>{p.token}</span>
      </div>
    </div>
  );
}

// ───────────────────────── Board ─────────────────────────

export default function Board({
  game,
  display,
  onSpace,
  highlight,
  focusPlayer,
  children,
}: {
  game: GameState;
  /** Animated (displayed) position per player id. */
  display: Record<string, number>;
  onSpace: (i: number) => void;
  highlight: number | null;
  /** A player hovered in the side list: their properties light up. */
  focusPlayer?: string | null;
  children?: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [S, setS] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setS(Math.floor(Math.max(360, Math.min(r.width, r.height)) - 16));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const C = S * CF;
  const E = (S - 2 * C) / 9;
  const alive = game.players.filter((p) => !p.bankrupt);
  const current = game.players.find((p) => p.id === game.currentPlayer);
  const currentPos = current ? display[current.id] ?? current.position : null;

  const hoverGroup = hover !== null ? ownershipGroupOf(hover) : null;
  const tileState = (i: number): { dim: boolean; lit: boolean } => {
    if (hoverGroup) {
      const inGroup = ownershipGroupOf(i) === hoverGroup;
      return { dim: !inGroup, lit: inGroup && i !== hover };
    }
    if (focusPlayer && hover === null) {
      const mine = game.props[i]?.owner === focusPlayer;
      return { dim: !mine, lit: mine };
    }
    return { dim: false, lit: false };
  };

  // Group players by displayed position for token slotting.
  const keyOf = (p: PlayerState) => {
    const pos = display[p.id] ?? p.position;
    return pos === 10 ? `10-${p.inJail && pos === p.position ? 'j' : 'v'}` : String(pos);
  };
  const bySpace = new Map<string, string[]>();
  for (const p of alive) bySpace.set(keyOf(p), [...(bySpace.get(keyOf(p)) ?? []), p.id]);
  const tokenSize = Math.max(18, E * 0.52);

  return (
    <div ref={wrap} className="flex h-full w-full items-center justify-center">
      <div className="wood-frame relative rounded-[18px] p-[8px]" style={{ width: S + 16, height: S + 16 }}>
        <div className="board-surface relative overflow-hidden rounded-md" style={{ width: S, height: S, border: '2px solid #2b2218' }} onMouseLeave={() => setHover(null)}>
          {/* Centre */}
          <div className="board-centre absolute flex items-center justify-center" style={{ left: C, top: C, width: S - 2 * C, height: S - 2 * C }}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${S - 2 * C} ${S - 2 * C}`}>
              <TravelPath w={S - 2 * C} />
            </svg>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="board-logo select-none font-display font-black uppercase" style={{ fontSize: S * 0.08, transform: 'rotate(-38deg)', letterSpacing: '0.05em' }}>
                Estate Empire
              </div>
            </div>
            <Deck label="Fortune" icon="🔮" tone="fortune" style={{ width: S * 0.16, height: S * 0.105, left: S * 0.05, top: S * 0.06 }} fs={S * 0.021} />
            <Deck label="Community Fund" icon="💰" tone="fund" style={{ width: S * 0.16, height: S * 0.105, right: S * 0.05, bottom: S * 0.06 }} fs={S * 0.021} />
            <div className="relative z-10 w-full max-w-[92%]">{children}</div>
          </div>

          {/* Spaces */}
          {BOARD.map((d) => {
            const r = spaceRect(d.index, S);
            const { dim, lit } = tileState(d.index);
            const here = currentPos === d.index;
            const cls = ['tile', dim && 'tile-dim', lit && 'tile-lit', here && 'tile-here', highlight === d.index && 'tile-pending', r.side === 'corner' && 'tile-corner'].filter(Boolean).join(' ');
            return (
              <button
                key={d.index}
                onClick={() => onSpace(d.index)}
                onMouseEnter={() => setHover(d.index)}
                onMouseLeave={() => setHover((h) => (h === d.index ? null : h))}
                onFocus={(e) => e.currentTarget.matches(':focus-visible') && setHover(d.index)}
                onBlur={() => setHover((h) => (h === d.index ? null : h))}
                className={cls}
                aria-label={spaceName(game, d.index)}
                style={{ left: r.x, top: r.y, width: r.w, height: r.h, '--lx': `${LIFT[r.side][0]}px`, '--ly': `${LIFT[r.side][1]}px` } as CSSProperties}
              >
                {r.side === 'corner' ? <Corner game={game} i={d.index} size={C} /> : <TileFace game={game} i={d.index} r={r} />}
                {highlight === d.index && <span className="for-sale-tag">For sale</span>}
              </button>
            );
          })}

          {/* Tokens */}
          {alive.map((p) => {
            const pos = display[p.id] ?? p.position;
            const jailed = p.inJail && pos === p.position && pos === 10;
            const group = bySpace.get(keyOf(p)) ?? [p.id];
            const size = group.length > 4 ? tokenSize * 0.8 : tokenSize;
            const pt = tokenPoint(pos, S, group.indexOf(p.id), group.length, jailed, size);
            const isCurrent = p.id === game.currentPlayer;
            return (
              <div
                key={p.id}
                className="pointer-events-none absolute"
                style={{ left: pt.x - size / 2, top: pt.y - size / 2, width: size, height: size, transition: 'left .16s ease-out, top .16s ease-out', zIndex: isCurrent ? 32 : 22 }}
              >
                <div key={pos} className="token-hop h-full w-full">
                  <Token p={p} current={isCurrent} focused={focusPlayer === p.id} size={size} />
                </div>
              </div>
            );
          })}

          {hover !== null && <SpaceTip key={hover} game={game} i={hover} S={S} display={display} />}
        </div>
      </div>
    </div>
  );
}

/** Dashed loop with arrows showing the direction of travel (clockwise on screen). */
function TravelPath({ w }: { w: number }) {
  const m = 10;
  const a = Math.max(6, w * 0.018);
  const arrow = (x: number, y: number, deg: number) => (
    <path key={`${x}-${y}`} d={`M ${-a} ${-a * 0.8} L ${a * 0.6} 0 L ${-a} ${a * 0.8} Z`} transform={`translate(${x} ${y}) rotate(${deg})`} fill="rgba(120,53,15,.45)" />
  );
  return (
    <g>
      <rect x={m} y={m} width={w - 2 * m} height={w - 2 * m} rx={14} fill="none" stroke="rgba(120,53,15,.28)" strokeWidth={2} strokeDasharray="2 9" strokeLinecap="round" />
      {arrow(w / 2, w - m, 180)}
      {arrow(w - m, w / 2, 90)}
      {arrow(w / 2, m, 0)}
      {arrow(m, w / 2, -90)}
    </g>
  );
}

function Deck({ label, icon, tone, style, fs }: { label: string; icon: string; tone: 'fortune' | 'fund'; style: CSSProperties; fs: number }) {
  return (
    <div className={`deck deck-${tone} absolute`} style={style} title={`${label} deck: land on ${icon} to draw a card`}>
      <div className="deck-card deck-card-3" />
      <div className="deck-card deck-card-2" />
      <div className="deck-card deck-card-1 flex flex-col items-center justify-center font-display font-bold" style={{ fontSize: fs }}>
        <span style={{ fontSize: fs * 1.8, lineHeight: 1 }}>{icon}</span>
        {label}
      </div>
    </div>
  );
}
