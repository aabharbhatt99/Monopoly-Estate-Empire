import { useState } from 'react';
import { BOARD, COLOR_GROUPS, GROUP_COLORS, GROUP_LABELS, GROUP_MEMBERS, PURCHASABLE } from '../../engine/board';
import { buildingCounts, completedGroups, groupHasBuildings, ownedBy, scorePlayer, spaceName, tradeWindowOpen } from '../../engine/engine';
import type { ColorGroup, GameState } from '../../engine/types';
import { Avatar, Modal } from './ui';
import { useGame } from './gameCtx';
import { PropertyActions } from './Property';

function OwnedChips({ game, playerId }: { game: GameState; playerId: string }) {
  const owned = ownedBy(game, playerId);
  return (
    <div className="flex flex-wrap gap-[3px]">
      {owned.map((i) => {
        const d = BOARD[i];
        const ps = game.props[i];
        const bg = d.group ? GROUP_COLORS[d.group] : d.kind === 'railroad' ? '#e7e5e4' : '#94a3b8';
        return (
          <span
            key={i}
            className="relative h-3 w-2.5 rounded-[2px] border border-black/40"
            style={{ background: bg, opacity: ps.mortgaged ? 0.35 : 1 }}
            title={`${spaceName(game, i)}${ps.mortgaged ? ' (mortgaged)' : ''}${ps.houses ? ` · ${ps.houses === 5 ? 'hotel' : ps.houses + ' houses'}` : ''}`}
          >
            {ps.houses > 0 && <span className="absolute -top-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white" />}
          </span>
        );
      })}
    </div>
  );
}

export function PlayerList() {
  const { game, room, money, openPlayer, controls, hoverPlayer } = useGame();
  const seatConn = new Map(room.seats.map((s) => [s.id, s.connected]));
  const botIds = new Set(room.seats.filter((s) => s.bot).map((s) => s.id));
  return (
    <div className="flex flex-col gap-1.5">
      {game.players.map((p) => {
        const current = p.id === game.currentPlayer && game.status === 'playing';
        const nw = scorePlayer(game, p.id).netWorth;
        const debt = game.debts.filter((d) => d.debtor === p.id).reduce((a, d) => a + d.amount, 0);
        return (
          <button
            key={p.id}
            onClick={() => openPlayer(p.id)}
            onMouseEnter={() => hoverPlayer(p.id)}
            onMouseLeave={() => hoverPlayer(null)}
            className={`group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition ${
              current ? 'border-amber-300/70 bg-amber-300/15 shadow-[0_0_20px_rgba(251,191,36,.15)]' : 'border-white/5 bg-white/[0.04] hover:bg-white/[0.08]'
            } ${p.bankrupt ? 'opacity-45' : ''}`}
          >
            <Avatar token={p.token} color={p.color} size={34} ring={current} dim={p.bankrupt} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={`truncate text-sm font-semibold ${p.bankrupt ? 'line-through' : ''}`}>{p.name}</span>
                {botIds.has(p.id) && <span className="rounded bg-violet-500/30 px-1 text-[9px] font-bold uppercase" title="Computer player">🤖 cpu</span>}
                {room.mode === 'online' && !botIds.has(p.id) && <span className={`text-[8px] ${seatConn.get(p.id) ? 'text-emerald-400' : 'text-rose-400'}`} title={seatConn.get(p.id) ? 'Online' : 'Offline'}>●</span>}
                {controls(p.id) && room.mode === 'online' && <span className="rounded bg-sky-500/30 px-1 text-[9px] font-bold uppercase">you</span>}
                {p.inJail && <span title={`In jail (attempt ${p.jailTurns}/${game.config.maxJailTurns})`}>🔒</span>}
                {p.jailCards.length > 0 && <span title={`${p.jailCards.length} Get Out of Jail Free card(s)`}>🎫{p.jailCards.length > 1 ? p.jailCards.length : ''}</span>}
                {p.bankrupt && <span className="text-[10px] font-bold uppercase text-rose-300">bankrupt</span>}
              </div>
              <OwnedChips game={game} playerId={p.id} />
            </div>
            <div className="text-right">
              <div className={`font-mono text-sm font-bold ${debt ? 'text-rose-300' : 'text-emerald-300'}`}>{money(p.cash)}</div>
              <div className="text-[10px] text-white/40" title="Net worth">
                NW {money(nw)}
              </div>
              {debt > 0 && <div className="text-[10px] font-semibold text-rose-300">owes {money(debt)}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function PlayerDashboard({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const { game, money, controls, openProperty, act, openTrade } = useGame();
  const [tab, setTab] = useState<'props' | 'tx'>('props');
  const p = game.players.find((x) => x.id === playerId)!;
  const score = scorePlayer(game, playerId);
  const owned = ownedBy(game, playerId);
  const groups = completedGroups(game, playerId);
  const { houses, hotels } = buildingCounts(game, playerId);
  const mine = controls(playerId) && !p.bankrupt;
  const tx = game.transactions.filter((t) => t.from === playerId || t.to === playerId).slice().reverse();
  const name = (x: string) => (x === 'bank' ? 'Bank' : game.players.find((y) => y.id === x)?.name ?? x);

  const sections: { key: string; label: string; color: string; members: number[]; group?: ColorGroup }[] = [
    ...COLOR_GROUPS.map((g) => ({ key: g, label: GROUP_LABELS[g], color: GROUP_COLORS[g], members: GROUP_MEMBERS[g], group: g })),
    { key: 'rr', label: 'Airports', color: '#e7e5e4', members: PURCHASABLE.filter((i) => BOARD[i].kind === 'railroad') },
    { key: 'ut', label: 'Utilities', color: '#94a3b8', members: PURCHASABLE.filter((i) => BOARD[i].kind === 'utility') },
  ].filter((s) => s.members.some((i) => game.props[i].owner === playerId));

  return (
    <Modal
      title={
        <span className="flex items-center gap-3">
          <Avatar token={p.token} color={p.color} size={34} /> {p.name}
          {p.bankrupt && <span className="text-sm text-rose-300">(bankrupt)</span>}
        </span>
      }
      onClose={onClose}
      wide
      footer={
        mine && tradeWindowOpen(game) && game.currentPlayer === playerId ? (
          <button className="btn-primary" onClick={() => openTrade({ from: playerId })}>
            🤝 Propose a trade
          </button>
        ) : undefined
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Cash" value={money(p.cash)} accent="text-emerald-300" />
        <Stat label="Net worth" value={money(score.netWorth)} accent="text-amber-200" />
        <Stat label="Properties" value={`${owned.length} (${owned.filter((i) => game.props[i].mortgaged).length} mortgaged)`} />
        <Stat label="Buildings" value={`${houses} 🏠 · ${hotels} 🏨`} />
        <Stat label="Countries owned" value={groups.length ? groups.map((g) => GROUP_LABELS[g]).join(', ') : 'None'} />
        <Stat label="Jail" value={p.inJail ? `In jail (try ${p.jailTurns}/${game.config.maxJailTurns})` : 'Free'} />
        <Stat label="Jail-free cards" value={String(p.jailCards.length)} />
        <Stat label="Position" value={spaceName(game, p.position)} />
      </div>

      <div className="mb-3 flex gap-2">
        <button className={tab === 'props' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setTab('props')}>
          Properties
        </button>
        <button className={tab === 'tx' ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setTab('tx')}>
          Transactions ({tx.length})
        </button>
      </div>

      {tab === 'props' && (
        <div className="flex flex-col gap-3">
          {sections.length === 0 && <p className="text-sm text-white/50">No properties yet.</p>}
          {sections.map((s) => (
            <div key={s.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                  {s.group && groups.includes(s.group) && <span className="rounded bg-amber-400/25 px-1.5 text-[10px] font-bold uppercase text-amber-200">complete set</span>}
                </div>
                {mine && s.group && groupHasBuildings(game, s.group) && s.members.every((i) => game.props[i].owner === playerId) && (
                  <button className="btn-ghost btn-sm" onClick={() => act(playerId, { type: 'sellAllBuildings', group: s.group! })}>
                    Sell all buildings in group
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {s.members
                  .filter((i) => game.props[i].owner === playerId)
                  .map((i) => {
                    const ps = game.props[i];
                    return (
                      <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-black/20 px-2 py-1.5">
                        <button className="min-w-[150px] flex-1 text-left text-sm hover:underline" onClick={() => openProperty(i)}>
                          {spaceName(game, i)}
                          <span className="ml-2 text-xs text-white/50">
                            {ps.houses === 5 ? '🏨' : '🏠'.repeat(ps.houses)}
                            {ps.mortgaged && <span className="text-rose-300"> mortgaged</span>}
                          </span>
                        </button>
                        {mine && <PropertyActions index={i} actor={playerId} />}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'tx' && (
        <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-stone-800 text-left text-white/50">
              <tr>
                <th className="px-2 py-1.5">Time</th>
                <th className="px-2">Description</th>
                <th className="px-2">With</th>
                <th className="px-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {tx.map((t) => {
                const incoming = t.to === playerId;
                return (
                  <tr key={t.id} className="border-t border-white/5">
                    <td className="whitespace-nowrap px-2 py-1 text-white/40">{new Date(t.ts).toLocaleTimeString()}</td>
                    <td className="px-2">{t.reason}</td>
                    <td className="px-2 text-white/60">{name(incoming ? t.from : t.to)}</td>
                    <td className={`px-2 text-right font-mono font-semibold ${incoming ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {incoming ? '+' : '−'}
                      {money(t.amount)}
                    </td>
                  </tr>
                );
              })}
              {tx.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-3 text-center text-white/40">
                    No transactions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{label}</div>
      <div className={`truncate text-sm font-semibold ${accent ?? ''}`} title={value}>
        {value}
      </div>
    </div>
  );
}
