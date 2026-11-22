import { useEffect, useState } from 'react';
import { BOARD } from '../../engine/board';
import { DECK_NAMES } from '../../engine/cards';
import { liquidationValue, scorePlayer, spaceName, tradeWindowOpen } from '../../engine/engine';
import type { CardDraw, LogEntry } from '../../engine/types';
import Dice from './Dice';
import { DeedCard } from './Property';
import { Avatar, Confirm, Modal } from './ui';
import { useGame } from './gameCtx';

function useNow(interval = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

/** The main turn controls, shown in the centre of the board. */
export function CenterPanel({ rolling, animating }: { rolling: boolean; animating: boolean }) {
  const { game, controls, act, money, openPlayer, openTrade } = useGame();
  const p = game.players.find((x) => x.id === game.currentPlayer)!;
  const mine = controls(p.id);
  const busy = rolling || animating;
  const phase = game.phase;
  const [confirmBankrupt, setConfirmBankrupt] = useState<string | null>(null);

  let body: React.ReactNode = null;
  if (phase === 'preRoll') {
    body = p.inJail ? (
      <div className="flex flex-col items-center gap-2">
        <div className="text-sm font-semibold text-orange-800">🔒 In jail — attempt {p.jailTurns + 1} of {game.config.maxJailTurns}</div>
        {mine ? (
          <div className="flex flex-wrap justify-center gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => act(p.id, { type: 'roll' })}>
              🎲 Roll for doubles
            </button>
            <button className="btn-green" disabled={busy || p.cash < game.config.jailFine} onClick={() => act(p.id, { type: 'payJailFine' })}>
              Pay {money(game.config.jailFine)}
            </button>
            <button className="btn-ghost !border-stone-800/30 !bg-stone-900/80" disabled={busy || !p.jailCards.length} onClick={() => act(p.id, { type: 'useJailCard' })}>
              🎫 Use card ({p.jailCards.length})
            </button>
          </div>
        ) : (
          <Waiting name={p.name} />
        )}
      </div>
    ) : mine ? (
      <button className="btn-primary px-8 py-3 text-lg" disabled={busy} onClick={() => act(p.id, { type: 'roll' })} autoFocus>
        🎲 {game.turn.hasRolled ? 'Doubles! Roll again' : 'Roll dice'}
      </button>
    ) : (
      <Waiting name={p.name} />
    );
  } else if (phase === 'buyDecision' && game.pendingPurchase !== null) {
    const idx = game.pendingPurchase;
    const price = BOARD[idx].price!;
    body = busy ? null : (
      <div className="flex flex-col items-center gap-2">
        <div className="text-sm font-semibold text-stone-800">
          {spaceName(game, idx)} is for sale — {money(price)}
        </div>
        {mine ? (
          <div className="flex gap-2">
            <button className="btn-green" disabled={p.cash < price} title={p.cash < price ? 'Not enough cash — mortgage something first, or auction it' : ''} onClick={() => act(p.id, { type: 'buy' })}>
              Buy for {money(price)}
            </button>
            <button className="btn-red" onClick={() => act(p.id, { type: 'decline' })}>
              Auction it
            </button>
            {p.cash < price && (
              <button className="btn-ghost !border-stone-800/30 !bg-stone-900/80" title="Skip this property without an auction" onClick={() => act(p.id, { type: 'skipPurchase' })}>
                Pass
              </button>
            )}
          </div>
        ) : (
          <Waiting name={p.name} what="decide" />
        )}
        {mine && p.cash < price && <div className="text-xs font-semibold text-rose-700">Not enough cash. Mortgage or sell to raise funds, send it to auction, or pass.</div>}
      </div>
    );
  } else if (phase === 'postRoll') {
    body = mine ? (
      <button className="btn-primary px-8 py-3 text-lg" disabled={busy} onClick={() => act(p.id, { type: 'endTurn' })}>
        End turn ➜
      </button>
    ) : (
      <Waiting name={p.name} what="finish their turn" />
    );
  } else if (phase === 'debt') {
    const d = game.debts[0];
    const debtor = game.players.find((x) => x.id === d.debtor)!;
    const creditor = d.creditor === 'bank' ? 'the Bank' : game.players.find((x) => x.id === d.creditor)!.name;
    const shortBy = d.amount - debtor.cash;
    const canRaise = liquidationValue(game, debtor.id);
    body = (
      <div className="flex flex-col items-center gap-2 rounded-xl bg-rose-900/90 p-3 text-white shadow-lg">
        <div className="text-sm">
          <b>{debtor.name}</b> owes <b>{money(d.amount)}</b> to {creditor} <span className="text-white/60">({d.reason})</span>
        </div>
        <div className="text-xs text-white/80">
          Short by <b>{money(shortBy)}</b>. Could raise up to {money(canRaise)} by selling buildings &amp; mortgaging. Debt is paid automatically once you have enough cash.
        </div>
        {controls(debtor.id) ? (
          <div className="flex gap-2">
            <button className="btn-primary btn-sm" onClick={() => openPlayer(debtor.id)}>
              Raise funds
            </button>
            <button className="btn-red btn-sm" onClick={() => setConfirmBankrupt(debtor.id)}>
              Declare bankruptcy
            </button>
          </div>
        ) : (
          <div className="text-xs text-white/70">Waiting for {debtor.name} to raise funds…</div>
        )}
      </div>
    );
  } else if (phase === 'auction') {
    body = <div className="text-sm font-semibold text-stone-800">🔨 Auction in progress…</div>;
  }

  const lastCard = game.lastCard;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex items-center gap-2 rounded-full bg-stone-900/85 py-1 pl-1 pr-4 text-white shadow-lg">
        <Avatar token={p.token} color={p.color} size={32} />
        <div className="text-left leading-tight">
          <div className="text-[10px] uppercase tracking-wider text-white/50">Turn {game.turn.number}</div>
          <div className="font-semibold">
            {p.name} · <span className="font-mono text-emerald-300">{money(p.cash)}</span>
          </div>
        </div>
      </div>
      <Dice dice={game.turn.dice} rolling={rolling} size={54} />
      <div className="min-h-[52px]">{body}</div>
      {tradeWindowOpen(game) && !busy && !game.auction && (
        <div className="flex flex-col items-center gap-1.5 rounded-xl bg-amber-900/90 px-3 py-2 text-white shadow-lg">
          <div className="text-xs font-semibold">🏛️ {p.name} is at the Auction House. Trading is open this turn.</div>
          {mine && (
            <button className="btn-primary btn-sm" onClick={() => openTrade({ from: p.id })}>
              🤝 Propose a trade
            </button>
          )}
        </div>
      )}
      {lastCard && !busy && (
        <div className="max-w-xs text-[11px] italic text-stone-700/80">
          Last card ({DECK_NAMES[lastCard.deck]}): {lastCard.text}
        </div>
      )}
      {confirmBankrupt && (
        <Confirm
          title="Declare bankruptcy?"
          danger
          confirmLabel="Declare bankruptcy"
          body={
            <>
              All of {game.players.find((x) => x.id === confirmBankrupt)!.name}'s cash, properties and cards go to the creditor (or are auctioned by the bank). This cannot be undone.
              {liquidationValue(game, confirmBankrupt) + (game.players.find((x) => x.id === confirmBankrupt)!.cash) >= game.debts.filter((d) => d.debtor === confirmBankrupt).reduce((a, d) => a + d.amount, 0) && (
                <p className="mt-2 font-semibold text-amber-300">Note: you could still raise enough by mortgaging or selling buildings.</p>
              )}
            </>
          }
          onCancel={() => setConfirmBankrupt(null)}
          onConfirm={() => {
            act(confirmBankrupt, { type: 'declareBankruptcy' });
            setConfirmBankrupt(null);
          }}
        />
      )}
    </div>
  );
}

function Waiting({ name, what = 'play' }: { name: string; what?: string }) {
  return <div className="rounded-full bg-stone-900/70 px-4 py-2 text-sm text-white/80">Waiting for {name} to {what}…</div>;
}

export function AuctionModal() {
  const { game, controls, act, money, room } = useGame();
  const a = game.auction!;
  const now = useNow();
  const [custom, setCustom] = useState<Record<string, string>>({});
  const remaining = a.endsAt ? Math.max(0, Math.ceil((a.endsAt - now) / 1000)) : null;
  const leader = a.highBidder ? game.players.find((p) => p.id === a.highBidder) : null;
  const participants = game.players.filter((p) => !p.bankrupt);
  const visible = room.mode === 'local' ? participants : [...participants.filter((p) => controls(p.id)), ...participants.filter((p) => !controls(p.id))];
  return (
    <Modal title={`🔨 Auction: ${spaceName(game, a.space)}`} wide>
      <div className="grid gap-5 md:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-3">
          <DeedCard game={game} index={a.space} compact />
          <div className="rounded-xl bg-black/30 p-3 text-center">
            <div className="label">Highest bid</div>
            <div className="font-mono text-3xl font-black text-amber-300">{money(a.highBid)}</div>
            <div className="text-sm text-white/70">{leader ? `by ${leader.name}` : 'No bids yet'}</div>
            {remaining !== null && (
              <div className={`mt-2 text-sm font-semibold ${remaining <= 5 ? 'text-rose-300' : 'text-white/60'}`}>
                ⏱ {game.paused ? 'paused' : `${remaining}s left`} {a.highBidder ? '' : '(closes with no sale)'}
              </div>
            )}
            {remaining === null && <div className="mt-2 text-xs text-white/50">Closes when everyone else has passed.</div>}
          </div>
        </div>
        <div className="scroll-thin flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
          {visible.map((p) => {
            const inIt = a.active.includes(p.id);
            const mine = controls(p.id);
            const leading = a.highBidder === p.id;
            const bid = (n: number) => act(p.id, { type: 'bid', amount: n });
            return (
              <div key={p.id} className={`flex flex-wrap items-center gap-2 rounded-xl border px-2.5 py-2 ${leading ? 'border-amber-300/70 bg-amber-300/10' : 'border-white/10 bg-white/[0.03]'} ${inIt ? '' : 'opacity-40'}`}>
                <Avatar token={p.token} color={p.color} size={28} />
                <div className="w-28">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="font-mono text-xs text-emerald-300">{money(p.cash)}</div>
                </div>
                {!inIt ? (
                  <span className="text-xs text-white/50">passed</span>
                ) : leading ? (
                  <span className="text-xs font-semibold text-amber-200">Leading</span>
                ) : mine ? (
                  <div className="flex flex-1 flex-wrap items-center gap-1">
                    {[1, 10, 50, 100].map((inc) => (
                      <button key={inc} className="btn-green btn-sm" disabled={a.highBid + inc > p.cash} onClick={() => bid(a.highBid + inc)}>
                        +{inc}
                      </button>
                    ))}
                    <input
                      className="input w-20 py-1 text-xs"
                      type="number"
                      placeholder="bid"
                      value={custom[p.id] ?? ''}
                      onChange={(e) => setCustom({ ...custom, [p.id]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          bid(Math.floor(Number(custom[p.id])));
                          setCustom({ ...custom, [p.id]: '' });
                        }
                      }}
                    />
                    <button className="btn-ghost btn-sm" onClick={() => act(p.id, { type: 'passAuction' })}>
                      Pass
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-white/50">bidding…</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

export function CardOverlay({ card, onClose }: { card: CardDraw; onClose: () => void }) {
  const { game } = useGame();
  const p = game.players.find((x) => x.id === card.player);
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [card.seq]);
  const chance = card.deck === 'chance';
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className={`pop-in w-[360px] rounded-2xl border-4 p-6 text-center shadow-2xl ${chance ? 'border-sky-900 bg-gradient-to-br from-sky-100 to-sky-300' : 'border-amber-900 bg-gradient-to-br from-amber-100 to-amber-300'} text-stone-900`}>
        <div className="text-4xl">{chance ? '🔮' : '💰'}</div>
        <div className="mb-3 font-display text-2xl font-black uppercase">{DECK_NAMES[card.deck]}</div>
        <p className="text-lg font-medium leading-snug">{card.text}</p>
        <div className="mt-4 text-xs text-stone-700">Drawn by {p?.name} · click to close</div>
      </div>
    </div>
  );
}

const KIND_ICON: Partial<Record<LogEntry['kind'], string>> = {
  dice: '🎲', buy: '🏷️', rent: '💸', tax: '🧾', card: '🃏', jail: '🔒', auction: '🔨', build: '🏗️', mortgage: '🏦', trade: '🤝', debt: '⚠️', bankrupt: '💀', win: '🏆', go: '💵', turn: '▶️', system: '⚙️',
};

export function LogPanel() {
  const { game } = useGame();
  const entries = game.log.slice(-120).reverse();
  return (
    <div className="scroll-thin flex flex-col gap-1 overflow-y-auto pr-1 text-xs">
      {entries.map((e) => {
        const p = e.player ? game.players.find((x) => x.id === e.player) : null;
        return (
          <div key={e.id} className={`flex gap-1.5 rounded-md px-1.5 py-1 ${e.kind === 'turn' ? 'mt-1 bg-white/5 font-semibold' : ''}`}>
            <span className="w-4 shrink-0 text-center">{KIND_ICON[e.kind] ?? '•'}</span>
            {p && <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />}
            <span className="text-white/80">{e.text}</span>
          </div>
        );
      })}
    </div>
  );
}

export function GameOverModal({ onClose, onRestart, onHome }: { onClose: () => void; onRestart?: () => void; onHome: () => void }) {
  const { game, money } = useGame();
  const winner = game.players.find((p) => p.id === game.winner)!;
  const scores = game.finalScores ?? game.players.map((p) => scorePlayer(game, p.id));
  return (
    <Modal
      title="🏆 Game over"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            View board
          </button>
          <button className="btn-ghost" onClick={onHome}>
            Home
          </button>
          {onRestart && (
            <button className="btn-primary" onClick={onRestart}>
              Play again with same players
            </button>
          )}
        </>
      }
    >
      <div className="mb-5 flex flex-col items-center gap-2 text-center">
        <Avatar token={winner.token} color={winner.color} size={80} ring />
        <div className="font-display text-4xl font-black text-amber-200">{winner.name} wins!</div>
        <div className="text-sm text-white/60">{game.endReason}</div>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-white/40">
          <tr>
            <th className="py-1">#</th>
            <th>Player</th>
            <th className="text-right">Cash</th>
            <th className="text-right">Property</th>
            <th className="text-right">Buildings</th>
            <th className="text-right">Debts</th>
            <th className="text-right">Net worth</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((s, i) => {
            const p = game.players.find((x) => x.id === s.player)!;
            return (
              <tr key={s.player} className={`border-t border-white/5 ${p.id === winner.id ? 'text-amber-200' : ''}`}>
                <td className="py-1.5">{i + 1}</td>
                <td>
                  {p.token} {p.name} {p.bankrupt && <span className="text-xs text-rose-300">(bankrupt)</span>}
                </td>
                <td className="text-right font-mono">{money(s.cash)}</td>
                <td className="text-right font-mono">{money(s.propertyValue)}</td>
                <td className="text-right font-mono">{money(s.buildingValue)}</td>
                <td className="text-right font-mono">{s.debts ? `−${money(s.debts)}` : '—'}</td>
                <td className="text-right font-mono font-bold">{money(s.netWorth)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-white/40">Net worth = cash + printed price of each property (mortgage value if mortgaged) + cost of buildings − unpaid debts.</p>
    </Modal>
  );
}
