import { useEffect, useState } from 'react';
import { call, clientId } from '../net';
import { navigate } from '../nav';
import { Avatar, useRun } from '../components/ui';
import { BOARD, GROUP_COLORS } from '../../engine/board';
import { COLORS, MAX_SEATS, MIN_SEATS, TOKENS, type RoomView } from '../../engine/room';
import type { GameConfig } from '../../engine/types';

export default function Lobby({ room }: { room: RoomView }) {
  const run = useRun();
  const isHost = room.hostId === clientId;
  const takenTokens = new Set(room.seats.map((s) => s.token));
  const takenColors = new Set(room.seats.map((s) => s.color));
  const firstFree = <T,>(list: T[], taken: Set<T>) => list.find((x) => !taken.has(x)) ?? list[0];
  const [name, setName] = useState('');
  const [token, setToken] = useState(firstFree(TOKENS, takenTokens));
  const [color, setColor] = useState(firstFree(COLORS, takenColors));
  const [showNames, setShowNames] = useState(false);
  const canAdd = room.mode === 'online' || isHost;
  const mySeats = room.seats.filter((s) => s.controllerId === clientId);
  const hostConnected = room.hostConnected || isHost;

  useEffect(() => {
    if (takenTokens.has(token)) setToken(firstFree(TOKENS, takenTokens));
    if (takenColors.has(color)) setColor(firstFree(COLORS, takenColors));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.seats.length]);

  const add = () =>
    run(async () => {
      await call('seat:add', { code: room.code, name, token, color });
      setName('');
      // Move the pickers on immediately so a fast second add never reuses the same token.
      setToken(firstFree(TOKENS, new Set([...takenTokens, token])));
      setColor(firstFree(COLORS, new Set([...takenColors, color])));
    });

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <button className="mb-2 text-sm text-white/50 hover:text-white" onClick={() => navigate('/')}>
              ← Home
            </button>
            <h1 className="font-display text-4xl font-black text-amber-100">{room.mode === 'online' ? 'Online Lobby' : 'Pass & Play Setup'}</h1>
          </div>
          <div className="panel px-5 py-3 text-center">
            <div className="label">Room code</div>
            <div className="font-mono text-3xl font-black tracking-[0.35em] text-amber-300">{room.code}</div>
          </div>
        </div>

        {room.mode === 'online' && (
          <div className="panel mb-5 p-4 text-sm text-white/70">
            Share this page with your friends (Share menu, as a Contributor or Editor so they can play), then give them the code <b className="text-amber-200">{room.code}</b>. They choose <i>Join a Room</i> and enter it.{' '}
            {isHost ? 'Keep this page open while you play: your browser runs the game for everyone.' : 'The host runs the game from their browser.'}
          </div>
        )}

        {!isHost && !hostConnected && (
          <div className="panel mb-5 flex items-center justify-between gap-3 border-amber-400/40 p-4 text-sm">
            <span>The host is offline.</span>
            <button className="btn-primary btn-sm" onClick={() => run(() => call('room:takeover', { code: room.code }))}>
              Take over as host
            </button>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-5">
            <div className="panel p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-2xl font-bold text-amber-100">Players</h2>
                <span className={`text-sm font-semibold ${room.seats.length >= MIN_SEATS ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {room.seats.length} / {MAX_SEATS} {room.seats.length < MIN_SEATS && `· need at least ${MIN_SEATS}`}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {room.seats.map((s) => {
                  const mine = s.controllerId === clientId;
                  return (
                    <div key={s.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                      <Avatar token={s.token} color={s.color} size={42} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{s.name}</div>
                        <div className="text-xs text-white/50">
                          {s.bot ? (
                            '🤖 computer'
                          ) : room.mode === 'online' ? (
                            <>
                              <span className={s.connected ? 'text-emerald-400' : 'text-rose-400'}>●</span> {s.connected ? 'online' : 'offline'}
                              {mine && ' · you'}
                              {s.controllerId === room.hostId && ' · host'}
                            </>
                          ) : (
                            'on this laptop'
                          )}
                        </div>
                      </div>
                      {room.mode === 'online' && !s.bot && !s.connected && !mine && (
                        <button className="btn-ghost btn-sm" title="Reconnect as this player from this device" onClick={() => run(() => call('seat:claim', { code: room.code, seatId: s.id }))}>
                          Claim
                        </button>
                      )}
                      {(mine || isHost) && (
                        <button className="btn-ghost btn-sm" onClick={() => run(() => call('seat:remove', { code: room.code, seatId: s.id }))}>
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
                {room.seats.length === 0 && <p className="text-sm text-white/50">No players yet — add the first one.</p>}
              </div>
            </div>

            {isHost && room.seats.length < MAX_SEATS && (
              <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="text-sm text-white/70">
                  Not enough people? Fill the table with <b className="text-amber-200">computer players</b>.
                </div>
                <button className="btn-ghost" onClick={() => run(() => call('seat:addBot', { code: room.code }))}>
                  🤖 Add computer
                </button>
              </div>
            )}

            {canAdd && room.seats.length < MAX_SEATS && (room.mode === 'local' || mySeats.length < 2) && (
              <div className="panel p-5">
                <h3 className="mb-3 font-display text-xl font-bold text-amber-100">{room.mode === 'online' && mySeats.length === 0 ? 'Take a seat' : 'Add a player'}</h3>
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="label">Name</label>
                    <input className="input" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Player name" />
                  </div>
                  <div>
                    <label className="label">Token</label>
                    <div className="flex flex-wrap gap-2">
                      {TOKENS.map((t) => (
                        <button
                          key={t}
                          disabled={takenTokens.has(t)}
                          onClick={() => setToken(t)}
                          className={`flex h-11 w-11 items-center justify-center rounded-xl border text-2xl transition disabled:opacity-20 ${
                            token === t ? 'border-amber-300 bg-amber-300/20 scale-110' : 'border-white/10 bg-white/5 hover:bg-white/10'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="label">Colour</label>
                    <div className="flex flex-wrap gap-2">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => setColor(c)}
                          className={`h-8 w-8 rounded-full border-2 transition ${color === c ? 'scale-125 border-white' : 'border-transparent'} ${takenColors.has(c) ? 'opacity-30' : ''}`}
                          style={{ background: c }}
                          title={takenColors.has(c) ? 'Already used (allowed)' : ''}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Avatar token={token} color={color} size={48} />
                    <button className="btn-primary flex-1" onClick={add} disabled={!name.trim()}>
                      Add {name.trim() || 'player'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-5">
            <Settings room={room} isHost={isHost} onRename={() => setShowNames(true)} />
            {isHost ? (
              <button
                className="btn-primary py-4 text-lg"
                disabled={room.seats.length < MIN_SEATS}
                onClick={() => run(() => call('room:start', { code: room.code }))}
              >
                {room.seats.length < MIN_SEATS ? `Add ${MIN_SEATS - room.seats.length} more player(s)` : '🎲 Start the game'}
              </button>
            ) : (
              <div className="panel p-4 text-center text-sm text-white/60">Waiting for the host to start the game…</div>
            )}
          </div>
        </div>
      </div>
      {showNames && <RenameSpaces room={room} isHost={isHost} onClose={() => setShowNames(false)} />}
    </div>
  );
}

function Settings({ room, isHost, onRename }: { room: RoomView; isHost: boolean; onRename: () => void }) {
  const run = useRun();
  const c = room.config;
  const [draft, setDraft] = useState<GameConfig>(c);
  useEffect(() => setDraft(c), [JSON.stringify(c)]);
  const save = (patch: Partial<GameConfig>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    run(() => call('room:config', { code: room.code, config: next }));
  };
  const numField = (label: string, key: keyof GameConfig, min: number, max: number, step = 1) => (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        className="input"
        min={min}
        max={max}
        step={step}
        disabled={!isHost}
        value={draft[key] as number}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
        onBlur={() => save({})}
      />
    </div>
  );
  return (
    <div className="panel p-5">
      <h2 className="mb-4 font-display text-2xl font-bold text-amber-100">Game settings</h2>
      {!isHost && <p className="mb-3 text-xs text-white/50">Only the host can change settings.</p>}
      <div className="mb-4">
        <label className="label">Mode</label>
        <div className="grid grid-cols-2 gap-2">
          {(['classic', 'timed'] as const).map((m) => (
            <button key={m} disabled={!isHost} onClick={() => save({ mode: m })} className={`rounded-xl border p-3 text-left text-sm ${draft.mode === m ? 'border-amber-300 bg-amber-300/15' : 'border-white/10 bg-white/5'}`}>
              <div className="font-semibold">{m === 'classic' ? '♾️ Classic' : '⏱️ Timed'}</div>
              <div className="text-xs text-white/50">{m === 'classic' ? 'Last solvent player wins' : 'Highest net worth at the buzzer'}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {numField('Starting cash', 'startingCash', 100, 100000, 50)}
        {numField('START salary', 'goSalary', 0, 10000, 10)}
        {draft.mode === 'timed' && numField('Duration (min)', 'durationMinutes', 5, 600, 5)}
        {numField('Auction timer (s, 0 = off)', 'auctionSeconds', 0, 120)}
        <div>
          <label className="label">Currency symbol</label>
          <input className="input" maxLength={4} disabled={!isHost} value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} onBlur={() => save({})} />
        </div>
      </div>
      {draft.mode === 'timed' && (
        <p className="mt-3 text-xs leading-relaxed text-white/50">
          Net worth = cash + printed price of each property (mortgage value if mortgaged) + cost of all buildings − unpaid debts. Ties are broken by cash.
        </p>
      )}
      <button className="btn-ghost mt-4 w-full" onClick={onRename}>
        ✏️ {isHost ? 'Customise space names' : 'View space names'} ({Object.keys(c.spaceNames).length} changed)
      </button>
    </div>
  );
}

function RenameSpaces({ room, isHost, onClose }: { room: RoomView; isHost: boolean; onClose: () => void }) {
  const run = useRun();
  const [names, setNames] = useState<Record<number, string>>({ ...room.config.spaceNames });
  const save = () =>
    run(async () => {
      await call('room:config', { code: room.code, config: { ...room.config, spaceNames: names } });
      onClose();
    });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="pop-in flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-stone-900">
        <div className="border-b border-white/10 px-5 py-3 font-display text-xl font-bold text-amber-100">Space names</div>
        <div className="scroll-thin grid flex-1 gap-2 overflow-y-auto p-5 sm:grid-cols-2">
          {BOARD.map((s) => (
            <div key={s.index} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-white/40">{s.index}</span>
              <span className="h-4 w-2 rounded-sm" style={{ background: s.group ? GROUP_COLORS[s.group] : 'transparent' }} />
              <input
                className="input py-1.5"
                disabled={!isHost}
                placeholder={s.name}
                maxLength={28}
                value={names[s.index] ?? ''}
                onChange={(e) => setNames({ ...names, [s.index]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          {isHost && (
            <button className="btn-ghost mr-auto" onClick={() => setNames({})}>
              Reset all
            </button>
          )}
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          {isHost && (
            <button className="btn-primary" onClick={save}>
              Save names
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
