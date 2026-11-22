import { useMemo, useState } from 'react';
import { BOARD, GROUP_COLORS } from '../../engine/board';
import { checkTrade, groupHasBuildings, mortgageInterest, ownedBy, spaceName } from '../../engine/engine';
import type { GameState, Trade, TradeSide } from '../../engine/types';
import { Avatar, Modal } from './ui';
import { useGame } from './gameCtx';

const emptySide = (): TradeSide => ({ cash: 0, properties: [], jailCards: 0 });

function SideEditor({ game, playerId, side, onChange, label }: { game: GameState; playerId: string; side: TradeSide; onChange: (s: TradeSide) => void; label: string }) {
  const p = game.players.find((x) => x.id === playerId)!;
  const owned = ownedBy(game, playerId);
  const toggle = (i: number) => onChange({ ...side, properties: side.properties.includes(i) ? side.properties.filter((x) => x !== i) : [...side.properties, i] });
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2">
        <Avatar token={p.token} color={p.color} size={28} />
        <div>
          <div className="text-sm font-semibold">{label}</div>
          <div className="text-xs text-white/50">
            {p.name} has {game.config.currency}
            {p.cash.toLocaleString()}
          </div>
        </div>
      </div>
      <div>
        <label className="label">Cash</label>
        <input type="number" min={0} max={p.cash} className="input" value={side.cash || ''} placeholder="0" onChange={(e) => onChange({ ...side, cash: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
      </div>
      {p.jailCards.length > 0 && (
        <div>
          <label className="label">Get Out of Jail Free cards (has {p.jailCards.length})</label>
          <input type="number" min={0} max={p.jailCards.length} className="input" value={side.jailCards} onChange={(e) => onChange({ ...side, jailCards: Math.max(0, Math.min(p.jailCards.length, Math.floor(Number(e.target.value) || 0))) })} />
        </div>
      )}
      <div>
        <label className="label">Properties</label>
        <div className="scroll-thin flex max-h-56 flex-col gap-1 overflow-y-auto">
          {owned.length === 0 && <span className="text-xs text-white/40">No properties.</span>}
          {owned.map((i) => {
            const d = BOARD[i];
            const ps = game.props[i];
            const blocked = d.kind === 'property' && groupHasBuildings(game, d.group!);
            return (
              <label key={i} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm ${side.properties.includes(i) ? 'bg-amber-300/20' : 'hover:bg-white/5'} ${blocked ? 'cursor-not-allowed opacity-40' : ''}`} title={blocked ? 'Sell the buildings in this colour group first' : ''}>
                <input type="checkbox" disabled={blocked} checked={side.properties.includes(i)} onChange={() => toggle(i)} />
                <span className="h-3 w-2 rounded-sm" style={{ background: d.group ? GROUP_COLORS[d.group] : '#999' }} />
                <span className="flex-1">{spaceName(game, i)}</span>
                {ps.mortgaged && <span className="text-[10px] text-rose-300">mortgaged</span>}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function TradeModal({ initial, onClose }: { initial: { from?: string; to?: string; counter?: Trade }; onClose: () => void }) {
  const { game, controls, act } = useGame();
  const alive = game.players.filter((p) => !p.bankrupt);
  const counter = initial.counter;
  // Only the player standing on the Auction House can start a trade; others can only counter.
  const myPlayers = counter ? alive.filter((p) => p.id === counter.to) : alive.filter((p) => p.id === game.currentPlayer && controls(p.id));
  const [from, setFrom] = useState(counter ? counter.to : myPlayers[0]?.id ?? '');
  const [to, setTo] = useState(counter ? counter.from : initial.to ?? alive.find((p) => p.id !== from)?.id ?? '');
  // Counteroffer: start from the original terms, swapped to the new proposer's perspective.
  const [offer, setOffer] = useState<TradeSide>(counter ? { ...counter.request } : emptySide());
  const [request, setRequest] = useState<TradeSide>(counter ? { ...counter.offer } : emptySide());
  const [message, setMessage] = useState('');
  const error = from && to ? checkTrade(game, from, to, offer, request) : 'Choose both players.';

  const submit = async () => {
    const ok = await act(from, { type: 'proposeTrade', to, offer, request, counterOf: counter?.id, message: message.trim() || undefined });
    if (ok) onClose();
  };

  return (
    <Modal
      title={counter ? 'Counteroffer' : 'Propose a trade'}
      onClose={onClose}
      wide
      footer={
        <>
          <span className={`mr-auto self-center text-sm ${error ? 'text-rose-300' : 'text-emerald-300'}`}>{error ?? 'Trade looks valid ✓'}</span>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!!error} onClick={submit}>
            {counter ? 'Send counteroffer' : 'Send offer'}
          </button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">From (you)</label>
          <select className="input" value={from} disabled={!!counter || myPlayers.length < 2} onChange={(e) => { setFrom(e.target.value); setOffer(emptySide()); if (e.target.value === to) setTo(alive.find((p) => p.id !== e.target.value)?.id ?? ''); }}>
            {myPlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.token} {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">With</label>
          <select className="input" value={to} disabled={!!counter} onChange={(e) => { setTo(e.target.value); setRequest(emptySide()); }}>
            {alive
              .filter((p) => p.id !== from)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.token} {p.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      {from && to && (
        <div className="grid gap-4 md:grid-cols-2">
          <SideEditor key={`o-${from}`} game={game} playerId={from} side={offer} onChange={setOffer} label="You give" />
          <SideEditor key={`r-${to}`} game={game} playerId={to} side={request} onChange={setRequest} label="You receive" />
        </div>
      )}
      <div className="mt-4">
        <label className="label">Message (optional)</label>
        <input className="input" maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Let's complete our sets!" />
      </div>
      <p className="mt-3 text-xs text-white/40">Trading is open only while the current player is on the Auction House. Open offers are withdrawn when they leave it or end their turn. Properties with buildings in their colour group can't be traded. Whoever receives a mortgaged property pays the bank 10% interest straight away.</p>
    </Modal>
  );
}

function SideSummary({ game, side, giver }: { game: GameState; side: TradeSide; giver: string }) {
  const p = game.players.find((x) => x.id === giver)!;
  const cur = game.config.currency;
  const nothing = !side.cash && !side.properties.length && !side.jailCards;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Avatar token={p.token} color={p.color} size={24} /> {p.name} gives
      </div>
      <ul className="space-y-1 text-sm">
        {nothing && <li className="text-white/40">Nothing</li>}
        {side.cash > 0 && (
          <li className="font-mono text-emerald-300">
            💵 {cur}
            {side.cash.toLocaleString()}
          </li>
        )}
        {side.properties.map((i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-3 w-2 rounded-sm" style={{ background: BOARD[i].group ? GROUP_COLORS[BOARD[i].group!] : '#999' }} />
            {spaceName(game, i)}
            {game.props[i].mortgaged && (
              <span className="text-[10px] text-rose-300">
                mortgaged (+{cur}
                {mortgageInterest(i)} interest)
              </span>
            )}
          </li>
        ))}
        {side.jailCards > 0 && <li>🎫 {side.jailCards} Get Out of Jail Free card(s)</li>}
      </ul>
    </div>
  );
}

export function TradeReview({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const { game, controls, act, openTrade, money } = useGame();
  const t = game.trades.find((x) => x.id === trade.id) ?? trade;
  const a = game.players.find((p) => p.id === t.from)!;
  const b = game.players.find((p) => p.id === t.to)!;
  const error = t.status === 'pending' ? checkTrade(game, t.from, t.to, t.offer, t.request) : null;
  const canRespond = t.status === 'pending' && controls(t.to);
  const canCancel = t.status === 'pending' && controls(t.from);
  const interest = (props: number[]) => props.filter((i) => game.props[i].mortgaged).reduce((s, i) => s + mortgageInterest(i), 0);
  const aAfter = a.cash - t.offer.cash + t.request.cash - interest(t.request.properties);
  const bAfter = b.cash - t.request.cash + t.offer.cash - interest(t.offer.properties);
  const run = async (fn: () => Promise<boolean>) => {
    if (await fn()) onClose();
  };
  return (
    <Modal
      title={`Trade offer · ${a.name} → ${b.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          {error && <span className="mr-auto self-center text-sm text-rose-300">⚠ {error}</span>}
          {t.status !== 'pending' && <span className="mr-auto self-center text-sm capitalize text-white/60">Status: {t.status}</span>}
          {canCancel && (
            <button className="btn-ghost" onClick={() => run(() => act(t.from, { type: 'cancelTrade', tradeId: t.id }))}>
              Withdraw offer
            </button>
          )}
          {canRespond && (
            <>
              <button className="btn-red" onClick={() => run(() => act(t.to, { type: 'rejectTrade', tradeId: t.id }))}>
                Reject
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  onClose();
                  openTrade({ counter: t });
                }}
              >
                Counteroffer
              </button>
              <button className="btn-green" disabled={!!error} onClick={() => run(() => act(t.to, { type: 'acceptTrade', tradeId: t.id }))}>
                Accept trade
              </button>
            </>
          )}
        </>
      }
    >
      {t.message && <p className="mb-4 rounded-xl bg-white/5 p-3 text-sm italic text-white/80">“{t.message}”</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <SideSummary game={game} side={t.offer} giver={t.from} />
        <SideSummary game={game} side={t.request} giver={t.to} />
      </div>
      <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
        {[
          { p: a, after: aAfter },
          { p: b, after: bAfter },
        ].map(({ p, after }) => (
          <div key={p.id} className="rounded-xl bg-black/25 p-3">
            <div className="label">{p.name} — cash before → after</div>
            <div className="font-mono">
              {money(p.cash)} → <span className={after >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{money(after)}</span>
            </div>
            <div className="mt-1 text-xs text-white/50">Owns {ownedBy(game, p.id).length} properties now.</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function TradeList() {
  const { game, controls, reviewTrade } = useGame();
  const pending = useMemo(() => game.trades.filter((t) => t.status === 'pending'), [game.trades]);
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? '?';
  if (!pending.length) return <p className="text-xs text-white/40">No open trade offers.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {pending.map((t) => {
        const incoming = controls(t.to);
        return (
          <button key={t.id} onClick={() => reviewTrade(t)} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs ${incoming ? 'border-amber-300/60 bg-amber-300/10' : 'border-white/10 bg-white/5'}`}>
            <span>
              {t.counterOf !== undefined ? '↩ ' : ''}
              <b>{name(t.from)}</b> → <b>{name(t.to)}</b>
            </span>
            <span className={incoming ? 'font-semibold text-amber-200' : 'text-white/50'}>{incoming ? 'Review' : 'View'}</span>
          </button>
        );
      })}
    </div>
  );
}
