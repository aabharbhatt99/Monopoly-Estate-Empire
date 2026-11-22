import { BOARD, GROUP_COLORS, GROUP_LABELS, membersOf, ownershipGroupOf } from '../../engine/board';
import {
  calculateRent,
  checkBuild,
  checkMortgage,
  checkSellBuilding,
  checkUnmortgage,
  ownsWholeGroup,
  rentTable,
  spaceName,
  unmortgageCost,
} from '../../engine/engine';
import type { GameState } from '../../engine/types';
import { Avatar, Modal } from './ui';
import { useGame } from './gameCtx';

/** Plain-language description of a non-purchasable space. */
export function spaceDescription(game: GameState, index: number): string {
  const m = (n: number) => `${game.config.currency}${n.toLocaleString('en-US')}`;
  const d = BOARD[index];
  const desc: Record<string, string> = {
    go: `Collect ${m(game.config.goSalary)} every time you pass or land here.`,
    chance: 'Draw a Fortune card and follow its instructions.',
    chest: 'Draw a Community Fund card and follow its instructions.',
    tax: `Pay ${m(d.tax ?? 0)} to the bank.`,
    jail: `Just visiting, unless you were sent here. Leave by paying ${m(game.config.jailFine)}, using a Get Out of Jail Free card, or rolling doubles (up to ${game.config.maxJailTurns} tries).`,
    auctionHouse: 'The trading floor. Land here to open trading for the rest of your turn: propose deals to any player, and they can accept, reject or counter. This is the only place where trades can happen.',
    random: 'A card is drawn at random from either the Fortune or the Community Fund deck.',
  };
  return desc[d.kind] ?? '';
}

/** A title-deed style card. */
export function DeedCard({ game, index, compact }: { game: GameState; index: number; compact?: boolean }) {
  const d = BOARD[index];
  const ps = game.props[index];
  const cur = game.config.currency;
  const m = (n: number) => `${cur}${n.toLocaleString()}`;
  const table = rentTable(index);
  const headerBg = d.group ? GROUP_COLORS[d.group] : d.kind === 'railroad' ? '#1c1917' : '#334155';
  const darkText = d.group === 'yellow' || d.group === 'lightblue';
  const currentLevel = ps ? (d.kind === 'property' ? (ps.houses > 0 ? ps.houses + 1 : ps.owner && ownsWholeGroup(game, ps.owner, d.group!) ? 1 : 0) : -1) : -1;
  const railCount = ps?.owner && d.kind === 'railroad' ? membersOf('railroad').filter((i) => game.props[i].owner === ps.owner).length - 1 : -1;
  return (
    <div className={`mx-auto w-full ${compact ? 'max-w-[240px]' : 'max-w-[300px]'} rounded-lg bg-[#fbf8ef] p-2 text-stone-900 shadow-lg`}>
      <div className="rounded-md border-2 border-stone-900 p-2 text-center" style={{ background: headerBg, color: darkText ? '#1c1917' : 'white' }}>
        <div className="text-[10px] font-semibold uppercase tracking-widest opacity-80">{d.kind === 'property' ? 'Title deed' : d.kind === 'railroad' ? 'Airport' : 'Utility'}</div>
        <div className="font-display text-lg font-black uppercase leading-tight">{spaceName(game, index)}</div>
      </div>
      <div className="px-2 pt-2 text-sm">
        {d.kind === 'utility' ? (
          <div className="space-y-2 py-1 text-center text-xs leading-relaxed">
            <p>If one utility is owned, rent is <b>4×</b> the dice roll.</p>
            <p>If both utilities are owned, rent is <b>10×</b> the dice roll.</p>
          </div>
        ) : (
          <table className="w-full">
            <tbody>
              {table.map((row, k) => {
                const active = d.kind === 'property' ? k === currentLevel : k === railCount;
                return (
                  <tr key={k} className={active ? 'bg-amber-200 font-bold' : ''}>
                    <td className="py-[1px] pl-1">{row.label}</td>
                    <td className="pr-1 text-right font-semibold">{m(row.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="mt-2 space-y-[2px] border-t border-stone-300 pt-2 text-xs">
          <div className="flex justify-between">
            <span>Price</span>
            <b>{m(d.price!)}</b>
          </div>
          {d.houseCost && (
            <>
              <div className="flex justify-between">
                <span>House cost</span>
                <b>{m(d.houseCost)} each</b>
              </div>
              <div className="flex justify-between">
                <span>Hotel cost</span>
                <b>{m(d.houseCost)} + 4 houses</b>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <span>Mortgage value</span>
            <b>{m(d.mortgage!)}</b>
          </div>
          <div className="flex justify-between">
            <span>Unmortgage cost</span>
            <b>{m(unmortgageCost(index))}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PropertyActions({ index, actor }: { index: number; actor: string }) {
  const { game, act, money } = useGame();
  const d = BOARD[index];
  const ps = game.props[index];
  const build = checkBuild(game, actor, index);
  const sell = checkSellBuilding(game, actor, index);
  const mort = checkMortgage(game, actor, index);
  const unm = checkUnmortgage(game, actor, index);
  return (
    <div className="flex flex-wrap gap-1.5">
      {d.kind === 'property' && (
        <>
          <button className="btn-green btn-sm" disabled={!!build} title={build ?? ''} onClick={() => act(actor, { type: 'build', space: index })}>
            🏠 {ps.houses === 4 ? 'Build hotel' : 'Build house'} ({money(d.houseCost!)})
          </button>
          <button className="btn-ghost btn-sm" disabled={!!sell} title={sell ?? ''} onClick={() => act(actor, { type: 'sellBuilding', space: index })}>
            Sell {ps.houses === 5 ? 'hotel' : 'house'} (+{money(d.houseCost! / 2)})
          </button>
        </>
      )}
      {ps.mortgaged ? (
        <button className="btn-primary btn-sm" disabled={!!unm} title={unm ?? ''} onClick={() => act(actor, { type: 'unmortgage', space: index })}>
          Unmortgage (−{money(unmortgageCost(index))})
        </button>
      ) : (
        <button className="btn-ghost btn-sm" disabled={!!mort} title={mort ?? ''} onClick={() => act(actor, { type: 'mortgage', space: index })}>
          Mortgage (+{money(d.mortgage!)})
        </button>
      )}
    </div>
  );
}

export function PropertyModal({ index, onClose }: { index: number; onClose: () => void }) {
  const { game, controls, money, openPlayer } = useGame();
  const d = BOARD[index];
  const ps = game.props[index];
  const name = spaceName(game, index);
  if (!ps) {
    return (
      <Modal title={name} onClose={onClose}>
        <p className="text-white/80">{spaceDescription(game, index)}</p>
      </Modal>
    );
  }
  const owner = ps.owner ? game.players.find((p) => p.id === ps.owner)! : null;
  const group = ownershipGroupOf(index)!;
  const lastDice = game.turn.dice ? game.turn.dice[0] + game.turn.dice[1] : 7;
  const rentNow = owner ? calculateRent(game, index, lastDice) : 0;
  return (
    <Modal title={name} onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <DeedCard game={game} index={index} />
        <div className="flex flex-col gap-3 text-sm">
          <div className="rounded-xl bg-white/5 p-3">
            <div className="label">{d.group ? 'Country' : 'Group'}</div>
            <div className="flex items-center gap-2">
              {d.group && <span className="h-3 w-3 rounded-sm" style={{ background: GROUP_COLORS[d.group] }} />}
              {GROUP_LABELS[group]}: {membersOf(group).map((i) => spaceName(game, i)).join(', ')}
            </div>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <div className="label">Owner</div>
            {owner ? (
              <button className="flex items-center gap-2 hover:underline" onClick={() => openPlayer(owner.id)}>
                <Avatar token={owner.token} color={owner.color} size={26} /> {owner.name}
              </button>
            ) : (
              <span className="text-white/60">The Bank (for sale)</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/5 p-3">
              <div className="label">Buildings</div>
              {d.kind !== 'property' ? '—' : ps.houses === 5 ? '🏨 Hotel' : ps.houses ? `🏠 × ${ps.houses}` : 'None'}
            </div>
            <div className="rounded-xl bg-white/5 p-3">
              <div className="label">Current rent</div>
              {ps.mortgaged ? <span className="text-rose-300">Mortgaged — no rent</span> : owner ? (d.kind === 'utility' ? `${money(rentNow)} (at roll of ${lastDice})` : money(rentNow)) : '—'}
            </div>
          </div>
          {owner && controls(owner.id) && !owner.bankrupt && (
            <div className="rounded-xl bg-white/5 p-3">
              <div className="label">Manage as {owner.name}</div>
              <PropertyActions index={index} actor={owner.id} />
            </div>
          )}
          <p className="text-xs text-white/40">Bank supply: {game.bankHouses} houses, {game.bankHotels} hotels.</p>
        </div>
      </div>
    </Modal>
  );
}
