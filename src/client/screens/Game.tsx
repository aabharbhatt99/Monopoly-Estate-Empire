import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoomView } from '../../engine/room';
import type { CardDraw, GameAction, GameState, LogEntry, Trade } from '../../engine/types';
import { AUCTION_HOUSE_INDEX } from '../../engine/board';
import { spaceName, tradeWindowOpen } from '../../engine/engine';
import { call, clientId } from '../net';
import { navigate } from '../nav';
import { audioSettings, play, setMusic, setMuted } from '../sound';
import Board from '../components/Board';
import { GameCtx, type GameCtxValue } from '../components/gameCtx';
import { AuctionModal, CardOverlay, CenterPanel, GameOverModal, LogPanel } from '../components/Panels';
import { PlayerDashboard, PlayerList } from '../components/Players';
import { PropertyModal } from '../components/Property';
import { TradeList, TradeModal, TradeReview } from '../components/Trade';
import { Confirm, useRun, useToast, type Toast } from '../components/ui';

const posMap = (g: GameState) => Object.fromEntries(g.players.map((p) => [p.id, p.position]));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STEP_MS = 140;

function toastFor(e: LogEntry): Omit<Toast, 'id'> | null {
  switch (e.kind) {
    case 'buy':
      return { text: e.text, tone: 'good', icon: '🏷️' };
    case 'rent':
      return { text: e.text, tone: 'warn', icon: '💸' };
    case 'tax':
      return { text: e.text, tone: 'warn', icon: '🧾' };
    case 'jail':
      return { text: e.text, tone: 'bad', icon: '🔒' };
    case 'trade':
      return { text: e.text, tone: 'info', icon: '🤝' };
    case 'auction':
      return /wins|No bids/.test(e.text) ? { text: e.text, tone: 'good', icon: '🔨' } : null;
    case 'build':
      return { text: e.text, tone: 'info', icon: '🏗️' };
    case 'mortgage':
      return { text: e.text, tone: 'info', icon: '🏦' };
    case 'bankrupt':
      return { text: e.text, tone: 'bad', icon: '💀' };
    case 'debt':
      return { text: e.text, tone: 'bad', icon: '⚠️' };
    case 'go':
      return { text: e.text, tone: 'good', icon: '💵' };
    case 'system':
      return { text: e.text, tone: 'info', icon: '⚙️' };
    default:
      return null;
  }
}

const SOUND_FOR: Partial<Record<LogEntry['kind'], Parameters<typeof play>[0]>> = {
  buy: 'coin', go: 'coin', rent: 'pay', tax: 'pay', jail: 'jail', card: 'card', build: 'build', auction: 'auction', trade: 'click', turn: 'turn', win: 'win', bankrupt: 'jail', debt: 'error', mortgage: 'click',
};

export default function Game({ room }: { room: RoomView }) {
  const game = room.game!;
  const run = useRun();
  const { push } = useToast();
  const isHost = room.hostId === clientId;

  // ───── control / identity ─────
  const controlled = useMemo(() => new Set(room.seats.filter((s) => s.controllerId === clientId && !s.bot).map((s) => s.id)), [room.seats]);
  const controls = useCallback((pid: string) => controlled.has(pid), [controlled]);
  const me = controls(game.currentPlayer) ? game.currentPlayer : game.players.find((p) => controls(p.id) && !p.bankrupt)?.id ?? null;

  const act = useCallback(
    (actor: string, action: GameAction) => run(() => call('game:action', { code: room.code, action: { ...action, actor } })),
    [room.code, run],
  );
  const money = useCallback((n: number) => `${game.config.currency}${n.toLocaleString('en-US')}`, [game.config.currency]);

  // ───── modals ─────
  const [propModal, setPropModal] = useState<number | null>(null);
  const [focusPlayer, setFocusPlayer] = useState<string | null>(null);
  const [playerModal, setPlayerModal] = useState<string | null>(null);
  const [tradeCompose, setTradeCompose] = useState<{ from?: string; to?: string; counter?: Trade } | null>(null);
  const [tradeReview, setTradeReview] = useState<Trade | null>(null);
  const [card, setCard] = useState<CardDraw | null>(null);
  const [overDismissed, setOverDismissed] = useState(false);
  const [confirm, setConfirm] = useState<null | 'restart' | 'end'>(null);
  const [muted, setMutedS] = useState(audioSettings.muted);
  const [music, setMusicS] = useState(audioSettings.music);

  // ───── animation pipeline ─────
  const [display, setDisplay] = useState<Record<string, number>>(() => posMap(game));
  const [rolling, setRolling] = useState(false);
  const [animating, setAnimating] = useState(false);
  const seen = useRef({
    moveSeq: Math.max(0, ...game.moves.map((m) => m.seq)),
    rollSeq: game.turn.rollSeq,
    logId: game.log.length ? game.log[game.log.length - 1].id : 0,
    cardSeq: game.lastCard?.seq ?? 0,
    version: game.version,
  });
  const runToken = useRef(0);
  const pendingNotes = useRef<LogEntry[]>([]);
  const pendingCard = useRef<CardDraw | null>(null);

  const flushNotes = useCallback(() => {
    const notes = pendingNotes.current;
    pendingNotes.current = [];
    const sounds = new Set<string>();
    let toasts = 0;
    for (const e of notes) {
      const s = SOUND_FOR[e.kind];
      if (s && !sounds.has(s)) {
        sounds.add(s);
        play(s);
      }
      const t = toastFor(e);
      if (t && toasts < 5) {
        push(t);
        toasts++;
      }
    }
    if (pendingCard.current) {
      setCard(pendingCard.current);
      pendingCard.current = null;
    }
  }, [push]);

  useEffect(() => {
    const s = seen.current;
    if (game.version === s.version && game.version !== 0) {
      setDisplay(posMap(game));
      return;
    }
    // If a game was restarted, reset all trackers.
    if (game.version < s.version) {
      s.moveSeq = 0;
      s.rollSeq = game.turn.rollSeq;
      s.logId = 0;
      s.cardSeq = game.lastCard?.seq ?? 0;
      setOverDismissed(false);
    }
    s.version = game.version;
    const my = ++runToken.current;
    const newMoves = game.moves.filter((m) => m.seq > s.moveSeq);
    const rolled = game.turn.rollSeq !== s.rollSeq;
    pendingNotes.current.push(...game.log.filter((e) => e.id > s.logId));
    if (game.lastCard && game.lastCard.seq > s.cardSeq) pendingCard.current = game.lastCard;
    s.moveSeq = Math.max(s.moveSeq, ...game.moves.map((m) => m.seq));
    s.rollSeq = game.turn.rollSeq;
    s.logId = game.log.length ? game.log[game.log.length - 1].id : s.logId;
    s.cardSeq = game.lastCard?.seq ?? s.cardSeq;

    const moving = new Set(newMoves.map((m) => m.player));
    setDisplay((d) => {
      const n = { ...d };
      for (const p of game.players) if (!moving.has(p.id) || n[p.id] === undefined) n[p.id] = p.position;
      return n;
    });
    setRolling(false);
    setAnimating(false);

    (async () => {
      if (rolled) {
        play('dice');
        setRolling(true);
        await sleep(650);
        if (my !== runToken.current) return;
        setRolling(false);
      }
      if (newMoves.length) {
        setAnimating(true);
        for (const m of newMoves) {
          if (m.teleport) {
            await sleep(200);
            if (my !== runToken.current) return;
            setDisplay((d) => ({ ...d, [m.player]: m.path[m.path.length - 1] }));
            await sleep(250);
            continue;
          }
          for (const pos of m.path) {
            if (my !== runToken.current) return;
            setDisplay((d) => ({ ...d, [m.player]: pos }));
            play('step');
            await sleep(STEP_MS);
          }
          await sleep(180);
        }
        if (my !== runToken.current) return;
        setAnimating(false);
      }
      setDisplay(posMap(game));
      flushNotes();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.version, game.id, game.createdAt]);

  // Incoming trade offers for players on this device
  const lastTradeSeen = useRef(Math.max(0, ...game.trades.map((t) => t.id)));
  useEffect(() => {
    for (const t of game.trades) {
      if (t.id > lastTradeSeen.current && t.status === 'pending' && controls(t.to) && !controls(t.from)) {
        push({ text: `${game.players.find((p) => p.id === t.from)?.name} sent ${game.players.find((p) => p.id === t.to)?.name} a trade offer.`, tone: 'warn', icon: '🤝' });
      }
    }
    lastTradeSeen.current = Math.max(lastTradeSeen.current, ...game.trades.map((t) => t.id));
  }, [game.trades, controls, game.players, push]);

  const ctx: GameCtxValue = {
    room,
    game,
    isHost,
    controls,
    me,
    act,
    money,
    openProperty: setPropModal,
    openPlayer: setPlayerModal,
    openTrade: (o) => setTradeCompose(o),
    reviewTrade: setTradeReview,
    hoverPlayer: setFocusPlayer,
  };

  // ───── timed mode clock ─────
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = game.endsAt ? Math.max(0, game.endsAt - (game.paused ? game.paused.at : now)) : null;
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const hostOnline = room.hostConnected;
  const myPlayers = game.players.filter((p) => controls(p.id) && !p.bankrupt);
  const showAuction = game.phase === 'auction' && game.auction && !rolling && !animating;
  const tradeOpen = tradeWindowOpen(game);
  const canStartTrade = tradeOpen && controls(game.currentPlayer) && !game.auction;
  const auctionHouse = spaceName(game, AUCTION_HOUSE_INDEX);

  return (
    <GameCtx.Provider value={ctx}>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-black/40 px-4">
          <button className="font-display text-xl font-black text-amber-100" onClick={() => navigate('/')} title="Home">
            Estate Empire
          </button>
          <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs tracking-widest text-amber-200" title="Room code">
            {room.code}
          </span>
          <span className="text-xs text-white/50">
            {room.mode === 'online' ? '🌐 Online' : '🛋️ Pass & play'} · {game.config.mode === 'timed' ? '⏱ Timed' : '♾ Classic'}
          </span>
          {remaining !== null && game.status === 'playing' && (
            <span className={`rounded-md px-2 py-0.5 font-mono text-sm font-bold ${remaining < 120000 ? 'bg-rose-700' : 'bg-white/10'}`}>⏱ {fmt(remaining)}</span>
          )}
          <span className="text-xs text-white/40">
            Bank: {game.bankHouses} 🏠 · {game.bankHotels} 🏨
          </span>
          <div className="ml-auto flex items-center gap-2">
            {isHost && game.status === 'playing' && (
              <>
                {game.paused ? (
                  <button className="btn-green btn-sm" onClick={() => run(() => call('room:resume', { code: room.code }))}>
                    ▶ Resume
                  </button>
                ) : (
                  <button className="btn-ghost btn-sm" onClick={() => run(() => call('room:pause', { code: room.code }))}>
                    ⏸ Pause
                  </button>
                )}
                <button className="btn-ghost btn-sm" onClick={() => setConfirm('end')}>
                  End game
                </button>
              </>
            )}
            {isHost && (
              <button className="btn-ghost btn-sm" onClick={() => setConfirm('restart')}>
                ↻ Restart
              </button>
            )}
            {!isHost && !hostOnline && (
              <button className="btn-primary btn-sm" onClick={() => run(() => call('room:takeover', { code: room.code }))} title="The host is offline">
                Become host
              </button>
            )}
            <button
              className="btn-ghost btn-sm"
              title="Background music"
              onClick={() => {
                setMusic(!music);
                setMusicS(!music);
              }}
            >
              {music ? '🎵 On' : '🎵 Off'}
            </button>
            <button
              className="btn-ghost btn-sm"
              title={muted ? 'Unmute' : 'Mute'}
              onClick={() => {
                setMuted(!muted);
                setMutedS(!muted);
              }}
            >
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 gap-3 p-3">
          <aside className="panel flex w-[250px] shrink-0 flex-col p-3 xl:w-[300px]">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-amber-100">Players</h3>
              <span className="text-[10px] text-white/40">hover to spot · click for details</span>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
              <PlayerList />
            </div>
          </aside>

          <section className="relative min-w-0 flex-1">
            <Board game={game} display={display} onSpace={setPropModal} highlight={game.pendingPurchase} focusPlayer={focusPlayer}>
              <CenterPanel rolling={rolling} animating={animating} />
            </Board>
            {game.paused && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
                <div className="panel p-8 text-center">
                  <div className="text-5xl">⏸</div>
                  <div className="mt-2 font-display text-3xl font-black text-amber-100">Game paused</div>
                  <p className="mt-1 text-sm text-white/60">{isHost ? 'Resume when everyone is ready.' : 'Waiting for the host to resume.'}</p>
                  {isHost && (
                    <button className="btn-green mt-4" onClick={() => run(() => call('room:resume', { code: room.code }))}>
                      ▶ Resume game
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <aside className="flex w-[260px] shrink-0 flex-col gap-3 xl:w-[320px]">
            <div className="panel p-3">
              <h3 className="mb-2 font-display text-lg font-bold text-amber-100">Actions</h3>
              {myPlayers.length ? (
                <div className="flex flex-col gap-2">
                  <button
                    className="btn-primary"
                    disabled={!canStartTrade}
                    title={canStartTrade ? '' : `Trading opens only when you land on the ${auctionHouse} on your turn.`}
                    onClick={() => setTradeCompose({ from: game.currentPlayer })}
                  >
                    🤝 Propose trade
                  </button>
                  {!canStartTrade && (
                    <p className="text-[11px] text-white/40">
                      {tradeOpen
                        ? `Trading is open: ${game.players.find((p) => p.id === game.currentPlayer)?.name} is at the ${auctionHouse}. Answer their offers below.`
                        : `🏛️ Trading opens only when the current player lands on the ${auctionHouse}.`}
                    </p>
                  )}
                  <button className="btn-ghost" onClick={() => setPlayerModal(me ?? myPlayers[0].id)}>
                    🏠 Build / mortgage {room.mode === 'local' && me ? `(${game.players.find((p) => p.id === me)?.name})` : ''}
                  </button>
                  {room.mode === 'local' && <p className="text-[11px] text-white/40">Any player can build or mortgage at any time. Click a name on the left to act as that player.</p>}
                </div>
              ) : (
                <p className="text-xs text-white/50">You are spectating{game.status === 'playing' ? '' : ''}.</p>
              )}
            </div>
            <div className="panel p-3">
              <h3 className="mb-2 font-display text-lg font-bold text-amber-100">Trade offers</h3>
              <TradeList />
            </div>
            <div className="panel flex min-h-0 flex-1 flex-col p-3">
              <h3 className="mb-2 font-display text-lg font-bold text-amber-100">Game log</h3>
              <LogPanel />
            </div>
          </aside>
        </main>
      </div>

      {showAuction && <AuctionModal />}
      {propModal !== null && <PropertyModal index={propModal} onClose={() => setPropModal(null)} />}
      {playerModal && <PlayerDashboard playerId={playerModal} onClose={() => setPlayerModal(null)} />}
      {tradeCompose && <TradeModal initial={tradeCompose} onClose={() => setTradeCompose(null)} />}
      {tradeReview && <TradeReview trade={tradeReview} onClose={() => setTradeReview(null)} />}
      {card && <CardOverlay card={card} onClose={() => setCard(null)} />}
      {game.status === 'finished' && !overDismissed && !animating && (
        <GameOverModal
          onClose={() => setOverDismissed(true)}
          onHome={() => navigate('/')}
          onRestart={isHost ? () => run(() => call('room:restart', { code: room.code })) : undefined}
        />
      )}
      {confirm === 'restart' && (
        <Confirm
          title="Restart the game?"
          body="A brand-new game starts with the same players and settings. Current progress will be replaced."
          confirmLabel="Restart"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            run(() => call('room:restart', { code: room.code }));
          }}
        />
      )}
      {confirm === 'end' && (
        <Confirm
          title="End the game now?"
          body="The game ends immediately and the player with the highest net worth wins."
          confirmLabel="End game"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            run(() => call('room:endGame', { code: room.code }));
          }}
        />
      )}
    </GameCtx.Provider>
  );
}
